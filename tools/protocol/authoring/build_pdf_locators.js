#!/usr/bin/env node
"use strict";

/*
 * Stage 2 (typed-petting-puzzle plan, §1's PDF evidence locator policy):
 * mechanically matches each of the 265 manifest parameters (protocol/
 * generated/bms_v1_1_manifest.json) against a specific location in the
 * official PDF (protocol/evidence/BMS_RS485_Modbus_V1.1.pdf), using
 * `pdftotext` (an assumed system tool, same category as g++/python3/
 * ESPHome itself per CLAUDE.md -- not a project dependency) exactly as
 * the plan requires: "no guessing, ever... either finds an unambiguous
 * match or it doesn't." `pdf_row_text` is itself generated (mechanical
 * extraction), never hand-typed or hand-edited.
 *
 * The PDF's register table (entirely in Chinese, sections 0x1000/0x1200/
 * 0x1400/0x1600) prints each row's absolute hex address only on the
 * FIRST row of a repeated block, with a per-row hex OFFSET column on
 * every row after that -- carried forward here exactly like a human
 * reader would track it. Each row's Chinese description is immediately
 * followed, with no separator, by the SAME English mnemonic
 * (name_prog) the V2 workbook's own 'Реєстр параметрів' sheet uses for
 * that parameter (e.g. "进入休眠电压VolSmartSleep") -- confirmed by
 * direct inspection, not assumed. A worked-examples section later in
 * the same PDF repeats a subset of these rows with example encodings,
 * providing a second independent occurrence for many parameters.
 *
 * Match rule (deterministic, no fuzzy/NLP matching):
 *   A first attempt tracked each row's absolute address via a carried-
 *   forward "current block" marker (a bare "0x1000"/"0x1200"/"0x1400"
 *   line). That marker turned out to be a PDF-extraction artifact of a
 *   ROTATED/merged header cell in the original table -- pdftotext drops
 *   rotated text into the stream wherever it geometrically overlaps in
 *   reading order, NOT at the logical top of its section (confirmed
 *   directly: "0x1400" appears exactly ONCE in the whole extracted text,
 *   several rows AFTER that block's own first data row already started).
 *   Carrying it forward as block state is therefore unreliable and was
 *   abandoned rather than shipped as a silent source of wrong matches.
 *
 *   Instead: every data row DOES print its own hex OFFSET column
 *   explicitly (confirmed on every inspected row, independent of the
 *   unreliable block marker) -- so for each manifest parameter this
 *   computes the EXPECTED offset directly from the parameter's own
 *   already-known, already-verified absolute address (base_address minus
 *   whichever of the 4 known block bases {0x1000,0x1200,0x1400,0x1600}
 *   it falls in -- those 4 bases are independently confirmed, not
 *   guessed: they're stated directly in this PDF's own registered
 *   sources.json description, itself cross-checked address-by-address
 *   against the pre-existing catalog with 0 conflicts). A match requires
 *   BOTH that computed offset hex token AND the parameter's exact
 *   name_prog mnemonic to co-occur on the SAME extracted text line --
 *   no block-tracking state needed at all, so the rotated-header
 *   artifact can't introduce a wrong match.
 *
 *   A parameter with exactly one such matching (distinct) line text
 *   across the whole document -> resolved locator, pdf_row_text = that
 *   verbatim line. Zero matches -> unresolved (pdf_locator: null) --
 *   never a best-effort guess.
 *
 * Run:
 *   node tools/protocol/authoring/build_pdf_locators.js
 *   node tools/protocol/authoring/build_pdf_locators.js --check
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PDF_PATH = path.join(ROOT, "protocol", "evidence", "BMS_RS485_Modbus_V1.1.pdf");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "pdf_locators.json");
const CHECK = process.argv.includes("--check");

function sha256(buf) {
  return require("crypto").createHash("sha256").update(buf).digest("hex");
}

function extractPdfText() {
  // -layout preserves column spacing, which is what makes the per-row
  // hex offset column reliably parseable as a distinct token.
  const out = execFileSync("pdftotext", ["-layout", PDF_PATH, "-"], { maxBuffer: 32 * 1024 * 1024 });
  return out.toString("utf8");
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function normalizeAddr(hex) {
  return "0x" + hex.replace(/^0x/i, "").toUpperCase().padStart(4, "0");
}

// Independently confirmed (not guessed): protocol/evidence/sources.json's
// own official_jk_documentation entry states this PDF covers "208
// physical register addresses across 4 base blocks (0x1000 settings,
// 0x1200 measurements/status, 0x1400 device identity/config, 0x1600
// commands)" -- already cross-checked address-by-address against the
// pre-existing catalog with 0 conflicts in an earlier session.
const KNOWN_BLOCK_BASES = [0x1000, 0x1200, 0x1400, 0x1600].sort((a, b) => b - a);

function blockBaseAndOffsetFor(absoluteAddr) {
  const abs = parseInt(absoluteAddr, 16);
  for (const base of KNOWN_BLOCK_BASES) {
    if (abs >= base) return { base, offset: abs - base };
  }
  return null;
}

function buildLocators() {
  const pdfText = extractPdfText();
  const pdfLines = pdfText.split("\n").map((l) => l.trim()).filter(Boolean);
  const manifest = loadManifest();

  const results = [];
  let resolvedCount = 0;
  for (const p of manifest.parameters) {
    if (p.classification === "reserved") continue; // reserved rows are authored directly into canonical.json, not via this locator
    if (!p.address.base_address || p.address.parse_error) {
      results.push({
        id: p.id, base_address: p.address.raw, name_prog: p.name_prog,
        pdf_locator: null, pdf_row_text: null,
        evidence_needed: "manifest address did not parse (address.parse_error) -- cannot even attempt a match",
      });
      continue;
    }
    const targetAddr = normalizeAddr(p.address.base_address);
    const mnemonic = p.name_prog;
    const bo = blockBaseAndOffsetFor(targetAddr);
    if (!bo) {
      results.push({
        id: p.id, base_address: p.address.base_address, name_prog: mnemonic,
        pdf_locator: null, pdf_row_text: null,
        evidence_needed: `address ${targetAddr} does not fall within any of this document's 4 known block bases`,
      });
      continue;
    }
    const offsetHex = "0x" + bo.offset.toString(16).toUpperCase().padStart(4, "0");
    const sameLineMatches = [];
    // Packed bit/byte sub-fields (e.g. two UINT8 halves of one register,
    // or individual alarm-bitmask bits) print their shared offset column
    // only on the FIRST sibling's line -- confirmed directly (e.g.
    // "0x010C 268 2 R" followed on the NEXT line by "UINT8  保留RVD" /
    // "UINT8  R  充电器状态ChargerPlugged"). A mnemonic-bearing line with
    // no offset of its own is therefore also checked against the offset
    // on the nearest PRECEDING line that has one -- still a same-group
    // proximity check grounded in this document's own real layout, not a
    // distance-based fuzzy match.
    const nearbyMatches = [];
    for (let i = 0; i < pdfLines.length; i++) {
      const line = pdfLines[i];
      if (!line.includes(mnemonic)) continue;
      if (line.includes(offsetHex)) { sameLineMatches.push(line); continue; }
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (pdfLines[j].includes(offsetHex)) { nearbyMatches.push(line); break; }
        // Stop looking once we pass another mnemonic-bearing row (that
        // would mean crossing into a DIFFERENT packed group entirely).
        if (/[A-Za-z]{3,}/.test(pdfLines[j])) break;
      }
    }
    const uniqueTexts = [...new Set(sameLineMatches)];
    const uniqueNearbyTexts = [...new Set(nearbyMatches)].filter((t) => !uniqueTexts.includes(t));
    const blockBaseHex = "0x" + bo.base.toString(16).toUpperCase().padStart(4, "0");
    if (uniqueTexts.length >= 1) {
      resolvedCount += 1;
      results.push({
        id: p.id,
        base_address: p.address.base_address,
        name_prog: mnemonic,
        pdf_locator: {
          match_kind: "same_line",
          block_base: blockBaseHex,
          offset: offsetHex,
          distinct_line_text_count: uniqueTexts.length,
        },
        pdf_row_text: uniqueTexts[0],
        additional_occurrences: uniqueTexts.slice(1),
      });
    } else if (uniqueNearbyTexts.length === 1) {
      // Packed sub-field whose shared offset sits on a preceding sibling
      // line -- one unambiguous nearby match only (never picked when more
      // than one candidate line qualifies, to stay conservative).
      resolvedCount += 1;
      results.push({
        id: p.id,
        base_address: p.address.base_address,
        name_prog: mnemonic,
        pdf_locator: {
          match_kind: "nearby_offset_packed_sibling",
          block_base: blockBaseHex,
          offset: offsetHex,
          distinct_line_text_count: 1,
        },
        pdf_row_text: uniqueNearbyTexts[0],
        additional_occurrences: [],
      });
    } else {
      results.push({
        id: p.id,
        base_address: p.address.base_address,
        name_prog: mnemonic,
        pdf_locator: null,
        pdf_row_text: null,
        evidence_needed: uniqueNearbyTexts.length > 1
          ? `mnemonic "${mnemonic}" found near offset ${offsetHex} (block ${blockBaseHex}) on ${uniqueNearbyTexts.length} distinct candidate lines -- ambiguous, not guessed`
          : `no PDF table line found containing both offset ${offsetHex} (block ${blockBaseHex}) and mnemonic "${mnemonic}" verbatim, nor nearby as a packed sibling`,
      });
    }
  }

  return {
    $comment: "GENERATED -- mechanical pdftotext extraction + deterministic address+mnemonic match against BMS_RS485_Modbus_V1.1.pdf. DO NOT EDIT BY HAND. Regenerate with tools/protocol/authoring/build_pdf_locators.js.",
    pdf_source_sha256: sha256(fs.readFileSync(PDF_PATH)),
    manifest_source_sha256: sha256(fs.readFileSync(MANIFEST_PATH)),
    generated_at_tool: "tools/protocol/authoring/build_pdf_locators.js",
    non_reserved_parameter_count: results.length,
    resolved_count: resolvedCount,
    unresolved_count: results.length - resolvedCount,
    locators: results,
  };
}

function main() {
  const output = buildLocators();
  const serialized = JSON.stringify(output, null, 2) + "\n";
  if (CHECK) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error("build_pdf_locators.js --check: DRIFT -- protocol/generated/pdf_locators.json does not exist. Run without --check first.");
      process.exit(1);
    }
    const existing = fs.readFileSync(OUT_PATH, "utf8");
    if (existing !== serialized) {
      console.error("build_pdf_locators.js --check: DRIFT -- protocol/generated/pdf_locators.json does not match a fresh regeneration.");
      process.exit(1);
    }
    console.log("build_pdf_locators.js --check: no drift.");
    return;
  }
  fs.writeFileSync(OUT_PATH, serialized);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`${output.resolved_count}/${output.non_reserved_parameter_count} non-reserved parameters resolved to a PDF locator (${output.unresolved_count} unresolved).`);
}

main();
