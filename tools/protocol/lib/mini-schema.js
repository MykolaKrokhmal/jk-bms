"use strict";
/*
 * Dependency-free JSON Schema subset validator (Stage 1, spec section 9/10).
 *
 * This project has zero npm dependencies (demo/mock-server.js, jk_bms.js,
 * every existing test are all plain Node with no package.json/node_modules).
 * Pulling in a full JSON Schema engine (ajv et al.) for this one purpose
 * would be the first external dependency in the repo. Instead this module
 * implements exactly the subset of JSON Schema draft-2020-12 the protocol
 * catalog schemas actually use: type, required, properties,
 * additionalProperties:false, enum, minimum/maximum, pattern, items,
 * minItems, nullable via type arrays. It is intentionally NOT a general
 * JSON Schema implementation.
 *
 * validate(schema, data) returns an array of {path, message} errors (empty
 * = valid). Every error names the exact JSON pointer path that failed, so
 * callers can produce location-aware messages (spec section 10 requires
 * this — "точне location-aware повідомлення").
 */

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v, type) {
  const actual = typeOf(v);
  if (type === "integer") return actual === "number" && Number.isInteger(v);
  return actual === type;
}

function validate(schema, data, path = "$") {
  const errors = [];

  function fail(p, message) {
    errors.push({ path: p, message });
  }

  function check(sch, val, p) {
    if (sch.$ref) {
      throw new Error(`mini-schema: $ref is not supported (at ${p})`);
    }

    if (sch.type) {
      const types = Array.isArray(sch.type) ? sch.type : [sch.type];
      if (!types.some((t) => matchesType(val, t))) {
        fail(p, `expected type ${types.join("|")}, got ${typeOf(val)}`);
        return; // further checks would be noise once the type itself is wrong
      }
    }

    if (sch.enum && !sch.enum.includes(val)) {
      fail(p, `value ${JSON.stringify(val)} is not one of ${JSON.stringify(sch.enum)}`);
    }

    if (typeof val === "string" && sch.pattern) {
      const re = new RegExp(sch.pattern);
      if (!re.test(val)) fail(p, `string ${JSON.stringify(val)} does not match pattern ${sch.pattern}`);
    }
    if (typeof val === "string" && sch.minLength !== undefined && val.length < sch.minLength) {
      fail(p, `string shorter than minLength ${sch.minLength}`);
    }

    if (typeof val === "number") {
      if (sch.minimum !== undefined && val < sch.minimum) fail(p, `${val} < minimum ${sch.minimum}`);
      if (sch.maximum !== undefined && val > sch.maximum) fail(p, `${val} > maximum ${sch.maximum}`);
    }

    if (Array.isArray(val)) {
      if (sch.minItems !== undefined && val.length < sch.minItems) fail(p, `array shorter than minItems ${sch.minItems}`);
      if (sch.items) {
        val.forEach((item, i) => check(sch.items, item, `${p}[${i}]`));
      }
    }

    if (typeOf(val) === "object") {
      const props = sch.properties || {};
      for (const key of sch.required || []) {
        if (!(key in val)) fail(p, `missing required property "${key}"`);
      }
      for (const key of Object.keys(val)) {
        if (key in props) {
          check(props[key], val[key], `${p}.${key}`);
        } else if (sch.additionalProperties === false) {
          fail(p, `unknown property "${key}" (additionalProperties: false)`);
        } else if (sch.additionalProperties && typeof sch.additionalProperties === "object") {
          check(sch.additionalProperties, val[key], `${p}.${key}`);
        }
      }
      if (sch.anyOf) {
        const subErrors = sch.anyOf.map((s) => validate(s, val, p));
        if (!subErrors.some((e) => e.length === 0)) {
          fail(p, `value did not match any of ${sch.anyOf.length} anyOf schemas`);
        }
      }
    } else if (val === null && sch.nullable) {
      // ok
    }
  }

  check(schema, data, path);
  return errors;
}

module.exports = { validate };
