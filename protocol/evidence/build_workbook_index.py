#!/usr/bin/env python3
"""Deterministic, re-runnable workbook indexer (Stage 1 Remediation, Крок C;
Stage 1 Completion Pass, CODEX P1-8/P1-14: portable input path, no personal
path leaked into generated artifacts, stdlib-only parser).

Reads the user-supplied workbook, parses the `BMS Parameters` sheet
structurally (not by memory/eyeballing a CSV dump), and writes
protocol/evidence/workbook_index.json: an address -> row(s) normalized index
that the canonical source's own evidence citations and the validator can
both check against mechanically.

This script is the single place workbook claims are computed. Nothing else
in this repository should assert "the workbook says X" without having gone
through this index — the exact defect CODEX_STAGE_1_REVIEW.md found (three
addresses wrongly credited with workbook evidence they don't carry, one
address wrongly credited with NOT having workbook evidence it does carry)
was caused by hand-transcribing address claims once, not by a wrong
index — so this script exists to make re-deriving them a single command,
not a memory exercise.

The workbook path is NEVER hardcoded (CODEX P1-8: a prior version baked in
one user's personal /Users/.../Downloads/... path, both as the read source
AND — worse — into the generated workbook_index.json itself). Source
identity is the SHA-256 hash recorded in protocol/evidence/sources.json,
not a filesystem path; the path is supplied fresh each run and only its
basename (never the full path, which could contain another user's home
directory or username) is recorded in the output.

Parses .xlsx directly via the Python standard library (zipfile + a minimal
OOXML SpreadsheetML reader) — NOT openpyxl. requirements-protocol.txt
declares this project's protocol tooling has zero third-party Python
dependencies; a prior version of this script silently contradicted that by
importing openpyxl, which is also why it could not be re-run in an
environment that had never had openpyxl installed (CODEX P1-8's
"pip install --user is not a reproducible toolchain" — the actual fix is
not a better pip invocation, it is not needing pip at all).

Run:
  python3 protocol/evidence/build_workbook_index.py --workbook /path/to/LiFePO4_BMS_Parameters_registers.xlsx
  JK_BMS_WORKBOOK_PATH=/path/to/file.xlsx python3 protocol/evidence/build_workbook_index.py
  python3 protocol/evidence/build_workbook_index.py --check   (verify workbook_index.json is up to date; needs --workbook/env too)
"""
import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SHEET_NAME = "BMS Parameters"
OUT_PATH = "protocol/evidence/workbook_index.json"
SOURCES_PATH = "protocol/evidence/sources.json"

ADDR_RE = re.compile(r"0x([0-9A-Fa-f]{4})")
BYTE_QUALIFIER_RE = re.compile(r"\((старший|молодший)\s*байт\)", re.IGNORECASE)

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
R_ID_ATTR = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _safe_fromstring(data):
    """xml.etree is expat-based and, like most stdlib XML parsers, will
    expand DTD-declared entities (XXE / billion-laughs) if a DOCTYPE is
    present. A well-formed OOXML part (xl/workbook.xml, sheetN.xml,
    sharedStrings.xml, the workbook rels) never legitimately contains one —
    only a maliciously crafted .xlsx would add one — so reject any DOCTYPE
    outright rather than parsing it, closing off that entire attack class
    without needing a third-party defused-XML dependency this project's
    zero-dependency policy would otherwise rule out."""
    if b"<!DOCTYPE" in data[:2048]:
        raise ValueError("refusing to parse XML containing a DOCTYPE declaration (possible XXE)")
    return ET.fromstring(data)


def _text_of(el):
    return "".join(t.text or "" for t in el.findall(".//m:t", NS))


def _load_shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = _safe_fromstring(z.read("xl/sharedStrings.xml"))
    return [_text_of(si) for si in root.findall("m:si", NS)]


def _find_sheet_path(z, sheet_name):
    wb_root = _safe_fromstring(z.read("xl/workbook.xml"))
    rels_root = _safe_fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {rel.get("Id"): rel.get("Target") for rel in rels_root}
    for sheet in wb_root.findall(".//m:sheets/m:sheet", NS):
        if sheet.get("name") == sheet_name:
            target = rid_to_target[sheet.get(R_ID_ATTR)]
            return target if target.startswith("xl/") else f"xl/{target}"
    raise KeyError(sheet_name)


def _col_to_index(col_letters):
    idx = 0
    for ch in col_letters:
        idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
    return idx - 1  # 0-based


def _cell_value(c_el, shared_strings):
    is_el = c_el.find("m:is", NS)
    if is_el is not None:
        return _text_of(is_el)
    v_el = c_el.find("m:v", NS)
    if v_el is None or v_el.text is None:
        return None
    cell_type = c_el.get("t")
    if cell_type == "s":
        return shared_strings[int(v_el.text)]
    if cell_type == "str":
        return v_el.text
    if cell_type == "b":
        return bool(int(v_el.text))
    text = v_el.text
    try:
        return int(text) if ("." not in text and "e" not in text.lower()) else float(text)
    except ValueError:
        return text


def parse_xlsx_sheet(path, sheet_name):
    """Returns (rows: {rownum(1-based): {col_idx(0-based): value}}, dimensions_str)."""
    with zipfile.ZipFile(path) as z:
        shared_strings = _load_shared_strings(z)
        sheet_path = _find_sheet_path(z, sheet_name)
        root = _safe_fromstring(z.read(sheet_path))
        rows = {}
        max_row, max_col = 0, 0
        for row_el in root.findall(".//m:sheetData/m:row", NS):
            rownum = int(row_el.get("r"))
            max_row = max(max_row, rownum)
            cells = {}
            for c_el in row_el.findall("m:c", NS):
                ref = c_el.get("r") or ""
                col_letters = "".join(ch for ch in ref if ch.isalpha())
                if not col_letters:
                    continue
                col_idx = _col_to_index(col_letters)
                max_col = max(max_col, col_idx)
                cells[col_idx] = _cell_value(c_el, shared_strings)
            rows[rownum] = cells
    def col_letters_of(idx):
        idx += 1
        s = ""
        while idx > 0:
            idx, rem = divmod(idx - 1, 26)
            s = chr(ord("A") + rem) + s
        return s
    dimensions = f"A1:{col_letters_of(max_col)}{max_row}"
    return rows, dimensions


def build_index(workbook_path):
    raw = open(workbook_path, "rb").read()
    file_sha256 = hashlib.sha256(raw).hexdigest()

    raw_rows, dimensions = parse_xlsx_sheet(workbook_path, SHEET_NAME)
    max_row = max(raw_rows) if raw_rows else 0

    rows = []
    for rownum in range(1, max_row + 1):
        cells_by_col = raw_rows.get(rownum, {})
        cells = [cells_by_col.get(i) for i in range(6)]
        category, label, value, origin, address_cell, access = cells
        rows.append({
            "row": rownum, "category": category, "label": label, "value": value,
            "origin": origin, "address_cell": address_cell, "access": access,
        })

    # address -> list of {row, address_cell_raw, label, access, byte_qualifier}
    address_index = {}
    for r in rows:
        cell = r["address_cell"]
        if not cell:
            continue
        cell_str = str(cell)
        addrs = ADDR_RE.findall(cell_str)
        if not addrs:
            continue
        # A cell can list more than one address ("0x14E4 / 0x14F0 / 0x14F4") —
        # each token is its own claim, at the SAME row.
        for addr_hex in addrs:
            addr = f"0x{addr_hex.upper()}"
            qualifier_match = BYTE_QUALIFIER_RE.search(cell_str)
            entry = {
                "row": r["row"],
                "sheet": SHEET_NAME,
                "cell_range": f"A{r['row']}:F{r['row']}",
                "address_cell": f"E{r['row']}",
                "access_cell": f"F{r['row']}",
                "address_cell_raw": cell_str,
                "category": r["category"],
                "label": r["label"],
                "value_observed": r["value"],
                "access": r["access"],
                "byte_qualifier": qualifier_match.group(1) if qualifier_match else None,
            }
            address_index.setdefault(addr, []).append(entry)

    output = {
        "$comment": "GENERATED by protocol/evidence/build_workbook_index.py — do not hand-edit. "
                     "Re-run the script (with --workbook/JK_BMS_WORKBOOK_PATH pointing at the same "
                     "file, sha256-verified below) to refresh after the source workbook changes. "
                     "The full input filesystem path is deliberately NOT recorded here (CODEX "
                     "P1-8) — source identity is source_sha256, cross-checked against "
                     "protocol/evidence/sources.json's file_sha256, not a path.",
        "$deprecated": "DEPRECATED as of the V2 workbook normative switch: this index covers only "
                        "113 of the 208 V1.1-documented addresses (the V1 workbook is a partial, "
                        "unverified source). The current normative parameter list is "
                        "protocol/generated/bms_v1_1_manifest.json, generated from "
                        "protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx by "
                        "protocol/evidence/build_v2_manifest.py. See protocol/evidence/sources.json's "
                        "workbook_lifepo4_bms_parameters_registers entry (deprecated: true, "
                        "superseded_by: workbook_lifepo4_bms_parameters_registers_v2) for the "
                        "authoritative source-status record. This file is retained only for "
                        "historical/regression-test comparison, not as a live specification.",
        "source_basename": os.path.basename(workbook_path),
        "source_sha256": file_sha256,
        "sheet_name": SHEET_NAME,
        "sheet_dimensions": dimensions,
        "total_rows": len(rows),
        "rows_with_address_cell": sum(1 for r in rows if r["address_cell"]),
        "unique_addresses": len(address_index),
        "address_index": dict(sorted(address_index.items())),
    }
    return output, file_sha256


def resolve_workbook_path(args):
    path = args.workbook or os.environ.get("JK_BMS_WORKBOOK_PATH")
    if not path:
        print("ERROR: no workbook path given. Pass --workbook /path/to/file.xlsx or set "
              "JK_BMS_WORKBOOK_PATH. This script deliberately has no hardcoded default "
              "(CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md P1-8: a personal path must never be "
              "baked into pipeline source code or its generated artifacts).", file=sys.stderr)
        sys.exit(2)
    if not os.path.isfile(path):
        print(f"ERROR: workbook not found at {path!r}", file=sys.stderr)
        sys.exit(2)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", help="Path to LiFePO4_BMS_Parameters_registers.xlsx")
    parser.add_argument("--output", default=OUT_PATH)
    parser.add_argument("--check", action="store_true",
                         help="Verify protocol/evidence/workbook_index.json is byte-identical to a fresh build; exit 1 if not.")
    args = parser.parse_args()

    workbook_path = resolve_workbook_path(args)
    output, file_sha256 = build_index(workbook_path)

    manifest = json.load(open(SOURCES_PATH, encoding="utf-8"))
    source = next(s for s in manifest["sources"] if s["source_id"] == "workbook_lifepo4_bms_parameters_registers")
    expected_sha256 = source["file_sha256"]
    if file_sha256 != expected_sha256:
        print(f"ERROR: workbook sha256 {file_sha256} does not match the hash recorded in "
              f"protocol/evidence/sources.json ({expected_sha256}) — this is not the same file "
              f"the canonical evidence was reconciled against. Refusing to write a stale/wrong index.",
              file=sys.stderr)
        sys.exit(1)

    new_text = json.dumps(output, indent=2, ensure_ascii=False, default=str) + "\n"

    if args.check:
        # release_generation_id is pipeline.js-owned metadata, stamped onto
        # the committed artifact by a post-processing step this script never
        # runs itself -- strip it before comparing so this standalone check
        # verifies only the payload this script owns (see the identical note
        # in build_workbook_v2_index.py's --check block).
        old_text = open(args.output, encoding="utf-8").read() if os.path.exists(args.output) else None
        old_payload = None
        if old_text is not None:
            try:
                parsed = json.loads(old_text)
                parsed.pop("release_generation_id", None)
                old_payload = json.dumps(parsed, indent=2, ensure_ascii=False, default=str) + "\n"
            except (json.JSONDecodeError, AttributeError):
                old_payload = None
        if old_payload != new_text:
            print(f"WORKBOOK_INDEX_STALE: {args.output}", file=sys.stderr)
            sys.exit(1)
        print(f"workbook-index PASS rows={output['total_rows']} addresses={output['unique_addresses']}")
        return

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(new_text)

    print(f"source_sha256={file_sha256}")
    print(f"rows={output['total_rows']} rows_with_address_cell={output['rows_with_address_cell']} unique_addresses={output['unique_addresses']}")
    print(f"wrote {args.output}")

    address_index = output["address_index"]
    for check_addr in ["0x12A4", "0x12E6", "0x12F8", "0x12E4"]:
        present = check_addr in address_index
        print(f"  {check_addr}: {'PRESENT row(s)=' + str([e['row'] for e in address_index[check_addr]]) if present else 'ABSENT'}")


if __name__ == "__main__":
    main()
