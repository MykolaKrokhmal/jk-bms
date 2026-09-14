#!/usr/bin/env python3
"""Deterministic, re-runnable manifest builder for the V1.1-normative register
registry (Stage 3, BMS_V2_MANIFEST_EXECUTION_LOG.md).

Reads the user-supplied `LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`
workbook's "Реєстр параметрів" sheet (265 rows) and "Групи UI" sheet, and
writes protocol/generated/bms_v1_1_manifest.json: one record per row, with
every field the manifest schema requires (id, group/order, address, access,
type/signedness/length, endian, packed bit/byte, raw unit, scale/UI unit,
precision/step/min/max where the source actually states them — explicit
null otherwise, never guessed — UI control kind, update period class,
visibility condition, verification status, evidence source, vendor/
reserved/derived classification, and a read-back rule).

This does NOT touch protocol/registers.canonical.json or any part of the
existing Stage-1 evidence pipeline — it is a new, parallel, additive
artifact (per the governing prompt: "без зміни робочої логіки" — stages 1-4
are audit-only). Reuses the same stdlib-only OOXML sheet parser as
build_workbook_index.py (no third-party Python dependencies, matching
requirements-protocol.txt).

Run:
  python3 protocol/evidence/build_v2_manifest.py --workbook /path/to/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx
  python3 protocol/evidence/build_v2_manifest.py --workbook <path> --check   (verify, write nothing)
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_workbook_index import parse_xlsx_sheet  # noqa: E402

REGISTRY_SHEET = "Реєстр параметрів"
UI_GROUPS_SHEET = "Групи UI"
MANIFEST_SCHEMA_VERSION = 1

# --- column indices (0-based), matching the sheet's own header row --------
COL = {
    "address": 0, "name_ua": 1, "name_prog": 2, "size": 3, "unit": 4,
    "access": 5, "description": 6, "example": 7, "origin": 8,
    "verification": 9, "ui_section": 10, "ui_component": 11,
    "update_policy": 12, "visibility": 13, "audit_note": 14,
}

ZERO_WIDTH = "​"


def clean(v):
    if v is None:
        return None
    s = str(v).replace(ZERO_WIDTH, "").strip()
    return s if s else None


def cell(row, key):
    return clean(row.get(COL[key]) if isinstance(row.get(COL[key]), str) else row.get(str(COL[key])))


def _row_get(row, idx):
    # parse_xlsx_sheet keys rows by int column index in this codebase's own
    # convention (see build_workbook_index.py) — support both possible key
    # shapes defensively (int or str) since this script imports the same
    # parser but must not assume its exact dict-key type.
    if idx in row:
        return row[idx]
    return row.get(str(idx))


def get_field(row, key):
    return clean(_row_get(row, COL[key]))


ADDRESS_RE = re.compile(r"^(0x[0-9A-Fa-f]{4})\s*(.*)$")


def parse_address(raw):
    if raw is None:
        return None
    m = ADDRESS_RE.match(raw)
    if not m:
        return {"raw": raw, "base_address": None, "byte_half": None, "bit": None, "bit_unspecified": False, "parse_error": True}
    base = m.group(1).upper().replace("0X", "0x")
    rest = m.group(2)
    byte_half = None
    if "старший байт" in rest:
        byte_half = "high"
    elif "молодший байт" in rest:
        byte_half = "low"
    bit = None
    bit_m = re.search(r"біт\s*(\d+)", rest)
    if bit_m:
        bit = int(bit_m.group(1))
    bit_unspecified = "біт не вказано" in rest
    return {
        "raw": raw, "base_address": base, "byte_half": byte_half,
        "bit": bit, "bit_unspecified": bit_unspecified, "parse_error": False,
    }


SIZE_RE = re.compile(r"^([A-Z]+\d*|ASCII)(?:\s*\(([^)]*)\))?")


def parse_size(raw, address_info):
    if raw is None:
        return None
    if raw == "Розрахункове":
        return {"raw": raw, "wire_type": None, "length_bytes": None, "signedness": None, "bit_field": False}
    bit_field_m = re.search(r"біт\s*(\d+)$|біт\s*невідомий$", raw)
    m = SIZE_RE.match(raw)
    wire_type = m.group(1) if m else None
    paren = m.group(2) if m else None
    length_bytes = None
    signedness = None
    if wire_type:
        if wire_type.startswith("UINT"):
            signedness = "unsigned"
            bits_m = re.match(r"UINT(\d+)", wire_type)
            if bits_m:
                length_bytes = int(bits_m.group(1)) // 8
        elif wire_type.startswith("INT"):
            signedness = "signed"
            bits_m = re.match(r"INT(\d+)", wire_type)
            if bits_m:
                length_bytes = int(bits_m.group(1)) // 8
        elif wire_type == "FLOAT":
            signedness = "signed"
            length_bytes = 4
        elif wire_type == "ASCII":
            signedness = None
        else:
            wire_type = None
    if paren:
        byte_m = re.search(r"(\d+)\s*байт", paren)
        if byte_m:
            length_bytes = int(byte_m.group(1))
    if raw == "ASCII / HEX":
        wire_type = "ASCII_OR_HEX"
    return {
        "raw": raw, "wire_type": wire_type, "length_bytes": length_bytes,
        "signedness": signedness, "bit_field": bool(bit_field_m) or address_info.get("bit") is not None,
    }


UNIT_SCALE_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(.*)$")


def parse_unit(raw):
    if raw is None or raw == "—":
        return {"raw": raw, "scale": None, "raw_unit_symbol": None, "note": "no unit stated (dimensionless / not applicable)"}
    m = UNIT_SCALE_RE.match(raw)
    if m and float(m.group(1)) != int(float(m.group(1))):
        # A LEADING decimal factor like "0.1 °C" / "0.1 год (0.1H)" — the
        # wire value's real-world scale, distinct from the display symbol.
        return {"raw": raw, "scale": float(m.group(1)), "raw_unit_symbol": m.group(2).strip() or None, "note": None}
    return {"raw": raw, "scale": 1, "raw_unit_symbol": raw, "note": None}


def classify_verification(raw):
    if raw is None:
        return "unspecified"
    table = {
        "Підтверджено V1.1": "confirmed_v1_1",
        "Підтверджено V1.1 — reserved": "confirmed_v1_1_reserved",
        "Вендорне розширення — відсутнє у V1.1": "vendor_extension_not_in_v1_1",
        "Неоднозначність V1.1: номер біта відсутній": "ambiguous_v1_1_bit_number_missing",
        "Неоднозначність V1.1: UINT16 при довжині 4 байти": "ambiguous_v1_1_type_length_mismatch",
        "Розраховано ESPHome — не регістр BMS": "calculated_not_a_register",
    }
    return table.get(raw, "unrecognized:" + raw)


def classify_origin(raw):
    if raw is None:
        return "unspecified"
    if raw.startswith("1"):
        return "bms_register"
    if raw.startswith("2"):
        return "calculated_esphome"
    return "unrecognized:" + raw


def vendor_reserved_derived(verification_class, name_prog, name_ua):
    if verification_class == "vendor_extension_not_in_v1_1":
        return "vendor"
    if verification_class == "confirmed_v1_1_reserved":
        return "reserved"
    if verification_class == "calculated_not_a_register":
        return "derived"
    if name_prog and re.match(r"^RVD", name_prog):
        return "reserved"
    if name_ua and "Зарезервовано" in name_ua:
        return "reserved"
    return "official"


def classify_update_policy(raw):
    if raw is None:
        return "unspecified"
    if "1–2 с" in raw:
        return "live"
    if "10–30 с" in raw:
        return "rw_config"
    if "Не опитується" in raw:
        return "not_polled_write_only"
    if "Не опитувати окремо" in raw:
        return "bundled_in_block_read"
    if "Після кожного оновлення" in raw:
        return "derived_on_dependency_update"
    return "unrecognized:" + raw


def classify_visibility(raw):
    if raw is None:
        return "unspecified"
    if raw == "Завжди":
        return "always"
    if "confirmed_effective_cell_count" in raw:
        return "cell_index_le_confirmed_effective_cell_count"
    return "unrecognized:" + raw


def classify_ui_control_kind(access, size_info, unit_info):
    if access == "W":
        return "service_action"
    if access == "Розрахункове":
        return "readonly_display_derived"
    if access == "R":
        return "readonly_display"
    if access == "RW":
        if size_info and size_info.get("bit_field"):
            return "toggle_with_verify"
        if unit_info and unit_info.get("raw_unit_symbol") is None and unit_info.get("raw") == "—":
            return "unknown_control_kind"
        return "numeric_input_with_verify"
    return "unspecified"


def readback_rule(access, address_info, size_info):
    if access == "W":
        return "ack_only_no_readback"
    if access in (None, "R", "Розрахункове"):
        return "not_applicable_read_only"
    # RW
    is_packed = bool(address_info.get("byte_half")) or (address_info.get("bit") is not None) or (size_info and size_info.get("bit_field"))
    if is_packed:
        return "read_full_physical_word_then_masked_compare_preserve_siblings"
    return "address_readback_full_word_then_compare"


def build_id(name_prog, address_info, row_number, seen_ids):
    base = name_prog or f"row_{row_number}"
    candidate = base
    suffix = 1
    while candidate in seen_ids:
        suffix += 1
        candidate = f"{base}__dup{suffix}"
    seen_ids.add(candidate)
    return candidate


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_ui_groups(path):
    rows, _dims = parse_xlsx_sheet(path, UI_GROUPS_SHEET)
    groups = []
    for k in sorted(rows.keys(), key=int):
        r = rows[k]
        order_raw = _row_get(r, 0)
        if isinstance(order_raw, (int, float)) and _row_get(r, 1):
            groups.append({
                "order": int(order_raw),
                "name": clean(_row_get(r, 1)),
                "access": clean(_row_get(r, 2)),
                "initial_state": clean(_row_get(r, 3)),
                "policy": clean(_row_get(r, 4)),
            })
    return groups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", default=os.environ.get("JK_BMS_WORKBOOK_V2_PATH"))
    ap.add_argument("--output", default=None)
    ap.add_argument("--check", action="store_true", help="verify against existing output; write nothing; exit non-zero on drift")
    args = ap.parse_args()
    if not args.workbook:
        print("V2_MANIFEST_WORKBOOK_REQUIRED: use --workbook or JK_BMS_WORKBOOK_V2_PATH", file=sys.stderr)
        sys.exit(2)

    repo_root = os.path.join(os.path.dirname(__file__), "..", "..")
    output_path = args.output or os.path.join(repo_root, "protocol", "generated", "bms_v1_1_manifest.json")

    file_sha256 = sha256_file(args.workbook)
    rows, dims = parse_xlsx_sheet(args.workbook, REGISTRY_SHEET)
    ui_groups = parse_ui_groups(args.workbook)

    parameters = []
    seen_ids = set()
    row_numbers = sorted(rows.keys(), key=int)
    for row_number in row_numbers:
        if int(row_number) == 1:
            continue  # header
        row = rows[row_number]
        address_raw = get_field(row, "address")
        name_ua = get_field(row, "name_ua")
        name_prog = get_field(row, "name_prog")
        size_raw = get_field(row, "size")
        unit_raw = get_field(row, "unit")
        access = get_field(row, "access")
        description = get_field(row, "description")
        example = get_field(row, "example")
        origin_raw = get_field(row, "origin")
        verification_raw = get_field(row, "verification")
        ui_section = get_field(row, "ui_section")
        ui_component = get_field(row, "ui_component")
        update_policy_raw = get_field(row, "update_policy")
        visibility_raw = get_field(row, "visibility")
        audit_note = get_field(row, "audit_note")

        address_info = parse_address(address_raw)
        size_info = parse_size(size_raw, address_info)
        unit_info = parse_unit(unit_raw)
        verification_class = classify_verification(verification_raw)

        parameters.append({
            "id": build_id(name_prog, address_info, row_number, seen_ids),
            "source_row": int(row_number),
            "name_ua": name_ua,
            "name_prog": name_prog,
            "ui": {
                "group_raw": ui_section,
                "component_raw": ui_component,
                "control_kind": classify_ui_control_kind(access, size_info, unit_info),
                "visibility_condition_raw": visibility_raw,
                "visibility_condition": classify_visibility(visibility_raw),
                "ui_order": None,
                "ui_order_note": (
                    "Not deterministically derivable. The source workbook carries two distinct, "
                    "non-isomorphic UI taxonomies: this row's 'group_raw' comes from the "
                    "'Реєстр параметрів' sheet's coarse UI-section column (8 distinct values across "
                    "all 265 rows, e.g. 'Налаштування → Конфігурація BMS (RW)' alone covers 65 rows), "
                    "while manifest.ui_groups[] comes from the separate 'Групи UI' sheet's 12 "
                    "ordered, curated design groups. No column in the workbook links a parameter "
                    "row to one of the 12 numbered groups, and the two taxonomies do not have a "
                    "clean many-to-one relationship (a single group_raw value plausibly spans "
                    "several of the 12 groups) — an automated text match would fabricate a mapping "
                    "the source data does not support. Resolving per-row group order requires "
                    "either an explicit workbook column (not present) or manual curation by "
                    "someone authoring the Settings UI, tracked as an open item, not guessed here."
                ),
            },
            "address": address_info,
            "access": access,
            "type": size_info,
            "endian": "big" if size_info and (size_info.get("length_bytes") or 0) > 1 else None,
            "endian_source_note": "document section 2 states: unless stated otherwise, high byte first on the wire (big-endian) — a document-wide default, not independently verified per field",
            "unit": unit_info,
            "precision": None,
            "step": None,
            "minimum": None,
            "maximum": None,
            "precision_step_minmax_note": "not present as distinct columns in the V2 register-registry sheet — left explicitly null rather than inferred",
            "update_policy_raw": update_policy_raw,
            "update_policy_class": classify_update_policy(update_policy_raw),
            "verification_status_raw": verification_raw,
            "verification_status": verification_class,
            "evidence_origin_raw": origin_raw,
            "evidence_origin": classify_origin(origin_raw),
            "classification": vendor_reserved_derived(verification_class, name_prog, name_ua),
            "readback_rule": readback_rule(access, address_info, size_info),
            "description": description,
            "example_value": example,
            "audit_note": audit_note,
        })

    duplicate_addresses = {}
    for p in parameters:
        base = p["address"].get("base_address") if p["address"] else None
        if not base:
            continue
        duplicate_addresses.setdefault(base, []).append(p["id"])

    manifest = {
        "$comment": "GENERATED by protocol/evidence/build_v2_manifest.py from LiFePO4_BMS_Parameters_registers-V2_verified.xlsx's 'Реєстр параметрів'/'Групи UI' sheets. DO NOT EDIT BY HAND. Normative source for this project's register/parameter set as of Stage 3 (BMS_V2_MANIFEST_EXECUTION_LOG.md) — supersedes protocol/registers.canonical.json's 113/119-address baseline for coverage purposes; that file's own address-level content was independently cross-checked against this manifest's primary source (official_jk_documentation) and found consistent (0 conflicts) — see protocol/evidence/IMPLEMENTATION_DRIFT_REVIEW.md.",
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "source_workbook_sha256": file_sha256,
        "source_workbook_basename": os.path.basename(args.workbook),
        "parameter_count": len(parameters),
        "unique_base_address_count": len(duplicate_addresses),
        "ui_groups": ui_groups,
        "parameters": parameters,
    }

    expected = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False) + "\n"

    if args.check:
        if not os.path.exists(output_path):
            print(f"V2_MANIFEST_MISSING: {output_path}", file=sys.stderr)
            sys.exit(1)
        with open(output_path, "r", encoding="utf-8") as f:
            current = f.read()
        if current != expected:
            print("V2_MANIFEST_DRIFT: regenerate with 'python3 protocol/evidence/build_v2_manifest.py --workbook <path>'", file=sys.stderr)
            sys.exit(1)
        print(f"v2 manifest check PASS — {len(parameters)} parameters, {len(duplicate_addresses)} unique base addresses")
        return

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    tmp_path = output_path + f".tmp-{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(expected)
    os.replace(tmp_path, output_path)
    print(f"wrote {os.path.relpath(output_path, repo_root)}")
    print(f"{len(parameters)} parameters, {len(duplicate_addresses)} unique base addresses")


if __name__ == "__main__":
    main()
