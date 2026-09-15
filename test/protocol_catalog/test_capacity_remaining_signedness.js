#!/usr/bin/env node
"use strict";

// Regression for Work 5 (final preparation pass): register 0x12A8
// (capacity_remaining) was wire-encoded as unsigned (U32/U_DWORD) in this
// project's own canonical source and firmware config, while the official
// PDF (p.11, 'SOCCapRemain' row — distinguished from the neighboring
// UINT32 rows in the SAME table), the verified V2 workbook, and the
// upstream project's own comment all independently say signed INT32. A
// prior pass had instead changed the CANONICAL signedness to unsigned,
// reasoning that remaining capacity cannot be physically negative — that
// conflates wire signedness with domain bounds. Fixed to signed/S32; this
// file pins the fix so it can't silently regress, and keeps wire
// signedness and domain (min/max) bounds asserted as two SEPARATE, never-
// substituted-for-each-other properties, per that same distinction.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/registers.canonical.json"), "utf8"));
const register = canonical.registers.find((r) => r.address === "0x12A8");
check("0. fixture sanity: register 0x12A8 exists in the canonical source", !!register);
const field = register && register.fields.find((f) => f.key === "capacity_remaining");
check("0b. fixture sanity: field capacity_remaining exists on register 0x12A8", !!field);

// --- wire signedness (the actual fix) ---------------------------------------
check("1. signedness is \"signed\"", field.signedness === "signed", field.signedness);
check("2. wire_type is \"S32\" (this project's canonical vocabulary for signed INT32)", field.wire_type === "S32", field.wire_type);

// --- domain bounds, deliberately kept SEPARATE from wire signedness --------
// The physical quantity still never goes negative in practice -- that's a
// fact about the domain, not a license to re-encode the wire as unsigned.
check("3. minimum is still 0 (domain bound, unrelated to wire signedness)", field.minimum === 0, field.minimum);
check("4. maximum is still 2000 (domain bound, unchanged by this fix)", field.maximum === 2000, field.maximum);

// --- everything else this fix must NOT have touched -------------------------
check("5. address unchanged (0x12A8)", register.address === "0x12A8");
check("6. register_width_bits unchanged (32)", register.register_width_bits === 32, register.register_width_bits);
check("7. word_count unchanged (2)", register.word_count === 2, register.word_count);
check("8. byte_order unchanged (big_endian)", register.byte_order === "big_endian", register.byte_order);
check("9. word_order unchanged (high_word_first)", register.word_order === "high_word_first", register.word_order);
check("10. scale unchanged (0.001)", field.scale === 0.001, field.scale);
check("11. canonical_unit unchanged (Ah)", field.canonical_unit === "Ah", field.canonical_unit);
check("12. declared_access unchanged (r, still read-only)", field.access === "r" && field.effective_access === "r");

// --- verification_status: promoted to "confirmed" by the new V2+PDF evidence
check("13. verification_status is \"confirmed\"", field.verification_status === "confirmed", field.verification_status);

// --- evidence: V2 workbook + official PDF citations present and consistent -
const v2Citation = field.evidence.find((e) => e.source_id === "workbook_lifepo4_bms_parameters_registers_v2");
const pdfCitation = field.evidence.find((e) => e.source_id === "official_jk_documentation");
check("14. field.evidence includes a vendor_workbook_v2 citation", !!v2Citation && v2Citation.derivation_group === "vendor_workbook_v2");
check("15. field.evidence includes a jikong_official (PDF) citation", !!pdfCitation && pdfCitation.derivation_group === "jikong_official");
check("16. the PDF citation's own claim_types list includes \"signedness\" and \"wire_type\"",
  !!pdfCitation && pdfCitation.claim_types.includes("signedness") && pdfCitation.claim_types.includes("wire_type"));
check("17. official/V2 evidence does not contradict canonical: the PDF locator text says INT32, never UINT32",
  !!pdfCitation && /\bINT32\b/.test(pdfCitation.locator) && !/\bUINT32\b/.test(pdfCitation.locator),
  pdfCitation && pdfCitation.locator);
check("18. the two new citations' source_fingerprint match sources.json's recorded fingerprint for each source (no stale/forged fingerprint)",
  (() => {
    const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/sources.json"), "utf8")).sources;
    const v2Source = sources.find((s) => s.source_id === "workbook_lifepo4_bms_parameters_registers_v2");
    const pdfSource = sources.find((s) => s.source_id === "official_jk_documentation");
    return v2Citation.source_fingerprint === v2Source.fingerprint && pdfCitation.source_fingerprint === pdfSource.fingerprint;
  })());

// --- firmware config: the generated decode table must carry a SIGNED
// 32-bit type -- Final-preparation-plan Stage 1, commit boundary 3: this
// register migrated off batterylifepo4.yaml's own declarative
// `value_type:` (that property no longer exists there for this register
// at all, per the migration's own module comment) onto
// protocol/generated/read_plan_decode.h's generated FieldDecode table,
// which is now the real firmware-facing source of signedness for this
// field's decode. Checked as generated TEXT (not just canonical.json,
// already covered by checks 1-2 above) so this regression guard still
// catches a genuine generator bug that canonical.json alone wouldn't
// reveal (e.g. the generator silently dropping is_signed when emitting
// the C++ literal).
const decodeHeader = fs.readFileSync(path.join(ROOT, "protocol/generated/read_plan_decode.h"), "utf8");
const fieldEntryMatch = decodeHeader.match(/\{"capacity_remaining",[^}]*\}/);
check("19. read_plan_decode.h's capacity_remaining FieldDecode entry is signed (true) with WireType::S32",
  !!fieldEntryMatch && /,\s*true\s*,/.test(fieldEntryMatch[0]) && /WireType::S32/.test(fieldEntryMatch[0]),
  fieldEntryMatch && fieldEntryMatch[0]);
check("20. read_plan_decode.h's capacity_remaining FieldDecode entry is not WireType::U32 (unsigned)",
  !!fieldEntryMatch && !/WireType::U32/.test(fieldEntryMatch[0]));

// --- generated artifact agreement -------------------------------------------
const generatedCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, "register_catalog.json"), "utf8"));
const generatedEntry = (generatedCatalog.registers || generatedCatalog).find((r) => r.address === "0x12A8");
check("21. generated register_catalog.json agrees: signed === true", !!generatedEntry && generatedEntry.signed === true, generatedEntry && generatedEntry.signed);
check("22. generated register_catalog.json agrees: verification_status === \"confirmed\"",
  !!generatedEntry && generatedEntry.verification_status === "confirmed", generatedEntry && generatedEntry.verification_status);
check("23. generated register_catalog.json agrees: min/max domain bounds still 0/2000",
  !!generatedEntry && generatedEntry.min === 0 && generatedEntry.max === 2000);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
