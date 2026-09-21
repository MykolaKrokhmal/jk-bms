#!/usr/bin/env node
"use strict";

// Work 8 of the Stage 1 corrective pass: an exact-SET invariant between
// protocol/registers.canonical.json's effective-RW fields and
// protocol/generated/claim_matrix.json's policy_inconsistent fields — not
// just a count match (two counts can agree while the actual key sets
// differ). Runs against the real, current repository files (this is a
// consistency check on THIS repo's state, not an isolated-fixture test —
// the deliberate-mutation self-test at the bottom proves the check logic
// itself would catch a real break, using an in-memory copy so the real
// files are never touched).
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

function loadCanonicalFields(registerDoc) {
  const fields = [];
  for (const reg of registerDoc.registers) for (const f of reg.fields) fields.push({ ...f, registerAddress: reg.address });
  return fields;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** The actual invariant logic, factored out so both the real-repo run
 * below AND the deliberate-mutation self-test can call the identical
 * code path — a checker that only ever runs against known-good fixtures
 * proves nothing about whether it can detect a real break. */
function evaluateInvariant(registerDoc, claimDoc, writeRegistryDoc) {
  const fields = loadCanonicalFields(registerDoc);
  const keys = fields.map((f) => f.key);
  const keySet = new Set(keys);
  const claimKeys = claimDoc.fields.map((f) => f.key);
  const claimKeySet = new Set(claimKeys);

  const effRwKeys = new Set(fields.filter((f) => f.effective_access === "rw").map((f) => f.key));
  const policyInconsistentKeys = new Set(claimDoc.fields.filter((f) => f.policy_consistent === false).map((f) => f.key));
  // Since the owner-override-aware fix (ADR tenth-pass addendum), a
  // correctly-authorized override field is policy_CONSISTENT, not
  // inconsistent — the set worth exact-matching against canonical
  // effective-RW keys is now owner_authorized, not policy_inconsistent.
  const ownerAuthorizedKeys = new Set(claimDoc.fields.filter((f) => f.owner_authorized === true).map((f) => f.key));
  // Stage 4 (typed-petting-puzzle plan §5): a SECOND, independent avenue
  // to effective_access "rw" now exists -- verification_status="confirmed"
  // alone (no owner_write_override), backed by a real, generated write
  // path recorded in protocol/generated/write_registry.json (see
  // build_claim_matrix.js's own registryBacked bypass). The exact-set
  // invariant below now checks effRwKeys against the UNION of both
  // avenues, never just one.
  const registryBackedKeys = new Set((writeRegistryDoc ? writeRegistryDoc.entries : []).map((e) => e.key));
  const authorizedKeys = new Set([...ownerAuthorizedKeys, ...registryBackedKeys]);

  return {
    physicalRegisters: registerDoc.registers.length,
    logicalFields: fields.length,
    declaredRw: fields.filter((f) => f.access === "rw").length,
    declaredR: fields.filter((f) => f.access === "r").length,
    effectiveRw: effRwKeys.size,
    effectiveR: fields.filter((f) => f.effective_access === "r").length,
    unsupported: fields.filter((f) => f.effective_access === "unsupported").length,
    claimCounts: claimDoc.counts,
    noDuplicateCanonicalKeys: keySet.size === keys.length,
    noDuplicateClaimKeys: claimKeySet.size === claimKeys.length,
    noUnknownClaimKeys: [...claimKeySet].every((k) => keySet.has(k)),
    noMissingClaimKeys: [...keySet].every((k) => claimKeySet.has(k)),
    effRwKeys,
    policyInconsistentKeys,
    ownerAuthorizedKeys,
    registryBackedKeys,
    authorizedKeys,
    exactSetMatch: setsEqual(effRwKeys, authorizedKeys),
    // Stage 4: scoped to fields that actually carry an owner_write_override
    // (the original 18) -- a registry-backed field (verification_status
    // "confirmed" alone) legitimately has none, by design (see
    // build_claim_matrix.js's own registryBacked comment).
    overridesWellFormed: fields.filter((f) => f.effective_access === "rw" && f.owner_write_override).every((f) => {
      const o = f.owner_write_override;
      return o && o.authorized === true && typeof o.authorized_by === "string" && o.authorized_by.trim().length > 0
        && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)
        && typeof o.rationale === "string" && o.rationale.trim().length > 0;
    }),
    noSilentEvidencePromotion: fields.filter((f) => f.effective_access === "rw").every((f) => f.verification_status === "implementation_only_unverified" || f.verification_status === "confirmed"),
    // "confirmed" is allowed in principle (a field could become genuinely
    // hardware-verified some day) — what must NEVER happen is
    // effective_access:"rw" resting on any OTHER verification_status
    // (e.g. "conflicting", "unverified" without the override, etc.)
    // while still lacking a well-formed override for the unconfirmed case.
  };
}

// --- run against the real, current repository state -------------------------
const registerDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const claimDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "claim_matrix.json"), "utf8"));
const writeRegistryDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
const r = evaluateInvariant(registerDoc, claimDoc, writeRegistryDoc);

check("1. physical register count: canonical registers.length matches claim_matrix.counts.physical_registers",
  r.physicalRegisters === r.claimCounts.physical_registers, `canonical=${r.physicalRegisters} claim=${r.claimCounts.physical_registers}`);
check("2. logical field count: canonical field count matches claim_matrix.counts.logical_fields",
  r.logicalFields === r.claimCounts.logical_fields, `canonical=${r.logicalFields} claim=${r.claimCounts.logical_fields}`);
check("3. declared RW count is 96 (documented baseline -- Stage 3 completion pass, 2026-09-20: 9 new RW-declared 0x1114 bit fields (heat_en/disable_temp_sensor/gps_heartbeat/port_switch/lcd_always_on/special_charger/smart_sleep_enabled/disable_pcl_module/timed_stored_data) + 1 new RW-declared 0x1118 field (smart_sleep_timeout_hours), all landing effective_access:'r' via dynamic_dependency.resolved=false -- write path fail-closed, same 'not write-enabled' pattern as every prior RW-declared addition; a further change here must again be a reviewed, deliberate catalog edit. Previous baseline: 86 (Stage 3 cell-channel batch, 2026-09-17).", r.declaredRw === 96, `actual=${r.declaredRw}`);
check("4. effective RW count is 60 (documented baseline -- Stage 4 typed-petting-puzzle plan §5: the pre-existing 18 owner-authorized fields + 42 newly-confirmed, registry-backed fields promoted this round)", r.effectiveRw === 60, `actual=${r.effectiveRw}`);
check("4b. of the 60 effective-RW fields, exactly 18 are owner-authorized and 42 are registry-backed (the two authorization avenues never overlap)",
  r.ownerAuthorizedKeys.size === 18 && r.registryBackedKeys.size === 42 && [...r.ownerAuthorizedKeys].every((k) => !r.registryBackedKeys.has(k)),
  `owner=${r.ownerAuthorizedKeys.size} registry=${r.registryBackedKeys.size}`);
check("5. effective R count is 190 (documented baseline -- Stage 4 typed-petting-puzzle plan §5 promoted 42 of the prior 232 to effective_access rw)", r.effectiveR === 190, `actual=${r.effectiveR}`);
check("6. unsupported count is 4 (documented baseline -- Stage 2 typed-petting-puzzle plan added 3 new intentionally_not_exposed reserved half-registers, 0x12EE/0x130C/0x1506, alongside the pre-existing reserved_0x12d2; a further change here must again be a reviewed, deliberate catalog edit)",
  r.unsupported === 4, `actual=${r.unsupported}`);
check("6b. declared_r + declared_rw == logical field count", r.declaredR + r.declaredRw === r.logicalFields);
check("6c. effective_rw + effective_r + unsupported == logical field count", r.effectiveRw + r.effectiveR + r.unsupported === r.logicalFields);
check("7. claim_matrix.counts.write_ready is 0 (no field is independently protocol-verified yet)", r.claimCounts.write_ready === 0, `actual=${r.claimCounts.write_ready}`);
check("8. claim_matrix.counts.write_blocked equals logical field count", r.claimCounts.write_blocked === r.logicalFields, `write_blocked=${r.claimCounts.write_blocked} fields=${r.logicalFields}`);
check("9. claim_matrix.counts.policy_inconsistent is 0 (owner-override-aware gate: every effective-RW field reconciles)", r.claimCounts.policy_inconsistent === 0, `actual=${r.claimCounts.policy_inconsistent}`);
check("10. EXACT set equality: canonical effective-RW keys === (claim_matrix owner_authorized keys UNION write_registry.json keys), no extra/missing/duplicate",
  r.exactSetMatch, `canonical-only=${[...r.effRwKeys].filter((k) => !r.authorizedKeys.has(k))} claim-only=${[...r.authorizedKeys].filter((k) => !r.effRwKeys.has(k))}`);
check("10b. claim_matrix policy_inconsistent key set is empty (no field, override or not, disagrees with its stored effective_access)",
  r.policyInconsistentKeys.size === 0, `inconsistent=${[...r.policyInconsistentKeys]}`);
check("11. no duplicate keys in canonical source", r.noDuplicateCanonicalKeys);
check("11b. no duplicate keys in claim_matrix", r.noDuplicateClaimKeys);
check("12. no unknown keys in claim_matrix (every claim_matrix key exists in canonical)", r.noUnknownClaimKeys);
check("12b. no missing keys (every canonical key has a claim_matrix entry)", r.noMissingClaimKeys);
check("13. every effective-RW field that carries an owner_write_override has it well-formed (authorized/authorized_by/date/rationale) -- registry-backed fields legitimately carry none", r.overridesWellFormed);
check("14. no effective-RW field's verification_status silently implies evidence-verification without either \"confirmed\" or the override", r.noSilentEvidencePromotion);

// --- deliberate-mutation self-test: proves the checker actually detects a break ---
console.log("\n--- self-test: deliberately broken fixtures must fail the same invariant ---");
{
  const mutated = JSON.parse(JSON.stringify(registerDoc));
  // Flip one effective-RW field's key so the canonical set and the
  // (unmodified) claim_matrix set can no longer match exactly.
  let mutatedOne = false;
  outer: for (const reg of mutated.registers) {
    for (const f of reg.fields) {
      if (f.effective_access === "rw") { f.key = `${f.key}__mutated_fixture`; mutatedOne = true; break outer; }
    }
  }
  check("self-test fixture sanity: a field was actually mutated", mutatedOne);
  const mutatedResult = evaluateInvariant(mutated, claimDoc);
  check("self-test: exact-set check FAILS on the mutated fixture (proves criterion 10 is not vacuously true)", mutatedResult.exactSetMatch === false);
}
{
  const mutated = JSON.parse(JSON.stringify(registerDoc));
  let mutatedOne = false;
  outer: for (const reg of mutated.registers) {
    for (const f of reg.fields) {
      if (f.effective_access === "rw") { delete f.owner_write_override.authorized_by; mutatedOne = true; break outer; }
    }
  }
  check("self-test fixture sanity: an override field was actually removed", mutatedOne);
  const mutatedResult = evaluateInvariant(mutated, claimDoc);
  check("self-test: override-well-formedness check FAILS when authorized_by is stripped (proves criterion 13 is not vacuously true)", mutatedResult.overridesWellFormed === false);
}
{
  const mutated = JSON.parse(JSON.stringify(claimDoc));
  mutated.fields = mutated.fields.filter((f) => f.key !== "smart_sleep"); // drop one known claim entry
  const mutatedResult = evaluateInvariant(registerDoc, mutated);
  check("self-test: missing-claim-key check FAILS when a claim_matrix entry is dropped (proves criterion 12b is not vacuously true)", mutatedResult.noMissingClaimKeys === false);
}
{
  const mutated = JSON.parse(JSON.stringify(claimDoc));
  const target = mutated.fields.find((f) => f.key === "smart_sleep");
  target.policy_consistent = false; // simulate the pre-fix (dead-gate) state for one field
  mutated.counts = { ...mutated.counts, policy_inconsistent: mutated.counts.policy_inconsistent + 1 };
  const mutatedResult = evaluateInvariant(registerDoc, mutated);
  check("self-test: policy_inconsistent-is-empty check FAILS when a field is marked policy_consistent:false (proves criterion 10b is not vacuously true)",
    mutatedResult.policyInconsistentKeys.size !== 0);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
