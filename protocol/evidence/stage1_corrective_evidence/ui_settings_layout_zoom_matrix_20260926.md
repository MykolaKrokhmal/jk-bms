# Settings / Cells layout across browser zoom — evidence (2026-09-26)

Base: fd81e39. Change: `jk_bms.css` only (container queries). Measured in the
Claude desktop browser pane (Chromium) against `demo/mock-server.js`, the
real `jk_bms.js`/`jk_bms.css`. No device writes.

## Owner-reported defect

At some zoom levels "Комірка 01" wrapped over two lines beside
"3.451 В · 0.055 мОм · [0 мОм] [lock]".

Root cause: the cell grid used `minmax(0, 1fr)` for the label track and
**viewport** breakpoints (560/420/360 px). The deck is two columns from
860 px viewport, so between ~860 and ~1100 CSS px (e.g. 1280 px window at
110–150 % zoom) the right column — and the cell list inside it — is
*narrower* than on an 820 px single-column page, yet the five-column state
stayed active and the label track shrank to below its content.

## Fix

The cell list (`container-name:cells`) and the Settings list
(`container-name:settings`) are `inline-size` containers with
`font-size:var(--fs-body)`, so the thresholds are in em of the value font
and grow with larger text. Thresholds are the measured minimum content
widths at 15 px (UK, the longer language):

| state | needs | switch (max-width) |
|---|---|---|
| cells wide (label, voltage, resistance, field, action) | 18·2 + 81.8 + 14 + 82.9 + 14 + 101.4 + 14 + (159 + 8 + 44) = 555.1 px | 37.49em = 562.4 px |
| cells intermediate (label, voltage, resistance / field + action) | 18·2 + 81.8 + 14 + 82.9 + 14 + 101.4 = 330.1 px | 22.49em = 337.4 px |
| cells narrow (label / values / field + action) | — | — |
| Settings group under its label | 18·2 + 140 + 14 + 148.5 + 8 + 44 = 390.5 px | 26.49em = 397.4 px |
| tight chrome (both lists) | — | 16.49em |

Label "Комірка 32" 81.8 px, `9ch` 82.9 px, `11ch` 101.4 px (computed fonts).
The label track is `minmax(max-content, 1fr)` + `white-space:nowrap` in the
wide and intermediate states. `@supports not (container-type:inline-size)`
keeps the previous viewport rules as a fallback.

## Zoom / width matrix (UK, dark, normal text)

Emulated CSS viewport = window width / zoom. Checked per width: label on one
line, identical voltage/resistance right edge + y and field x/y across the
first 5 rows, no overlap, no clipped unit, no row or page horizontal
overflow, one 44×38 action box (OK and lock identical), 8 px field→action.

| CSS viewport | list width | state | result |
|---|---|---|---|
| 1910, 1528, 1280, 1164, 1093 | 686–771 | wide | OK |
| 1024, 960, 911, 870 (two-column deck) | 408–562 | intermediate | OK (was wide + wrapped label before) |
| 853, 820, 768, 731, 683 (single column) | 686–771 | wide | OK |
| 640 … 427 | 338–562 | intermediate | OK |
| 410 … 300 | 218–337 | narrow | OK |

Covers 1280 px (owner window) and 1920 px windows at 67/75/80/90/100/110/
125/150/175/200 %, plus 320/375/768/820/1024 px devices.

EN/light at 1280, 960, 375, 320: OK. Large text (`--fs-body` 22 px): OK at
1280, 1024, 960, 820 (intermediate) and 375 (narrow).

Physical limit (not fixable by layout): CSS viewports ≤ 256 px (a 320/375 px
phone at ≥ 125 % zoom; also 320 px with 22 px text) leave a 78–174 px list;
the audited calibration pair alone needs ≥ 199 px (tight chrome), so rows
overflow there.

Re-check after the freshness change (same CSS layout): 1280 → wide (list
750), 960 → intermediate (498), 375 → narrow (293); all criteria OK.

## Regression tests

`test/protocol_catalog/test_settings_controls_css.js` (47 checks): container
contract, thresholds derived from the measurements above and the audited
width tokens (switch no earlier than needed, < 1em later), no viewport-only
breakpoint outside the `@supports` fallback, label nowrap/max-content, per-
state grids, field+action never split, fallback kept.

Mutations (each killed by at least one failing check): intermediate rule
removed; cells narrow rule turned into a viewport `@media`; Settings rule
turned into a viewport `@media`; label track back to `minmax(0, 1fr)`; label
`nowrap` removed; wide threshold moved 1em too early.
