"use strict";
/*
 * Semantic invariant checks for the protocol catalog (spec sections 6, 10,
 * 14 criterion 6/7/10). Shared by tools/protocol/generate.js (refuses to
 * generate anything from an invalid canonical source — spec section 9:
 * "invalid canonical source не генерує часткові outputs") and by
 * test/register_catalog/validate.js (the strict validator).
 *
 * check(registerDoc, nonRegisterDoc, repoRoot) returns an array of
 * { code, path, message } — empty means the catalog is semantically valid.
 * `code` is a short stable identifier so negative-fixture tests can assert
 * WHICH rule fired, not just that something failed.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function issue(code, p, message) {
  return { code, path: p, message };
}

function parseHex(s) {
  return s == null ? null : parseInt(s, 16);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function deriveVerificationStatus(field, evidence, sources) {
  const implemented = ["implemented", "partially_implemented"].includes(field.implementation_status || "implemented");
  const independent = new Set();
  let hasImplementationFamily = false;
  let hasUnknown = false;
  for (const citation of evidence) {
    const source = sources.get(citation.source_id);
    if (!source || source.status !== "available") continue;
    if (source.derivation_group === "syssi_implementation_family") hasImplementationFamily = true;
    if (source.provenance_status === "unknown") { hasUnknown = true; continue; }
    independent.add(source.derivation_group);
  }
  const external = new Set([...independent].filter((g) => g !== "syssi_implementation_family"));
  if (!implemented) return evidence.length ? "single_source" : "unknown_variant";
  if (external.size >= 2) return "confirmed";
  if (external.size === 1) return "corroborated_with_limitations";
  if (hasImplementationFamily) return "implementation_only_unverified";
  if (hasUnknown) return "single_source";
  return "unknown_variant";
}

function check(registerDoc, nonRegisterDoc, repoRoot) {
  const errors = [];
  const registers = registerDoc.registers;
  const nonRegisterEntities = nonRegisterDoc.entities;

  const registerIds = new Map(); // register_id -> register
  const allFieldKeys = new Map(); // key -> {kind, owner}
  const fieldsByRegister = new Map(); // register_id -> [fields]

  // --- structural pass: uniqueness -----------------------------------
  for (const reg of registers) {
    if (registerIds.has(reg.register_id)) {
      errors.push(issue("DUPLICATE_REGISTER_ID", `registers[${reg.register_id}]`,
        `register_id "${reg.register_id}" is declared more than once`));
    }
    registerIds.set(reg.register_id, reg);
    fieldsByRegister.set(reg.register_id, reg.fields);

    for (const f of reg.fields) {
      if (allFieldKeys.has(f.key)) {
        errors.push(issue("DUPLICATE_FIELD_KEY", `fields[${f.key}]`,
          `field key "${f.key}" is declared more than once (in "${allFieldKeys.get(f.key).owner}" and "${reg.register_id}")`));
      } else {
        allFieldKeys.set(f.key, { kind: "register_field", owner: reg.register_id });
      }
    }
  }
  for (const e of nonRegisterEntities) {
    if (allFieldKeys.has(e.key)) {
      const prior = allFieldKeys.get(e.key);
      errors.push(issue("REGISTER_NONREGISTER_KEY_COLLISION", `entities[${e.key}]`,
        `non-register key "${e.key}" collides with a ${prior.kind} from "${prior.owner}" — a BMS register key ` +
        `leaking into the non-register dataset (or vice versa) violates the physical/calculated separation (spec section 5.4)`));
    } else {
      allFieldKeys.set(e.key, { kind: "non_register_entity", owner: e.key });
    }
  }

  // --- address/geometry checks ----------------------------------------
  const addressToRegisterIds = new Map();
  for (const reg of registers) {
    const list = addressToRegisterIds.get(reg.address) || [];
    list.push(reg.register_id);
    addressToRegisterIds.set(reg.address, list);

    const width = reg.register_width_bits;
    const fullMask = width <= 32 ? (width === 32 ? 0xFFFFFFFF : (1 << width) - 1) : null;

    // Register geometry invariants (spec Крок B.3 / Крок I "Register geometry").
    if (width <= 0) {
      errors.push(issue("REGISTER_WIDTH_NOT_POSITIVE", `registers[${reg.register_id}]`,
        `register_width_bits (${width}) must be positive`));
    } else if (width % 8 !== 0) {
      errors.push(issue("REGISTER_WIDTH_NOT_BYTE_MULTIPLE", `registers[${reg.register_id}]`,
        `register_width_bits (${width}) is not a multiple of 8`));
    }
    if (width > 0 && reg.word_count * 16 !== width) {
      errors.push(issue("REGISTER_WORD_COUNT_MISMATCH", `registers[${reg.register_id}]`,
        `word_count (${reg.word_count}) * 16 = ${reg.word_count * 16}, does not equal register_width_bits (${width}) — ` +
        `this is the exact class of bug CODEX_STAGE_1_REVIEW.md P0-1 found in the 128-bit passcode register`));
    }
    if (reg.payload_bytes !== reg.word_count * 2) {
      errors.push(issue("REGISTER_PAYLOAD_BYTES_MISMATCH", `registers[${reg.register_id}]`,
        `payload_bytes (${reg.payload_bytes}) must equal word_count * 2 (${reg.word_count * 2})`));
    }
    if (reg.word_count === 1 && reg.word_order !== "single_word") {
      errors.push(issue("WORD_ORDER_MISMATCH", `registers[${reg.register_id}]`,
        `a 1-word register must declare word_order "single_word", got "${reg.word_order}"`));
    }
    if (reg.word_count === 2 && reg.word_order !== "high_word_first") {
      errors.push(issue("WORD_ORDER_MISMATCH", `registers[${reg.register_id}]`,
        `a 2-word numeric register must declare an explicit word_order ("high_word_first"), got "${reg.word_order}"`));
    }
    if (reg.word_count > 2 && reg.word_order !== "sequential_bytes") {
      errors.push(issue("WORD_ORDER_MISMATCH", `registers[${reg.register_id}]`,
        `a >2-word register must declare word_order "sequential_bytes" (byte-string/ASCII geometry), got "${reg.word_order}"`));
    }

    // per-field geometry
    const coverage = []; // list of [loMaskBit, hiMaskBit] covered ranges, for overlap detection
    for (const f of reg.fields) {
      if (f.field_width_bits > width) {
        errors.push(issue("FIELD_WIDTH_EXCEEDS_REGISTER", `fields[${f.key}]`,
          `field_width_bits (${f.field_width_bits}) exceeds register_width_bits (${width})`));
      }
      if ((f.shift || 0) + f.field_width_bits > width) {
        errors.push(issue("FIELD_RANGE_EXCEEDS_REGISTER", `fields[${f.key}]`,
          `shift + field_width_bits exceeds the ${width}-bit register`));
      }
      if (f.byte_offset !== null && f.byte_offset + Math.ceil(f.field_width_bits / 8) > reg.payload_bytes) {
        errors.push(issue("FIELD_BYTE_OFFSET_EXCEEDS_PAYLOAD", `fields[${f.key}]`,
          `byte_offset/field width exceed payload_bytes (${reg.payload_bytes})`));
      }
      if (fieldsByRegister.get(f.parent_register_id) !== reg.fields) {
        // parent_register_id must literally point back at THIS register
      }
      if (f.parent_register_id !== reg.register_id) {
        errors.push(issue("FIELD_UNKNOWN_PARENT", `fields[${f.key}]`,
          `field "${f.key}" declares parent_register_id "${f.parent_register_id}" but is nested under register "${reg.register_id}"`));
      }

      if (f.mask !== null) {
        const maskNum = parseHex(f.mask);
        if (f.byte_offset !== null && f.field_width_bits === 8) {
          const expectedShift = width - 8 - f.byte_offset * 8;
          if (f.shift !== expectedShift) {
            errors.push(issue("FIELD_SHIFT_MISMATCH", `fields[${f.key}]`,
              `field "${f.key}" byte_offset=${f.byte_offset} implies shift=${expectedShift} for a ${width}-bit register, got shift=${f.shift}`));
          }
        }
        const expectedMask = ((f.field_width_bits >= 32 ? 0xFFFFFFFF : (1 << f.field_width_bits) - 1)) << (f.shift || 0);
        if (maskNum !== (expectedMask >>> 0)) {
          errors.push(issue("FIELD_MASK_MISMATCH", `fields[${f.key}]`,
            `field "${f.key}" mask ${f.mask} does not equal the expected mask 0x${(expectedMask >>> 0).toString(16).toUpperCase()} ` +
            `derived from field_width_bits=${f.field_width_bits} and shift=${f.shift}`));
        }
        coverage.push([maskNum, f.key, f.projection_of || null]);
      } else if (f.field_width_bits === width && reg.fields.length === 1) {
        // single full-width field with no mask — fine, whole register is one field
      }

      if (f.signedness === "signed" && !/^(S8|S16|S32|F32)$/.test(f.wire_type)) {
        errors.push(issue("SIGNEDNESS_WIRE_TYPE_MISMATCH", `fields[${f.key}]`,
          `field "${f.key}" is signed but wire_type is "${f.wire_type}"`));
      }
      if (f.signedness === "unsigned" && /^(S8|S16|S32)$/.test(f.wire_type)) {
        errors.push(issue("SIGNEDNESS_WIRE_TYPE_MISMATCH", `fields[${f.key}]`,
          `field "${f.key}" is unsigned but wire_type is "${f.wire_type}"`));
      }

      if (f.minimum !== null && f.maximum !== null && f.minimum > f.maximum) {
        errors.push(issue("INVALID_BOUNDS", `fields[${f.key}]`, `field "${f.key}" has minimum (${f.minimum}) > maximum (${f.maximum})`));
      }
      if (f.step !== null && f.step !== undefined && f.step <= 0) {
        errors.push(issue("INVALID_STEP", `fields[${f.key}]`, `field "${f.key}" has non-positive step (${f.step})`));
      }
      if (f.step !== null && f.scale) {
        const rawStep = f.step / Math.abs(f.scale);
        if (Math.abs(rawStep - Math.round(rawStep)) > 1e-7) {
          errors.push(issue("STEP_NOT_RAW_REPRESENTABLE", `fields[${f.key}]`,
            `step (${f.step}) does not map to an integral raw increment at scale ${f.scale}`));
        }
        const decimalPlaces = (value) => {
          const text = Number(value).toString().toLowerCase();
          if (text.includes("e-")) return Number(text.split("e-")[1]);
          return (text.split(".")[1] || "").length;
        };
        const requiredPrecision = Math.max(decimalPlaces(f.step), decimalPlaces(f.scale));
        if (f.decimal_precision < requiredPrecision) {
          errors.push(issue("DECIMAL_PRECISION_TOO_LOW", `fields[${f.key}]`,
            `decimal_precision ${f.decimal_precision} cannot represent scale/step precision ${requiredPrecision}`));
        }
      }
      if (f.scale === 0) {
        errors.push(issue("SCALE_ZERO", `fields[${f.key}]`, `field "${f.key}" has scale 0 — a zero scale can never round-trip a raw wire value`));
      }
      if (!Number.isFinite(f.scale)) {
        errors.push(issue("SCALE_NOT_FINITE", `fields[${f.key}]`, `field "${f.key}" has a non-finite scale`));
      }

      // Bounds must be representable in the field's own raw wire width/
      // signedness after inverting scale/offset (spec Крок I "Numeric
      // semantics": "bounds представимі wire width/signedness після
      // inverse transform").
      if (f.minimum !== null && f.maximum !== null && f.scale) {
        const rawMin = (f.minimum - f.offset) / f.scale;
        const rawMax = (f.maximum - f.offset) / f.scale;
        const widthBits = f.field_width_bits;
        let rawLo; let rawHi;
        if (f.signedness === "signed") {
          rawLo = -(2 ** (widthBits - 1));
          rawHi = 2 ** (widthBits - 1) - 1;
        } else {
          rawLo = 0;
          rawHi = 2 ** widthBits - 1;
        }
        // Allow a small epsilon for floating point scale/offset round-trip.
        const eps = 1e-6 * Math.max(1, Math.abs(rawHi));
        if (Number.isFinite(rawMin) && (rawMin < rawLo - eps || rawMin > rawHi + eps)) {
          errors.push(issue("BOUNDS_NOT_REPRESENTABLE", `fields[${f.key}]`,
            `field "${f.key}" minimum (${f.minimum}) inverts to raw ${rawMin}, outside the field's own ` +
            `${widthBits}-bit ${f.signedness} representable range [${rawLo}, ${rawHi}]`));
        }
        if (Number.isFinite(rawMax) && (rawMax < rawLo - eps || rawMax > rawHi + eps)) {
          errors.push(issue("BOUNDS_NOT_REPRESENTABLE", `fields[${f.key}]`,
            `field "${f.key}" maximum (${f.maximum}) inverts to raw ${rawMax}, outside the field's own ` +
            `${widthBits}-bit ${f.signedness} representable range [${rawLo}, ${rawHi}]`));
        }
      }

      // A field's mask must never extend beyond ITS OWN register's full
      // width mask (uses the fullMask computed above — previously computed
      // but never checked against anything, per CODEX_STAGE_1_REVIEW.md P1-2).
      if (f.mask !== null && fullMask !== null) {
        const maskNum = parseHex(f.mask);
        if ((maskNum & ~fullMask) !== 0) {
          errors.push(issue("FIELD_MASK_EXCEEDS_REGISTER_WIDTH", `fields[${f.key}]`,
            `field "${f.key}" mask ${f.mask} has bits set outside register ${reg.address}'s own ` +
            `${width}-bit full mask 0x${fullMask.toString(16).toUpperCase()}`));
        }
      }

      // A write function/entity must not exist for an effective-read-only
      // field (spec Крок I "Access and safety": "write function не існує
      // для effective read-only field").
      if (f.effective_access !== "rw" && f.esphome_write_entity_id !== null) {
        errors.push(issue("WRITE_ENTITY_ON_EFFECTIVE_READONLY", `fields[${f.key}]`,
          `field "${f.key}" has effective_access "${f.effective_access}" but still declares ` +
          `esphome_write_entity_id "${f.esphome_write_entity_id}" — an effectively-blocked field must not name a live write entity`));
      }

      // Boolean/enum editors must not exist without a fully confirmed
      // enum/boolean semantics (spec Крок I "Enum/bitfield semantics").
      if ((f.editor_kind === "toggle" || f.editor_kind === "enum_select") && !f.enum_map) {
        errors.push(issue("ENUM_EDITOR_WITHOUT_SEMANTICS", `fields[${f.key}]`,
          `field "${f.key}" has editor_kind "${f.editor_kind}" but no enum_map — a boolean/enum editor requires confirmed semantics`));
      }
      if (f.enum_map) {
        const values = Object.values(f.enum_map);
        if (new Set(values).size !== values.length) {
          errors.push(issue("ENUM_DUPLICATE_VALUE", `fields[${f.key}]`, `field "${f.key}" enum_map has duplicate values`));
        }
        const reserved = new Set((f.reserved_values || []).map(String));
        for (const k of Object.keys(f.enum_map)) {
          const raw = Number(k);
          const rawMin = f.signedness === "signed" ? -(2 ** (f.field_width_bits - 1)) : 0;
          const rawMax = f.signedness === "signed" ? 2 ** (f.field_width_bits - 1) - 1 : 2 ** f.field_width_bits - 1;
          if (!Number.isInteger(raw) || raw < rawMin || raw > rawMax) {
            errors.push(issue("ENUM_KEY_OUT_OF_RANGE", `fields[${f.key}]`,
              `enum key "${k}" is not an integer representable by the ${f.field_width_bits}-bit ${f.signedness} field`));
          }
          if (reserved.has(k)) {
            errors.push(issue("RESERVED_ENUM_COLLISION", `fields[${f.key}]`,
              `field "${f.key}" enum_map key "${k}" collides with a declared reserved_values entry`));
          }
        }
        if (f.unknown_code_policy !== "preserve_raw_and_render_unknown") {
          errors.push(issue("ENUM_UNKNOWN_POLICY_MISSING", `fields[${f.key}]`,
            `enum fields must preserve and visibly render unknown raw codes`));
        }
      } else if (f.unknown_code_policy !== null) {
        errors.push(issue("ENUM_UNKNOWN_POLICY_WITHOUT_ENUM", `fields[${f.key}]`,
          `unknown_code_policy is only valid with enum_map`));
      }

      // --- fail-closed write policy (Stage 1 Completion Pass, CODEX
      // P0-2/§6.3): "corroborated_with_limitations" used to be treated as
      // safe-enough for effective_access "rw" (only "implementation_only_
      // unverified"/"conflict"/"unknown_variant"/"single_source" were
      // unsafe). That let 2 heating fields (and would let cell_count) stay
      // write-enabled on nothing more than one non-independent corroborating
      // group. Per spec §6.1 ("Відсутність будь-якого required write claim
      // автоматично встановлює effective_access: r" — and §6.3 explicitly:
      // a corroborated_with_limitations field is NOT writable without its
      // own separately-proven write-readiness verdict, which this catalog
      // does not yet model) the ONLY verification_status that may carry
      // effective_access "rw" is "confirmed" — i.e. 2+ INDEPENDENT,
      // known-or-partially-known-provenance evidence groups (see
      // reconcile_evidence.py). No field in this catalog currently reaches
      // "confirmed" (no official docs; workbook provenance is unknown;
      // upstream and this project's implementation share one derivation
      // group) — so effective_access "rw" is currently unreachable for
      // every field until a second genuinely independent source exists.
      // --- explicit owner-authorized override (repo-owner risk acceptance,
      // 2026-09-10, user-directed reversal of the fail-closed default for a
      // named set of fields on their own hardware) --------------------------
      // owner_write_override is a HAND-WRITTEN, human-authored field (never
      // computed/derived) that lets the repo owner accept the residual
      // evidence gap for one specific field and re-enable its real write
      // path, without EVER forging verification_status itself — the field
      // keeps reporting its true, unverified evidence status (spec's
      // honesty invariant is preserved); only the write-enablement decision
      // changes, and it is fully attributed (authorized_by/date/rationale,
      // schema-enforced) and only valid on a field the protocol itself
      // declares "rw" (checked below).
      if (f.owner_write_override && f.access !== "rw") {
        errors.push(issue("OWNER_OVERRIDE_ON_NON_RW", `fields[${f.key}]`,
          `field "${f.key}" has an owner_write_override but declared access is "${f.access}", not "rw" — ` +
          `an owner override may only re-enable a write path the protocol itself declares, never invent one`));
      }
      const ownerAuthorized = !!(f.owner_write_override && f.owner_write_override.authorized === true && f.access === "rw");
      const unsafeStatus = f.verification_status !== "confirmed" && !ownerAuthorized;
      if (unsafeStatus && f.effective_access === "rw") {
        errors.push(issue("UNVERIFIED_FIELD_WRITE_ENABLED", `fields[${f.key}]`,
          `field "${f.key}" has verification_status "${f.verification_status}" (not "confirmed") but effective_access "rw" — ` +
          `only a field independently confirmed by 2+ non-derivative sources, or one carrying an explicit owner_write_override, may carry write capability (spec §6.1)`));
      }
      if (f.effective_access === "rw" && f.access !== "rw") {
        errors.push(issue("EFFECTIVE_ACCESS_EXCEEDS_DECLARED", `fields[${f.key}]`,
          `field "${f.key}" has effective_access "rw" but declared access "${f.access}"`));
      }
      // An unresolved dynamic_dependency is the same class of risk as an
      // unconfirmed verification_status (an "own semantics unconfirmed"
      // rule with depends_on_field: null, or a genuine cross-field
      // dependency like the dry-contact value fields on their own
      // trigger_source) — ownerAuthorized may bypass it exactly as it
      // bypasses unsafeStatus above, for the same reason: the owner is
      // accepting the interpretation risk themselves, not this catalog
      // asserting the dependency is actually resolved.
      if (f.dynamic_dependency && f.dynamic_dependency.resolved === false && f.effective_access === "rw" && !ownerAuthorized) {
        errors.push(issue("UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED", `fields[${f.key}]`,
          `field "${f.key}" has an unresolved dynamic_dependency but effective_access "rw" (spec section 8)`));
      }

      // packed sibling symmetry
      for (const sib of f.packed_siblings) {
        const sibField = allFieldKeys.get(sib);
        if (!sibField) {
          errors.push(issue("PACKED_SIBLING_NOT_FOUND", `fields[${f.key}]`,
            `field "${f.key}" declares packed sibling "${sib}" which does not exist in the catalog`));
          continue;
        }
      }

      // --- read-only projection validation (2026-09-20, user-directed
      // generalized projection architecture -- closes the OVERLAPPING_MASKS
      // architectural blocker previously found at 0x12D0/0x12A0). A field
      // with projection_of set is a READ-ONLY VIEW into an already-owned
      // physical field's own already-fetched payload -- it does NOT own any
      // wire traffic of its own, never appears as its own Modbus block, and
      // can NEVER carry write capability, regardless of what its own
      // evidence would otherwise permit. Overlap with its declared parent
      // is the ONLY overlap this schema permits anywhere (enforced in the
      // overlap-detection loop below, which now consults projection_of);
      // every other invariant is checked here.
      if (f.projection_of !== null && f.projection_of !== undefined) {
        const parent = reg.fields.find((pf) => pf.key === f.projection_of);
        if (!parent) {
          errors.push(issue("PROJECTION_PARENT_NOT_FOUND", `fields[${f.key}]`,
            `field "${f.key}" declares projection_of "${f.projection_of}", which does not exist as a field on the SAME register ${reg.address} -- a projection's parent must be a sibling field, not a cross-register or nonexistent reference`));
        } else {
          if (parent.projection_of !== null && parent.projection_of !== undefined) {
            errors.push(issue("PROJECTION_OF_PROJECTION", `fields[${f.key}]`,
              `field "${f.key}" projects from "${f.projection_of}", which is ITSELF a projection (of "${parent.projection_of}") -- projection chains are not allowed, a projection's parent must be a physical field`));
          }
          if (f.mask !== null && parent.mask !== null) {
            const ownMask = parseHex(f.mask);
            const parentMask = parseHex(parent.mask);
            if ((ownMask & ~parentMask) !== 0) {
              errors.push(issue("PROJECTION_MASK_NOT_SUBSET_OF_PARENT", `fields[${f.key}]`,
                `field "${f.key}"'s mask ${f.mask} is not fully contained within its declared parent "${f.projection_of}"'s own mask ${parent.mask} -- a projection may only view bits its parent's own physical read already covers`));
            }
          }
        }
        if (f.effective_access !== "r") {
          errors.push(issue("PROJECTION_EFFECTIVE_ACCESS_NOT_R", `fields[${f.key}]`,
            `field "${f.key}" is a projection (projection_of "${f.projection_of}") but effective_access is "${f.effective_access}", not "r" -- a projection can never carry write capability, independent of its own evidence status`));
        }
        if (f.esphome_write_entity_id !== null) {
          errors.push(issue("PROJECTION_WRITE_ENTITY_PRESENT", `fields[${f.key}]`,
            `field "${f.key}" is a projection but declares esphome_write_entity_id "${f.esphome_write_entity_id}" -- a projection must never own a write entity`));
        }
        if (f.write_uses_read_modify_write === true) {
          errors.push(issue("PROJECTION_DECLARES_RMW", `fields[${f.key}]`,
            `field "${f.key}" is a projection but declares write_uses_read_modify_write=true -- a projection never has a write path of its own to merge into`));
        }
      }

      // --- Stage 4 write_uses_read_modify_write geometry invariant
      // (typed-petting-puzzle plan §5 Phase 2, rules 1-3). This flag must
      // be MECHANICALLY DERIVED from register/field geometry, never
      // hand-guessed: true iff this field does NOT occupy the whole
      // physical register alone (it has packed_siblings and/or its own
      // field_width_bits is narrower than the register's own
      // register_width_bits) -- such a field's write MUST go through a
      // real read-modify-write merge, never a blind full-register write
      // (rule 2: a packed field's own mask can therefore never equal the
      // register's full-width mask -- if it did, it wouldn't actually be
      // packed). false iff this field alone spans the entire register
      // (no siblings, exact width match) -- a full-width write may safely
      // replace the whole register with no merge step, and must not be
      // marked RMW without that being mechanically true (rule 3: no
      // guessed/asserted RMW on a field that doesn't need it). Checked
      // bidirectionally so neither a false positive nor a false negative
      // can silently drift from the real geometry.
      {
        // A projection never owns a write path of its own to merge into
        // (see PROJECTION_DECLARES_RMW above) -- it derives false
        // regardless of its own narrow width/siblings, which describe its
        // READ view into the parent's payload, not anything it could ever
        // write.
        const isProjection = f.projection_of !== null && f.projection_of !== undefined;
        const derivedRmw = !isProjection && ((f.packed_siblings && f.packed_siblings.length > 0) || f.field_width_bits !== reg.register_width_bits);
        if (typeof f.write_uses_read_modify_write !== "boolean") {
          errors.push(issue("WRITE_RMW_FLAG_MISMATCH", `fields[${f.key}]`,
            `field "${f.key}" has no boolean write_uses_read_modify_write (fail-closed: an unknown/missing value must never silently default)`));
        } else if (f.write_uses_read_modify_write !== derivedRmw) {
          errors.push(issue("WRITE_RMW_FLAG_MISMATCH", `fields[${f.key}]`,
            `field "${f.key}" has write_uses_read_modify_write=${f.write_uses_read_modify_write}, but geometry derives ${derivedRmw} ` +
            `(packed_siblings=${JSON.stringify(f.packed_siblings)}, field_width_bits=${f.field_width_bits}, register_width_bits=${reg.register_width_bits}) -- ` +
            `this flag must be mechanically derived from geometry, never hand-set`));
        }
        if (f.write_uses_read_modify_write === true && f.mask !== null) {
          const fullRegMask = reg.register_width_bits >= 32 ? 0xFFFFFFFF : ((1 << reg.register_width_bits) - 1);
          if ((parseHex(f.mask) >>> 0) === (fullRegMask >>> 0)) {
            errors.push(issue("WRITE_RMW_PACKED_FULL_MASK", `fields[${f.key}]`,
              `field "${f.key}" is marked write_uses_read_modify_write=true but its own mask ${f.mask} covers the ENTIRE ${reg.register_width_bits}-bit register -- a genuinely packed field must own only a strict subset of the register's bits, or it isn't actually packed and a blind full-register write would be safe (and required, per rule 3)`));
          }
        }
      }
    }

    // overlap detection across this register's fields -- a projection's
    // mask is EXPECTED and REQUIRED to overlap its own declared parent's
    // mask (that overlap is the entire point: it is the same physical bits,
    // read once, viewed twice); any OTHER overlap (two physical fields, two
    // sibling projections of the same parent, a projection overlapping a
    // field it does not declare as its parent) is still a real error.
    for (let i = 0; i < coverage.length; i += 1) {
      for (let j = i + 1; j < coverage.length; j += 1) {
        if ((coverage[i][0] & coverage[j][0]) !== 0) {
          const [, keyI, projOfI] = coverage[i];
          const [, keyJ, projOfJ] = coverage[j];
          const isDeclaredProjectionPair = projOfI === keyJ || projOfJ === keyI;
          if (!isDeclaredProjectionPair) {
            errors.push(issue("OVERLAPPING_MASKS", `registers[${reg.register_id}]`,
              `fields "${keyI}" and "${keyJ}" in register ${reg.address} have overlapping masks, and neither declares the other as its projection_of parent`));
          }
        }
      }
    }

    // Uncovered bits must be EXPLICITLY documented as reserved/unknown in
    // the register's own safety_notes, or this is an error (spec Крок I:
    // "uncovered bits або описані як reserved, або викликають помилку").
    if (coverage.length > 0 && fullMask !== null) {
      const unionMask = coverage.reduce((acc, [m]) => acc | m, 0) >>> 0;
      if (unionMask !== fullMask) {
        const notesLower = (reg.safety_notes || "").toLowerCase();
        const documented = notesLower.includes("reserved") || notesLower.includes("unknown");
        if (!documented) {
          errors.push(issue("UNCOVERED_BITS_UNDOCUMENTED", `registers[${reg.register_id}]`,
            `register ${reg.address}'s fields cover mask 0x${unionMask.toString(16).toUpperCase()} of the full ` +
            `0x${fullMask.toString(16).toUpperCase()} — the uncovered bits are not documented as reserved/unknown in safety_notes`));
        }
      }
    }
  }

  // Mapping uniqueness (spec Крок I "Mapping"): esphome_read_entity_id must
  // be unique across fields where present (nulls excluded — many R fields
  // legitimately share "no distinct read entity id beyond the register").
  {
    const seenReadIds = new Map();
    for (const reg of registers) {
      for (const f of reg.fields) {
        if (!f.esphome_read_entity_id) continue;
        if (seenReadIds.has(f.esphome_read_entity_id)) {
          errors.push(issue("ESPHOME_READ_ENTITY_ID_COLLISION", `fields[${f.key}]`,
            `esphome_read_entity_id "${f.esphome_read_entity_id}" is also used by field "${seenReadIds.get(f.esphome_read_entity_id)}"`));
        } else {
          seenReadIds.set(f.esphome_read_entity_id, f.key);
        }
      }
    }
  }

  // duplicate address without an explicit packed/alias relationship is only
  // a problem when the SAME address appears under two UNRELATED register_ids
  // (this catalog always merges packed siblings into ONE register_id per
  // address, so any duplicate here is a real authoring error).
  for (const [addr, ids] of addressToRegisterIds) {
    if (ids.length > 1) {
      errors.push(issue("DUPLICATE_ADDRESS", `registers[${addr}]`,
        `address ${addr} is declared by ${ids.length} separate register_ids: ${ids.join(", ")} — packed sub-fields of one register must share a single register_id`));
    }
  }

  // packed sibling symmetry (A->B implies B->A) + same parent register
  for (const reg of registers) {
    for (const f of reg.fields) {
      for (const sib of f.packed_siblings) {
        const sibField = allFieldKeys.get(sib);
        if (!sibField || sibField.kind !== "register_field") continue;
        const sibReg = registerIds.get(sibField.owner);
        const sibFieldObj = sibReg.fields.find((x) => x.key === sib);
        if (sibFieldObj && !sibFieldObj.packed_siblings.includes(f.key)) {
          errors.push(issue("ASYMMETRIC_PACKED_SIBLING", `fields[${f.key}]`,
            `field "${f.key}" lists "${sib}" as a packed sibling, but "${sib}" does not list "${f.key}" back`));
        }
        if (sibFieldObj && sibReg.register_id !== reg.register_id) {
          errors.push(issue("PACKED_SIBLING_DIFFERENT_REGISTER", `fields[${f.key}]`,
            `field "${f.key}" (register ${reg.register_id}) and its packed sibling "${sib}" (register ${sibReg.register_id}) do not share the same parent register`));
        }
      }
    }
  }

  // --- authoritative source manifest / citation foreign keys ------------
  const sources = new Map();
  try {
    const sourceDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, "protocol", "evidence", "sources.json"), "utf8"));
    for (const source of sourceDoc.sources || []) {
      if (sources.has(source.source_id)) {
        errors.push(issue("DUPLICATE_SOURCE_ID", "protocol/evidence/sources.json", `duplicate source_id "${source.source_id}"`));
      }
      sources.set(source.source_id, source);
      if (source.status === "available" && !source.fingerprint) {
        errors.push(issue("AVAILABLE_SOURCE_WITHOUT_FINGERPRINT", `sources[${source.source_id}]`, "available source must have a content/revision fingerprint"));
      }
      if (source.local_copy_path && source.local_copy_sha256) {
        const localPath = path.join(repoRoot, source.local_copy_path);
        if (!fs.existsSync(localPath) || sha256File(localPath) !== source.local_copy_sha256) {
          errors.push(issue("SOURCE_HASH_MISMATCH", `sources[${source.source_id}]`, `local_copy_sha256 does not match ${source.local_copy_path}`));
        }
      }
      if (source.document && source.document_sha256) {
        const documentPath = path.join(repoRoot, source.document);
        if (!fs.existsSync(documentPath) || sha256File(documentPath) !== source.document_sha256) {
          errors.push(issue("SOURCE_HASH_MISMATCH", `sources[${source.source_id}]`, `document_sha256 does not match ${source.document}`));
        }
      }
    }
  } catch (e) {
    errors.push(issue("SOURCE_MANIFEST_UNREADABLE", "protocol/evidence/sources.json", e.message));
  }

  function validateCitationList(evidenceList, ownerPath) {
    for (const citation of evidenceList) {
      const source = sources.get(citation.source_id);
      if (!source) {
        errors.push(issue("UNKNOWN_SOURCE_ID", ownerPath, `unknown source_id "${citation.source_id}"`));
        continue;
      }
      if (source.status !== "available") {
        errors.push(issue("UNAVAILABLE_SOURCE_CITED", ownerPath, `source "${citation.source_id}" is unavailable and cannot be evidence`));
      }
      if (citation.source_fingerprint !== source.fingerprint) {
        errors.push(issue("CITATION_SOURCE_FINGERPRINT_MISMATCH", ownerPath, `citation fingerprint for "${citation.source_id}" does not match sources.json`));
      }
      if (citation.derivation_group !== source.derivation_group) {
        errors.push(issue("CITATION_DERIVATION_GROUP_MISMATCH", ownerPath, `citation derivation_group must be derived from sources.json`));
      }
      const supported = new Set(source.claims_supported || []);
      for (const claimType of citation.claim_types || []) {
        if (!supported.has(claimType)) {
          errors.push(issue("SOURCE_UNSUPPORTED_CLAIM_TYPE", ownerPath, `source "${citation.source_id}" does not support claim type "${claimType}"`));
        }
      }
    }
  }
  for (const reg of registers) {
    validateCitationList(reg.evidence, `registers[${reg.register_id}].evidence`);
    for (const f of reg.fields) {
      validateCitationList(f.evidence, `fields[${f.key}].evidence`);
      const derived = deriveVerificationStatus(f, f.evidence, sources);
      if (f.verification_status !== derived) {
        errors.push(issue("FORGED_VERIFICATION_STATUS", `fields[${f.key}]`, `stored status "${f.verification_status}" differs from derived verdict "${derived}"`));
      }
      const ownerAuthorized = !!(f.owner_write_override && f.owner_write_override.authorized === true && f.access === "rw");
      const derivedAccess = f.access === "rw" && (derived === "confirmed" || ownerAuthorized) &&
        (ownerAuthorized || !(f.dynamic_dependency && f.dynamic_dependency.resolved === false))
        ? "rw" : (f.access === "rw" ? "r" : f.effective_access);
      if (f.access === "rw" && f.effective_access !== derivedAccess) {
        errors.push(issue("FORGED_EFFECTIVE_ACCESS", `fields[${f.key}]`, `stored effective_access "${f.effective_access}" differs from derived policy "${derivedAccess}"`));
      }

      // Stage 4 (typed-petting-puzzle plan §5 Phase 2, rule 5): a real
      // write path needs a proven safe operating range (minimum+maximum)
      // or an enum_map -- a writable field with neither is a genuine,
      // separate evidence gap (the safe VALUES a write may take were never
      // established, even if the address/type/access were). Never guessed:
      // generate_write_registry.js independently refuses to generate an
      // entity for such a field; this is the same rule enforced as a hard
      // schema-level invariant so it can never be bypassed by a future
      // generator that forgets to check it.
      if (f.effective_access === "rw" && f.enum_map === null && (f.minimum === null || f.maximum === null)) {
        errors.push(issue("WRITE_ENABLED_WITHOUT_RANGE_OR_ENUM", `fields[${f.key}]`,
          `field "${f.key}" has effective_access "rw" but neither a complete minimum/maximum range nor an enum_map -- a real write path cannot validate what values are safe to send`));
      }

      // Stage 4 Phase 2: an owner_write_override is risk ACCEPTANCE for an
      // evidence gap, never a way to write to a field the protocol itself
      // has no known write mechanism for at all -- unsupported stays
      // unsupported regardless of who accepts what risk.
      if (ownerAuthorized && f.write_safety_class === "unsupported") {
        errors.push(issue("OWNER_OVERRIDE_ON_UNSUPPORTED_CLASS", `fields[${f.key}]`,
          `field "${f.key}" has an authorized owner_write_override but write_safety_class "unsupported" -- an override can accept an evidence-gap risk, never invent a write mechanism the protocol doesn't have`));
      }

      // Stage 4 production-integration audit (2026-09-21, user-directed):
      // a field can never be effective_access "rw" unless its OWN physical
      // register carries a real, PDF/workbook-evidenced write_function --
      // "the field is writable" is meaningless if the register it lives on
      // was never actually confirmed writable at the wire level. Catches
      // exactly the class of bug found this round: 0x1114/0x1118 had 10
      // effective-rw fields while their own register's write_function was
      // still null (a metadata gap between field-level access-policy and
      // register-level wire-function evidence).
      if (f.effective_access === "rw" && !reg.write_function) {
        errors.push(issue("WRITE_ENABLED_FIELD_WITHOUT_REGISTER_WRITE_FUNCTION", `fields[${f.key}]`,
          `field "${f.key}" has effective_access "rw" but its own register ${reg.address} has no write_function -- a field cannot be writable if its physical register was never confirmed to have a real write mechanism`));
      }
      // The converse, packed-specific guard: a packed (write_uses_read_
      // modify_write=true) field additionally requires declared_access
      // "rw" at the REGISTER level (not just field level) -- a packed
      // write always issues a real FC16 against the whole physical
      // register (merge included), so the register's own declared access
      // must agree the whole register is writable, not just this one bit.
      if (f.write_uses_read_modify_write === true && f.access === "rw" && reg.declared_access !== "rw") {
        errors.push(issue("PACKED_WRITE_WITHOUT_REGISTER_DECLARED_ACCESS", `fields[${f.key}]`,
          `field "${f.key}" is a packed RW field but its own register ${reg.address} has declared_access "${reg.declared_access}", not "rw" -- a packed write always touches the whole physical register and needs the register itself declared writable`));
      }
    }
  }

  // --- evidence locator sanity: a locator that names one of THIS repo's own
  // files (a bare repo-relative path, not part of a URL or an absolute
  // /Users/... path — those two are out of scope for a repo-existence
  // check) must actually exist. Deliberately a small fixed allowlist rather
  // than a generic filename regex — free-text locator prose legitimately
  // contains filename-shaped substrings inside URLs and absolute paths
  // (github.com/..., the user's local Downloads workbook) that are not
  // claims about THIS repo's tree at all.
  const KNOWN_REPO_FILES = [
    "batterylifepo4.yaml", "jk_bms.js", "demo/mock-server.js",
    "HARDWARE_AUDIT_2026-09-09.md", "register_catalog.json",
  ];
  function checkEvidenceLocators(evidenceList, ownerPath) {
    for (const ev of evidenceList) {
      for (const candidate of KNOWN_REPO_FILES) {
        if (!ev.locator.includes(candidate)) continue;
        if (!fs.existsSync(path.join(repoRoot, candidate))) {
          errors.push(issue("EVIDENCE_LOCATOR_FILE_MISSING", ownerPath,
            `evidence locator references "${candidate}" which does not exist relative to the repo root`));
        }
      }
    }
  }
  for (const reg of registers) {
    checkEvidenceLocators(reg.evidence, `registers[${reg.register_id}].evidence`);
    for (const f of reg.fields) checkEvidenceLocators(f.evidence, `fields[${f.key}].evidence`);
  }

  // --- workbook/upstream evidence claims must be PRESENT in the real,
  // regenerable normalized index (protocol/evidence/{workbook,upstream}_index.json)
  // — this is the direct fix for CODEX_STAGE_1_REVIEW.md P0-2 (three
  // addresses wrongly credited with workbook evidence, one wrongly denied
  // it). A non-empty locator string alone is NOT accepted as proof (spec
  // Крок C: "Непорожній рядок не є доказом"). The index files are optional
  // inputs to this function — if either is missing (e.g. a negative-fixture
  // test running against a synthetic register with no real-world address),
  // this check is skipped for that source, not treated as a failure.
  let workbookIndex = null;
  let workbookV2Index = null;
  let upstreamIndex = null;
  try { workbookIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, "protocol", "evidence", "workbook_index.json"), "utf8")).address_index; } catch (e) { /* optional */ }
  try { workbookV2Index = JSON.parse(fs.readFileSync(path.join(repoRoot, "protocol", "evidence", "workbook_v2_index.json"), "utf8")).address_index; } catch (e) { /* optional */ }
  try { upstreamIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, "protocol", "evidence", "upstream_index.json"), "utf8")).address_index; } catch (e) { /* optional */ }

  function checkIndexBackedEvidence(evidenceList, address, ownerPath) {
    for (const ev of evidenceList) {
      if (ev.source_id === "workbook_lifepo4_bms_parameters_registers" && workbookIndex) {
        if (!Object.prototype.hasOwnProperty.call(workbookIndex, address)) {
          errors.push(issue("EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX", ownerPath,
            `evidence cites source "workbook" for address ${address}, but ${address} is not present in ` +
            `protocol/evidence/workbook_index.json (regenerate with build_workbook_index.py to re-check)`));
        }
      }
      if (ev.source_id === "workbook_lifepo4_bms_parameters_registers_v2" && workbookV2Index) {
        if (!Object.prototype.hasOwnProperty.call(workbookV2Index, address)) {
          errors.push(issue("EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_V2_INDEX", ownerPath,
            `evidence cites source "workbook_lifepo4_bms_parameters_registers_v2" for address ${address}, but ${address} is not present in ` +
            `protocol/evidence/workbook_v2_index.json (regenerate with build_workbook_v2_index.py to re-check)`));
        }
      }
      if (ev.source_id === "upstream_syssi_esphome_jk_bms" && upstreamIndex) {
        if (!Object.prototype.hasOwnProperty.call(upstreamIndex, address)) {
          errors.push(issue("EVIDENCE_ADDRESS_NOT_IN_UPSTREAM_INDEX", ownerPath,
            `evidence cites source "upstream_reference" for address ${address}, but ${address} is not present in ` +
            `protocol/evidence/upstream_index.json (regenerate with build_upstream_index.py to re-check)`));
        }
      }
    }
  }
  for (const reg of registers) {
    checkIndexBackedEvidence(reg.evidence, reg.address, `registers[${reg.register_id}].evidence`);
    for (const f of reg.fields) checkIndexBackedEvidence(f.evidence, reg.address, `fields[${f.key}].evidence`);
  }

  // --- version model guard (spec Крок D): no register/field's model_scope
  // may equal a non-BMS version string this catalog knows about — the
  // exact CODEX_STAGE_1_REVIEW.md P0-3 defect (a UI build label reused as
  // BMS firmware_scope). registers no longer HAVE a firmware_scope field
  // at all (schema-enforced by additionalProperties:false), so this check
  // guards the remaining surface: model_scope strings themselves.
  const KNOWN_NON_BMS_VERSION_STRINGS = ["2026.09.08-v5", "v3.0.0"];
  for (const reg of registers) {
    for (const s of reg.model_scope) {
      for (const bad of KNOWN_NON_BMS_VERSION_STRINGS) {
        if (s.includes(bad)) {
          errors.push(issue("UI_VERSION_AS_MODEL_SCOPE", `registers[${reg.register_id}].model_scope`,
            `model_scope entry "${s}" contains "${bad}", a known non-BMS (UI/ESPHome-project) version string`));
        }
      }
    }
  }

  // Version context must resolve from exact source locators, not merely avoid
  // two known bad strings.
  try {
    const yaml = fs.readFileSync(path.join(repoRoot, "batterylifepo4.yaml"), "utf8");
    const js = fs.readFileSync(path.join(repoRoot, "jk_bms.js"), "utf8");
    const toolchain = JSON.parse(fs.readFileSync(path.join(repoRoot, "toolchain.lock.json"), "utf8"));
    const projectMatch = yaml.match(/^\s{4}version:\s*([^\s#]+)\s*$/m);
    const uiMatch = js.match(/const UI_VERSION = "([^"]+)"/);
    const externalMatch = yaml.match(/^\s*external_components_source:\s*(\S+)\s*$/m);
    const contextValue = (name) => String(registerDoc.version_context[name] || "").split(" (")[0];
    if (!projectMatch || contextValue("esphome_project_version") !== projectMatch[1]) {
      errors.push(issue("VERSION_CONTEXT_PROJECT_MISMATCH", "version_context.esphome_project_version", "does not match batterylifepo4.yaml esphome.project.version"));
    }
    if (!uiMatch || contextValue("web_ui_version") !== uiMatch[1]) {
      errors.push(issue("VERSION_CONTEXT_UI_MISMATCH", "version_context.web_ui_version", "does not match jk_bms.js UI_VERSION"));
    }
    if (!externalMatch || registerDoc.version_context.external_component_pin !== externalMatch[1]) {
      errors.push(issue("VERSION_CONTEXT_EXTERNAL_PIN_MISMATCH", "version_context.external_component_pin", "does not match external_components_source"));
    }
    if (!String(registerDoc.version_context.esphome_framework_version_used_for_verification).startsWith(String(toolchain.esphome))) {
      errors.push(issue("VERSION_CONTEXT_ESPHOME_MISMATCH", "version_context.esphome_framework_version_used_for_verification", "does not match toolchain.lock.json"));
    }
    if (!String(registerDoc.version_context.bms_protocol_variant).startsWith("unknown")) {
      errors.push(issue("BMS_PROTOCOL_VARIANT_OVERCLAIM", "version_context.bms_protocol_variant", "must remain unknown until independent evidence exists"));
    }
    if (!String(registerDoc.version_context.bms_firmware_version).startsWith("unknown")) {
      errors.push(issue("BMS_FIRMWARE_VERSION_OVERCLAIM", "version_context.bms_firmware_version", "UART protocol/library version is not BMS firmware version"));
    }
  } catch (e) {
    errors.push(issue("VERSION_CONTEXT_SOURCE_UNREADABLE", "version_context", e.message));
  }

  return errors;
}

module.exports = { check };
