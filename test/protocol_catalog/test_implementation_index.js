"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
const sha256 = (relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS  ${name}`);
  else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const canonical = readJson("protocol/registers.canonical.json");
const clusters = readJson("protocol/generated/read_clusters.json");
const writes = readJson("protocol/generated/write_registry.json");
const index = readJson("protocol/evidence/implementation_index.json");
const claimMatrix = readJson("protocol/generated/claim_matrix.json");

const canonicalAddresses = canonical.registers.map((register) => register.address).sort();
const indexedAddresses = Object.keys(index.address_index).sort();
check("implementation index covers the exact canonical physical-address set",
  JSON.stringify(indexedAddresses) === JSON.stringify(canonicalAddresses),
  `canonical=${canonicalAddresses.length} indexed=${indexedAddresses.length}`);
check("unique_addresses and indexed_registers report the real physical-register count",
  index.unique_addresses === canonical.registers.length && index.indexed_registers === canonical.registers.length,
  `unique=${index.unique_addresses} indexed=${index.indexed_registers} canonical=${canonical.registers.length}`);

const rows = indexedAddresses.flatMap((address) => index.address_index[address] || []);
check("every address has exactly one register-implementation record",
  indexedAddresses.every((address) => (index.address_index[address] || []).length === 1));
check("every implementation record names its canonical register and one concrete read owner",
  rows.every((row) => typeof row.register_id === "string" && Array.isArray(row.read_owners) && row.read_owners.length === 1));

const clusterRegisterCount = clusters.clusters.reduce((count, cluster) => count + cluster.register_ids.length, 0);
const isolatedRegisterCount = clusters.isolated_reads.reduce((count, read) => count + read.register_ids.length, 0);
const clusteredOwners = rows.filter((row) => row.read_owners[0] && row.read_owners[0].kind === "cluster").length;
const isolatedOwners = rows.filter((row) => row.read_owners[0] && row.read_owners[0].kind === "isolated_read").length;
check("read ownership mirrors the generated cluster/isolated geometry exactly",
  clusteredOwners === clusterRegisterCount && isolatedOwners === isolatedRegisterCount,
  `clustered=${clusteredOwners}/${clusterRegisterCount} isolated=${isolatedOwners}/${isolatedRegisterCount}`);

const indexedWriteFields = rows.reduce((count, row) => count + row.write_fields.length, 0);
check("write mappings mirror the generated write registry exactly",
  indexedWriteFields === writes.entries.length && index.write_implemented_fields === writes.entries.length,
  `indexed=${indexedWriteFields} registry=${writes.entries.length}`);
check("every record carries resolvable, architecture-aware locators instead of legacy YAML address lines",
  rows.every((row) => row.locator && row.locator.source_path && row.locator.json_pointer &&
    row.read_owners.every((owner) => owner.source_path && owner.json_pointer)));

const voltage1 = index.address_index["0x1200"] && index.address_index["0x1200"][0];
const voltage1Impl = voltage1 && voltage1.field_implementations &&
  voltage1.field_implementations.find((field) => field.key === "cell_voltage_1");
check("the index records per-field claims from concrete runtime projections",
  voltage1Impl && voltage1Impl.claims.address === "0x1200" &&
  voltage1Impl.claims.implementation_entity_mapping &&
  !Object.prototype.hasOwnProperty.call(voltage1Impl.claims, "declared_access"));

const voltage1Claims = claimMatrix.fields.find((field) => field.key === "cell_voltage_1").claims;
const voltage1ProjectClaimTypes = Object.entries(voltage1Claims)
  .filter(([, records]) => records.some((record) => record.source_id === "project_implementation"))
  .map(([claim]) => claim).sort();
check("claim matrix never fabricates implementation facts absent from the index",
  JSON.stringify(voltage1ProjectClaimTypes) === JSON.stringify(["address", "implementation_entity_mapping"]),
  voltage1ProjectClaimTypes.join(","));

for (const [relative, digest] of Object.entries(index.source_sha256 || {})) {
  check(`source hash matches ${relative}`, fs.existsSync(path.join(ROOT, relative)) && sha256(relative) === digest);
}

check("service-action addresses remain absent from the register implementation index",
  !indexedAddresses.some((address) => /^0x16/i.test(address)));

if (failures) process.exit(1);
