#!/usr/bin/env python3
"""Build the architecture-aware index of the production implementation.

The pre-cluster implementation placed ``address: 0xNNNN`` inside individual
ESPHome entity blocks. M5 removed those legacy polling entities: the runtime
now consumes generated cluster, fallback-decode, write-registry and
entity-route projections. This index follows those real runtime projections.
"""
import argparse
import hashlib
import json
import os
import sys

DEFAULT_OUT = "protocol/evidence/implementation_index.json"
SOURCE_PATHS = (
    "batterylifepo4.yaml",
    "protocol/registers.canonical.json",
    "protocol/generated/read_clusters.json",
    "protocol/generated/read_plan.json",
    "protocol/generated/write_registry.json",
    "protocol/generated/protocol_entity_routes.json",
)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def json_pointer(*parts):
    def escape(value):
        return str(value).replace("~", "~0").replace("/", "~1")
    return "/" + "/".join(escape(part) for part in parts)


def runtime_binding(lines, needle):
    matches = [index + 1 for index, line in enumerate(lines) if needle in line]
    if len(matches) != 1:
        raise ValueError(f"IMPLEMENTATION_BINDING_COUNT:{needle}:{len(matches)}")
    return {"source_path": "batterylifepo4.yaml", "line": matches[0], "text": needle}


def build():
    canonical = read_json(SOURCE_PATHS[1])
    clusters = read_json(SOURCE_PATHS[2])
    read_plan = read_json(SOURCE_PATHS[3])
    write_registry = read_json(SOURCE_PATHS[4])
    routes = read_json(SOURCE_PATHS[5])
    yaml_raw = read_bytes(SOURCE_PATHS[0])
    yaml_lines = yaml_raw.decode("utf-8").splitlines()

    registers_by_id = {}
    registers_by_address = {}
    fields_by_key = {}
    for register in canonical["registers"]:
        register_id = register["register_id"]
        address = register["address"]
        if register_id in registers_by_id:
            raise ValueError(f"IMPLEMENTATION_DUPLICATE_REGISTER_ID:{register_id}")
        if address in registers_by_address:
            raise ValueError(f"IMPLEMENTATION_DUPLICATE_ADDRESS:{address}")
        registers_by_id[register_id] = register
        registers_by_address[address] = register
        for field in register["fields"]:
            fields_by_key[field["key"]] = (register, field)

    read_owners = {}
    for cluster_index, cluster in enumerate(clusters["clusters"]):
        for register_index, register_id in enumerate(cluster["register_ids"]):
            owner = {
                "kind": "cluster",
                "cluster_id": cluster["cluster_id"],
                "source_path": SOURCE_PATHS[2],
                "json_pointer": json_pointer("clusters", cluster_index, "register_ids", register_index),
                "start": cluster["start"],
                "register_count": cluster["register_count"],
                "cadence_ms": cluster["cadence_ms"],
            }
            read_owners.setdefault(register_id, []).append(owner)
    for read_index, isolated in enumerate(clusters["isolated_reads"]):
        for register_index, register_id in enumerate(isolated["register_ids"]):
            owner = {
                "kind": "isolated_read",
                "read_id": isolated["read_id"],
                "source_path": SOURCE_PATHS[2],
                "json_pointer": json_pointer("isolated_reads", read_index, "register_ids", register_index),
                "start": isolated["start"],
                "register_count": isolated["register_count"],
                "trigger": isolated["trigger"],
            }
            read_owners.setdefault(register_id, []).append(owner)

    unknown_read_ids = sorted(set(read_owners) - set(registers_by_id))
    if unknown_read_ids:
        raise ValueError(f"IMPLEMENTATION_UNKNOWN_READ_REGISTER:{','.join(unknown_read_ids)}")

    fallback_by_address = {}
    for block_index, block in enumerate(read_plan["blocks"]):
        fields = [{
            "key": field["key"],
            "entity_id": field["entity_id"],
            "domain": field["domain"],
            "byte_offset": field["byte_offset"],
            "mask": field["mask"],
            "shift": field["shift"],
            "signedness": "signed" if field["signed"] else "unsigned",
            "wire_type": field["wire_type"],
            "scale": field["scale"],
            "offset": field["offset"],
            "canonical_unit": field["unit"],
        } for field in block["fields"]]
        fallback_by_address.setdefault(block["address"], []).append({
            "source_path": SOURCE_PATHS[3],
            "json_pointer": json_pointer("blocks", block_index),
            "block_class": block["block_class"],
            "register_count": block["register_count"],
            "payload_bytes": block["payload_bytes"],
            "validation_policy": block["validation_policy"],
            "field_keys": [field["key"] for field in fields],
            "fields": fields,
        })

    writes_by_address = {}
    for entry_index, entry in enumerate(write_registry["entries"]):
        pair = fields_by_key.get(entry["key"])
        if pair is None or pair[0]["address"] != entry["address"]:
            raise ValueError(f"IMPLEMENTATION_WRITE_GEOMETRY:{entry['key']}:{entry['address']}")
        writes_by_address.setdefault(entry["address"], []).append({
            "source_path": SOURCE_PATHS[4],
            "json_pointer": json_pointer("entries", entry_index),
            "key": entry["key"],
            "entity_id": entry["entity_id"],
            "write_function": entry["write_function"],
            "word_count": entry["word_count"],
            "byte_order": entry["byte_order"],
            "word_order": entry["word_order"],
            "wire_type": entry["wire_type"],
            "signedness": entry["signedness"],
            "scale": entry["scale"],
            "offset": entry["offset"],
            "minimum": entry["minimum"],
            "maximum": entry["maximum"],
            "step": entry["step"],
            "field_width_bits": entry["field_width_bits"],
            "mask": entry["mask"],
            "shift": entry["shift"],
            "packed_siblings": entry["packed_siblings"],
            "uses_read_modify_write": entry["write_uses_read_modify_write"],
            "submit_policy": entry["submit_policy"],
        })

    routes_by_key = {}
    for route_index, route in enumerate(routes["routes"]):
        routes_by_key.setdefault(route["key"], []).append({
            "source_path": SOURCE_PATHS[5],
            "json_pointer": json_pointer("routes", route_index),
            "key": route["key"],
            "domain": route["domain"],
            "entity_id": route["entityId"],
            "configured_name": route["configuredName"],
        })

    address_index = {}
    for address, register in sorted(registers_by_address.items()):
        owners = read_owners.get(register["register_id"], [])
        if len(owners) != 1:
            raise ValueError(
                f"IMPLEMENTATION_READ_OWNER_COUNT:{register['register_id']}:{len(owners)}"
            )
        owner = owners[0]
        fallback_blocks = fallback_by_address.get(address, [])
        write_fields = writes_by_address.get(address, [])
        field_routes = []
        field_implementations = []
        for field in register["fields"]:
            key = field["key"]
            matching_routes = routes_by_key.get(key, [])
            matching_reads = [
                (block, read_field)
                for block in fallback_blocks
                for read_field in block["fields"]
                if read_field["key"] == key
            ]
            matching_writes = [write for write in write_fields if write["key"] == key]
            field_routes.extend(matching_routes)

            claims = {"address": address}
            claim_locators = {
                "address": {"source_path": owner["source_path"], "json_pointer": owner["json_pointer"]}
            }
            for block, read_field in matching_reads:
                locator = {"source_path": block["source_path"], "json_pointer": block["json_pointer"]}
                claims.update({
                    "register_width": block["register_count"] * 16,
                    "word_count": block["register_count"],
                    "payload_byte_length": block["payload_bytes"],
                    "field_width": bin(int(read_field["mask"], 0)).count("1"),
                    "mask_shift_byte_offset": {
                        "mask": read_field["mask"],
                        "shift": read_field["shift"],
                        "byte_offset": read_field["byte_offset"],
                    },
                    "signedness": read_field["signedness"],
                    "wire_type": read_field["wire_type"],
                    "scale": read_field["scale"],
                    "offset": read_field["offset"],
                    "canonical_unit": read_field["canonical_unit"],
                })
                for claim in (
                    "register_width", "word_count", "payload_byte_length", "field_width",
                    "mask_shift_byte_offset", "signedness", "wire_type", "scale", "offset",
                    "canonical_unit",
                ):
                    claim_locators[claim] = locator
            for write in matching_writes:
                locator = {"source_path": write["source_path"], "json_pointer": write["json_pointer"]}
                claims.update({
                    "register_width": write["word_count"] * 16,
                    "word_count": write["word_count"],
                    "payload_byte_length": write["word_count"] * 2,
                    "byte_order": write["byte_order"],
                    "word_order": write["word_order"],
                    "field_width": write["field_width_bits"],
                    "mask_shift_byte_offset": {
                        "mask": write["mask"], "shift": write["shift"], "byte_offset": field["byte_offset"]
                    },
                    "signedness": write["signedness"],
                    "wire_type": write["wire_type"],
                    "scale": write["scale"],
                    "offset": write["offset"],
                    "minimum_maximum_step": {
                        "minimum": write["minimum"], "maximum": write["maximum"], "step": write["step"]
                    },
                    "write_function": write["write_function"],
                    "packed_atomicity_preserve_sibling": {
                        "uses_read_modify_write": write["uses_read_modify_write"],
                        "packed_siblings": write["packed_siblings"],
                    },
                })
                for claim in (
                    "register_width", "word_count", "payload_byte_length", "byte_order", "word_order",
                    "field_width", "mask_shift_byte_offset", "signedness", "wire_type", "scale", "offset",
                    "minimum_maximum_step", "write_function", "packed_atomicity_preserve_sibling",
                ):
                    claim_locators[claim] = locator
            if matching_routes:
                route = matching_routes[0]
                claims["implementation_entity_mapping"] = {
                    "domain": route["domain"],
                    "read_entity_id": route["entity_id"],
                    "configured_name": route["configured_name"],
                    "write_entity_id": matching_writes[0]["entity_id"] if matching_writes else None,
                }
                claim_locators["implementation_entity_mapping"] = {
                    "source_path": route["source_path"], "json_pointer": route["json_pointer"]
                }
            field_implementations.append({
                "key": key,
                "claims": claims,
                "claim_locators": claim_locators,
            })
        address_index[address] = [{
            "register_id": register["register_id"],
            "locator": {
                "source_path": owner["source_path"],
                "json_pointer": owner["json_pointer"],
            },
            "read_owners": owners,
            "fallback_read_blocks": fallback_blocks,
            "write_fields": write_fields,
            "entity_routes": field_routes,
            "field_implementations": field_implementations,
        }]

    source_sha256 = {
        source: hashlib.sha256(read_bytes(source)).hexdigest()
        for source in SOURCE_PATHS
    }
    return {
        "$comment": (
            "GENERATED by build_implementation_index.py from the runtime-consumed "
            "cluster/read-plan/write-registry/entity-route projections; do not edit by hand."
        ),
        "source_paths": list(SOURCE_PATHS),
        "source_sha256": source_sha256,
        "total_lines": len(yaml_lines),
        "runtime_bindings": [
            runtime_binding(yaml_lines, "register_reads: !include protocol/generated/read_plan.yaml"),
            runtime_binding(yaml_lines, "write_registry: !include protocol/generated/write_registry.yaml"),
            runtime_binding(yaml_lines, "protocol/generated/read_plan_decode.h"),
            runtime_binding(yaml_lines, "protocol/generated/read_clusters_table.h"),
            runtime_binding(yaml_lines, "protocol/generated/write_registry_table.h"),
        ],
        "unique_addresses": len(address_index),
        "indexed_registers": len(address_index),
        "cluster_read_registers": sum(
            1 for records in address_index.values()
            if records[0]["read_owners"][0]["kind"] == "cluster"
        ),
        "isolated_read_registers": sum(
            1 for records in address_index.values()
            if records[0]["read_owners"][0]["kind"] == "isolated_read"
        ),
        "fallback_read_blocks": sum(
            len(records[0]["fallback_read_blocks"]) for records in address_index.values()
        ),
        "write_implemented_fields": sum(
            len(records[0]["write_fields"]) for records in address_index.values()
        ),
        "routed_fields": sum(
            len(records[0]["entity_routes"]) for records in address_index.values()
        ),
        "address_index": address_index,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        output = build()
    except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    text = json.dumps(output, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        # pipeline.js owns release_generation_id and stamps it after this
        # generator runs. Compare only this generator's payload.
        existing = open(args.output, encoding="utf-8").read() if os.path.exists(args.output) else None
        existing_payload = None
        if existing is not None:
            try:
                parsed = json.loads(existing)
                parsed.pop("release_generation_id", None)
                existing_payload = json.dumps(parsed, indent=2, ensure_ascii=False) + "\n"
            except (json.JSONDecodeError, AttributeError):
                existing_payload = None
        if existing_payload != text:
            print("IMPLEMENTATION_INDEX_STALE", file=sys.stderr)
            return 1
        print(f"implementation-index PASS addresses={output['unique_addresses']}")
        return 0
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write(text)
    print(f"wrote {args.output}; addresses={output['unique_addresses']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
