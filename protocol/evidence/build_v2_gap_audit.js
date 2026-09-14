#!/usr/bin/env node
"use strict";
/*
 * Stage 4 gap-audit (BMS_V2_MANIFEST_EXECUTION_LOG.md): for every row in
 * protocol/generated/bms_v1_1_manifest.json, determine an implementation
 * status against the CURRENT repository (protocol/registers.canonical.json
 * + batterylifepo4.yaml + jk_bms.js), and separately run a set of static
 * code-smell greps the governing prompt calls out explicitly (hardcoded
 * `16` constants, manual register lists, duplicated scale/unit literals,
 * write paths without an address read-back, packed writes without a
 * read-modify-write pattern).
 *
 * This performs NO write, and changes NOTHING in batterylifepo4.yaml/
 * jk_bms.js/registers.canonical.json — audit-only, per the governing
 * prompt's explicit "без зміни робочої логіки" for stages 1-4.
 *
 * Status vocabulary (exactly as specified):
 *   implemented | partial | missing | incorrect | unsafe |
 *   blocked_by_protocol | hardware_unverified
 *
 * Run: node protocol/evidence/build_v2_gap_audit.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json"), "utf8"));
const canon = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const nonRegisterDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const yamlSrc = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const jsSrc = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const mockServerPath = path.join(ROOT, "demo", "mock-server.js");
const mockServerSrc = fs.existsSync(mockServerPath) ? fs.readFileSync(mockServerPath, "utf8") : "";

// --- index the current canonical catalog by base address -------------------
const canonByAddr = new Map(); // "0x1000" -> register object
for (const reg of canon.registers) canonByAddr.set(reg.address.toUpperCase(), reg);

const registeredKeys = new Set();
{
  const re = /registerEntity\("([^"]+)"/g;
  let m;
  while ((m = re.exec(jsSrc))) registeredKeys.add(m[1]);
}

const nonRegisterKeys = new Set((nonRegisterDoc.entities || []).map((e) => e.key));

function fieldNamesForAddress(reg) {
  return reg ? reg.fields.map((f) => f.key) : [];
}

function classifyRow(p) {
  const addr = p.address && p.address.base_address ? p.address.base_address.toUpperCase() : null;
  const evidence = { manifest_id: p.id, base_address: addr };

  if (p.classification === "derived") {
    // ESPHome-calculated, not a register at all — implementation check is
    // "does a plausible calculated sensor exist", not an address lookup.
    const derivedHeuristics = { "ESPHome_Power": /native_bms_power|BatWatt|power.*=.*voltage.*\*.*current|current.*\*.*voltage/i };
    const re = derivedHeuristics[p.id];
    const found = re ? re.test(jsSrc) || re.test(yamlSrc) : false;
    return { status: found ? "implemented" : "hardware_unverified", reason: found ? "matching calculated-power logic found in jk_bms.js/yaml" : "no obvious calculated-power expression found by heuristic search — needs manual confirmation, not asserted missing", evidence };
  }

  if (!addr) {
    return { status: "missing", reason: "manifest row has no parseable base address and is not classified 'derived'", evidence };
  }

  const reg = canonByAddr.get(addr);
  if (!reg) {
    if (p.classification === "vendor") {
      return { status: "blocked_by_protocol", reason: "vendor extension absent from official V1.1 — per BMS_V2_MANIFEST_EXECUTION_LOG.md Stage 4 policy, not implemented pending model/firmware-specific hardware confirmation", evidence };
    }
    if (p.classification === "reserved") {
      return { status: "missing", reason: "reserved-in-V1.1 address; not present in current canonical catalog (expected — reserved fields are not implementable, this row exists for completeness tracking only)", evidence };
    }
    return { status: "missing", reason: "address not present anywhere in the current 119-register canonical catalog", evidence };
  }

  evidence.canonical_register_id = reg.register_id;
  evidence.canonical_field_keys = fieldNamesForAddress(reg);

  // Type/width sanity: does ANY field at this address have a plausible
  // matching width? (Coarse — packed multi-field registers are compared at
  // the register level here; per-field byte/bit matching is a Stage-4-B
  // refinement, not attempted by this automated pass to avoid false
  // "incorrect" verdicts from an imperfect address-to-field mapping.)
  const declaredLenBytes = p.type && p.type.length_bytes;
  const canonWidthBytes = reg.register_width_bits ? reg.register_width_bits / 8 : null;
  let widthNote = null;
  if (declaredLenBytes && canonWidthBytes && !(p.address.byte_half || p.address.bit !== null)) {
    // Only compare whole-register widths for non-packed rows — a packed
    // sub-byte/sub-bit row's own length is smaller than its parent
    // register by design, which is not a mismatch.
    if (declaredLenBytes !== canonWidthBytes) {
      widthNote = `manifest declares ${declaredLenBytes} bytes; canonical register_width_bits is ${reg.register_width_bits} (${canonWidthBytes} bytes)`;
    }
  }

  const hasYamlAddress = yamlSrc.includes(`address: ${addr}`) || yamlSrc.includes(`address: ${addr.toLowerCase()}`);
  const anyFieldRegistered = evidence.canonical_field_keys.some((k) => registeredKeys.has(k) || nonRegisterKeys.has(k));

  if (widthNote) {
    evidence.width_note = widthNote;
    return { status: "incorrect", reason: `register present but width mismatch — ${widthNote}`, evidence };
  }

  if (!hasYamlAddress && evidence.canonical_field_keys.length === 0) {
    return { status: "missing", reason: "canonical register exists but has zero fields and no direct YAML address key", evidence };
  }

  if (p.access === "RW" && reg.fields.every((f) => f.effective_access !== "rw")) {
    evidence.declared_rw_but_fail_closed = true;
    return { status: "partial", reason: "RW per V1.1, present in canonical, but effective_access is fail-closed for every field at this address (no write path currently enabled) — correctly cautious, not yet a full RW implementation", evidence };
  }

  // 2026-09-11 self-audit (G9): "unsafe" was in the required status
  // vocabulary but no code path ever produced it — verified by grep before
  // this fix, confirmed as a real coverage hole, not an absence of hazards.
  // A currently-enabled (effective_access=rw) field whose write_safety_class
  // is outside {"normal","n/a"} is, by this project's own fail-closed
  // policy (see docs/adr/0001-protocol-catalog.md), exactly the state that
  // policy says should not exist without a recorded, explicit override —
  // flag it "unsafe" regardless of whether an owner_write_override is
  // present, since the override explains WHY it was allowed, not that the
  // underlying hazard class stopped being hazardous.
  const hazardEnabledFields = reg.fields.filter((f) => f.effective_access === "rw" && f.write_safety_class && !["normal", "n/a"].includes(f.write_safety_class));
  if (hazardEnabledFields.length > 0) {
    evidence.hazard_enabled_fields = hazardEnabledFields.map((f) => ({ key: f.key, write_safety_class: f.write_safety_class, owner_write_override_present: !!f.owner_write_override }));
    return { status: "unsafe", reason: `field(s) with a non-normal write_safety_class are currently write-enabled: ${hazardEnabledFields.map((f) => `${f.key}(${f.write_safety_class})`).join(", ")}`, evidence };
  }

  return { status: "implemented", reason: "address present in canonical catalog with at least one mapped field/entity", evidence };
}

const results = manifest.parameters.map((p) => ({ id: p.id, name_ua: p.name_ua, address: p.address.raw, classification: p.classification, access: p.access, ...classifyRow(p) }));
const manifestById = new Map(manifest.parameters.map((p) => [p.id, p]));

const byStatus = {};
for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

// --- static code-smell greps (explicitly requested) -------------------------
function grepAll(re, src, label) {
  const hits = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(src))) hits.push({ label, index: m.index, match: m[0] });
  return hits;
}

const codeSmells = {
  hardcoded_16_constants: [
    ...grepAll(/\bMAX_CELL_COUNT\s*=\s*16\b/g, jsSrc, "jk_bms.js"),
    ...grepAll(/new (?:Float32Array|Array)\(16\)/g, jsSrc, "jk_bms.js"),
    ...grepAll(/for\s*\([^)]*<\s*16\s*;/g, jsSrc, "jk_bms.js"),
    // 2026-09-11 self-audit (G4): the original pass only grepped jk_bms.js.
    // batterylifepo4.yaml independently hardcodes 16 individual
    // cell_voltage_N/cell_resistance_N ESPHome sensor blocks (N=1..16) —
    // a static-YAML instance of the same 16-cell ceiling, and demo/mock-server.js
    // hardcodes a matching CELL_COUNT=16 for its own seed data.
    ...grepAll(/\bcell_voltage_(1[0-6]|[1-9])\b/g, yamlSrc, "batterylifepo4.yaml").filter((h, i, arr) => arr.findIndex((x) => x.match === h.match) === i),
    ...grepAll(/\bcell_resistance_(1[0-6]|[1-9])\b/g, yamlSrc, "batterylifepo4.yaml").filter((h, i, arr) => arr.findIndex((x) => x.match === h.match) === i),
    ...(mockServerSrc ? grepAll(/\bCELL_COUNT\s*=\s*16\b/g, mockServerSrc, "demo/mock-server.js") : []),
  ],
  manual_register_lists: (() => {
    // NON_REGISTER_ENTITY_IDS is already generator-derived (Stage 1
    // corrective pass) — confirm it stays that way, not re-introduced as a
    // hand list.
    const m = jsSrc.match(/const NON_REGISTER_ENTITY_IDS\s*=\s*(.{0,80})/);
    const nonRegisterEntry = m ? [{ label: "jk_bms.js", match: m[0].trim(), ok: /PROTOCOL_CATALOG\.nonRegisterKeys/.test(m[1]) }] : [];
    // 2026-09-11 self-audit (G8): SETTING_DEFS/CONTROL_DEFS are a second,
    // genuinely hand-maintained list (per-field min/max/step literals),
    // never checked by the original pass. Flagged as a KNOWN, deliberate
    // manual list (not auto-derivable — min/max/step are not columns the
    // manifest currently resolves numerically, see precision_step_minmax_note),
    // not asserted as a defect to silently fix.
    const settingDefsMatch = jsSrc.match(/const SETTING_DEFS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
    const settingDefsCount = settingDefsMatch ? (settingDefsMatch[1].match(/settingDef\(/g) || []).length : 0;
    return {
      non_register_entity_ids: nonRegisterEntry[0] || null,
      setting_defs: {
        label: "jk_bms.js",
        entry_count: settingDefsCount,
        is_hand_maintained: settingDefsCount > 0,
        note: "SETTING_DEFS is a hand-typed array of {key, endpoint, min, max, step} — not generator-derived from the manifest. This is a KNOWN limitation: the manifest's precision/step/minimum/maximum fields are all null (not present as distinct columns in the V2 workbook — see manifest parameter.precision_step_minmax_note), so there is currently no normative source to auto-generate these bounds from. Recorded here for visibility, not silently ignored.",
      },
    };
  })(),
  // 2026-09-11 self-audit (G5): the three checks the governing prompt
  // explicitly requested and the original pass omitted entirely.
  polling_may_overwrite_edited_field: (() => {
    // 2026-09-11 self-audit correction: the first version of this check
    // scanned batterylifepo4.yaml for a `write_lambda` guard token — but
    // this project's actual RW UI does not use ESPHome write_lambda at all
    // (grep confirms exactly 1 unrelated match, in a comment). The real
    // "don't clobber an in-progress edit" mechanism is a `dataset.dirty`
    // flag convention in jk_bms.js's browser-state layer: the diagnostic
    // readout panel is fully rebuilt on every poll (see `preservedDirty`
    // capture-before-rebuild + reapply-after-rebuild pair), while other
    // live-update call sites gate a direct `.value =` assignment behind an
    // explicit `dataset.dirty !== "true"` check. This check verifies both
    // mechanisms are structurally present, and separately lists every
    // `entry.value`-sourced `.value =` assignment site with whether a
    // dataset.dirty guard token appears in the preceding 300 characters —
    // a structural signal, not a data-flow proof (the diagnostic-panel
    // sites are protected by the rebuild/reapply pair instead, and are
    // expected to show "guarded: false" here without being unsafe).
    const hasPreservedDirtyCapture = /const preservedDirty\s*=\s*new Map\(\)/.test(jsSrc);
    const hasPreservedDirtyReapply = /for\s*\(const \[wireId, pending\] of preservedDirty\)/.test(jsSrc);
    const assignSites = [];
    const re = /\.value\s*=\s*String\(entry\.value/g;
    let m;
    while ((m = re.exec(jsSrc))) {
      const windowStart = Math.max(0, m.index - 300);
      const preceding = jsSrc.slice(windowStart, m.index);
      const lineNo = jsSrc.slice(0, m.index).split("\n").length;
      assignSites.push({ line: lineNo, dataset_dirty_guard_nearby: /dataset\.dirty/.test(preceding) });
    }
    return {
      preserved_dirty_capture_and_reapply_present: hasPreservedDirtyCapture && hasPreservedDirtyReapply,
      entry_value_assignment_sites: assignSites,
      note: "preserved_dirty_capture_and_reapply_present=true confirms the full-rebuild diagnostic panel protects pending edits via capture-before/reapply-after rather than a per-assignment guard, so a 'false' dataset_dirty_guard_nearby on one of those specific sites is expected and not a defect by itself — cross-check against the reapply flag before treating any site as unsafe.",
    };
  })(),
  rw_fields_without_address_readback: (() => {
    // Cross-reference: manifest rows classified access=RW and readback_rule
    // NOT one of the "has a real readback" values, restricted to rows this
    // audit already marked implemented/partial (rows marked missing have no
    // write path to critique yet).
    const rows = results.filter((r) => r.access === "RW" && (r.status === "implemented" || r.status === "partial"));
    const withoutReadback = rows.filter((r) => {
      const p = manifestById.get(r.id);
      return p && p.readback_rule === "ack_only_no_readback";
    });
    return {
      rw_implemented_or_partial_count: rows.length,
      without_address_readback_count: withoutReadback.length,
      ids: withoutReadback.map((r) => r.id),
    };
  })(),
  packed_fields_without_read_modify_write: (() => {
    // A packed field (byte_half or bit set) whose address's canonical
    // register has more than one field is a read-modify-write hazard if
    // jk_bms.js's write path for it doesn't reference reading the whole
    // register first. This project's real RMW guarantee lives in the
    // generic Write Transaction Manager (jk_write_tx_core.h, not JS) — this
    // check can only confirm the packed field is *registered* through that
        // manager's per-address correlation, not verify the C++ RMW logic
    // itself is present. Reported as coverage, not a firmware-behavior proof.
    const packedRows = manifest.parameters.filter((p) => p.access === "RW" && p.address && (p.address.byte_half || p.address.bit !== null || p.address.bit_unspecified));
    const notThroughManager = packedRows.filter((p) => {
      const addr = p.address.base_address ? p.address.base_address.toUpperCase() : null;
      const reg = addr ? canonByAddr.get(addr) : null;
      if (!reg) return false; // already reported missing/blocked elsewhere
      const anyFieldRw = reg.fields.some((f) => f.effective_access === "rw");
      return anyFieldRw && !reg.fields.some((f) => f.write_uses_read_modify_write === true);
    });
    return {
      packed_rw_row_count: packedRows.length,
      candidates_without_confirmed_rmw_flag: notThroughManager.map((p) => p.id),
      note: "registers.canonical.json fields do not currently carry an explicit write_uses_read_modify_write flag, so this check cannot positively confirm RMW compliance — it only reports packed RW rows whose canonical register has an effective_access=rw field, as a manual-review worklist. Absence of the flag is not proof of a missing RMW; the flag itself does not yet exist in the schema.",
    };
  })(),
  // 2026-09-11 self-audit (G9, global safety net): scans the ENTIRE
  // canonical catalog directly, independent of manifest row matching, so a
  // hazard-class field would still be caught even if some future canonical
  // register had no corresponding manifest address at all.
  hazard_class_fields_currently_enabled: (() => {
    const hits = [];
    for (const reg of canon.registers) {
      for (const f of reg.fields) {
        if (f.effective_access === "rw" && f.write_safety_class && !["normal", "n/a"].includes(f.write_safety_class)) {
          hits.push({ register_id: reg.register_id, address: reg.address, key: f.key, write_safety_class: f.write_safety_class, owner_write_override_present: !!f.owner_write_override });
        }
      }
    }
    return { count: hits.length, fields: hits, note: "Direct scan of protocol/registers.canonical.json — a non-empty result here means a disruptive/topology/credential/unsupported-class field is currently write-enabled, regardless of manifest coverage. Expected count is 0 under this project's fail-closed policy." };
  })(),
};

const summary = {
  generated_at_note: "audit-only pass; no firmware/UI logic was changed",
  manifest_parameter_count: manifest.parameter_count,
  status_distribution: byStatus,
  code_smells: {
    hardcoded_16_constants: codeSmells.hardcoded_16_constants.map((h) => `${h.label}: ${h.match}`),
    non_register_entity_ids_is_generator_derived: codeSmells.manual_register_lists.non_register_entity_ids,
    setting_defs_manual_list: codeSmells.manual_register_lists.setting_defs,
    polling_may_overwrite_edited_field: codeSmells.polling_may_overwrite_edited_field,
    rw_fields_without_address_readback: codeSmells.rw_fields_without_address_readback,
    packed_fields_without_read_modify_write: codeSmells.packed_fields_without_read_modify_write,
    hazard_class_fields_currently_enabled: codeSmells.hazard_class_fields_currently_enabled,
  },
  self_audit_note: "2026-09-11: extended per critical self-review of the original Stage 4 pass — see BMS_V2_GAP_REMEDIATION_PLAN.md and BMS_V2_MANIFEST_EXECUTION_LOG.md 'Виправлення розривів' section for what changed and why.",
  results,
};

const outPath = path.join(ROOT, "protocol", "generated", "bms_v1_1_gap_audit.json");
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
console.log(`wrote ${path.relative(ROOT, outPath)}`);
console.log("status distribution:", JSON.stringify(byStatus));
console.log("hardcoded '16' constants found:", codeSmells.hardcoded_16_constants.length);
