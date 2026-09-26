# Settings / Cells at extreme zoom (160–300 CSS px) — evidence (2026-09-26)

Base: 62c9f94. Change: `jk_bms.css` only. Measured in the Claude desktop
browser pane (Chromium) against `demo/mock-server.js` with the real
`jk_bms.js`/`jk_bms.css`. No device access.

## Previous limitation

The previous commit documented that effective widths ≤ 256 CSS px were not
supported. Measurements at 160 px showed why:
- Page padding left a 76 px cell list and a 40 px row content box: the stage
  (16 px × 2), the right column (24 px × 2) and the row (18 px × 2).
- The page itself did not scroll, because the cluster clips its content.
  Inside the rows, however, voltage overlapped resistance, and the field and
  the lock were cut off.

## Layout states (container widths, in em of the value font)

All thresholds come from the audited widths (`settings_control_width_audit.json`:
cell calibration 155.86 px, widest ordinary editor 145.85 px, rendering
margin 2 px) and from the CSS:

| state | cells | Settings | derivation |
|---|---|---|---|
| normal pair | ≥ 16.5em | ≥ 16em | 36 + token + 8 + 44 = 247 / 236.5 px |
| tight pair (shell padding 6, gaps 4: −10 px chrome) | < 16.5em | < 16em | as before; a 320 px phone at 100 % (236 px list) stays here |
| **ultra: [field / action] stacked** | < 15.5em | < 15em | 36 + (req − 10 + 2) + 4 + 44 = 231.86 / 221.85 px |
| **ultra: voltage and resistance on separate lines** | < 14em | — | 8 + 9ch + 8 + 11ch + 8 = 208.3 px |

In the ultra state:
- The field is `minmax(0, audited width)` (= min(audited, 100 %)) and
  right-aligned.
- The same framed 44×38 OK/lock sits directly below the field, right-aligned,
  in the same wrapper element.
- Row padding is 8 px. The label wraps deliberately (`overflow-wrap:anywhere`).
- No font-size change, and no unit or control is hidden.

Page padding tightens only at ≤ 300 CSS px, which is reachable only through
zoom on a phone:
- stage 4 px;
- right column 16 px 8 px;
- top bar and navigation rail tightened.

A 160 px page then leaves a 132 px cell list and a 116 px field.

Also fixed: an untranslated CamelCase label ("TemperatureSensorAnomaly",
199 px) overflowed its Settings row at 320 px in EN (pre-existing).
`.settings-catalog-label` now uses `overflow-wrap:anywhere`.

## Matrix

Every row checks all visible cell and Settings rows (180):
- no part outside the row content box;
- no overlap between label, voltage, resistance, field, action and value;
- no clipped unit or label;
- field and action share one wrapper;
- the action is 44×38 for both OK and lock;
- no horizontal page overflow.

"values" lists what does not fit at rest inside the calibration field; those
values scroll inside the input only.

| page (CSS px) | = | text | lang/theme | list | state | issues | values not fully visible at rest |
|---|---|---|---|---|---|---|---|
| 375 | 375@100 | 15 | UK dark | 291 | pair, normal chrome | 0 | – |
| 320 | 320@100 | 15 | UK dark, EN light | 236 | tight pair (unchanged) | 0 | – |
| 300 | 375@125 | 15 | UK dark | 272 | pair | 0 | – |
| 256 | 320@125 | 15 | UK dark, EN light | 228 | cells stacked, Settings tight pair | 0 | – |
| 250 | 375@150 | 15 | UK dark, EN light | 222 | stacked | 0 | – |
| 214/213 | 375@175 / 320@150 | 15 | UK dark, EN light | 186/185 | stacked | 0 | – |
| 200 | – | 15 | UK dark | 172 | stacked, values stacked | 0 | – |
| 188 | 375@200 | 15 | UK dark, EN light | 160 | stacked | 0 | – |
| 183 | 320@175 | 15 | UK dark, EN light | 155 | stacked | 0 | 4294967.295 (UK) |
| 170 | – | 15 | UK dark | 142 | stacked | 0 | 4294967.295 |
| 160 | 320@200 | 15 | UK dark, EN light | 132 | stacked | 0 | 4294967.295 |
| 375 … 160 | 375@100 … 320@200 | 22 | EN light, UK dark | 291 … 132 | stacked (larger em) | 0 | at ≤ 214: 4294967.295; at 160: also 999.999 (EN, UK) and 12.345 (UK) |

Common calibration values (measured wire resistance on the device is
0.04–1.45 mΩ; the manufacturer's example is 0.1 mΩ) stay fully visible
everywhere. In the worst case (160 px, 22 px text, UK), 0.100, 1.450 and
9.999 are fully visible; 10.000 and above scroll inside the focused input.

## Regression tests

`test/protocol_catalog/test_settings_controls_css.js` (55 checks) derives
every threshold above from the audit fixture and the CSS.

Mutations (each makes the test exit non-zero):
- ultra state removed;
- ultra state 1em too early, or 1em too late (Settings);
- action beside the field;
- fixed (non-shrinking) field;
- font-size added;
- label kept on one line;
- no value stacking;
- unit hidden;
- page padding not tightened;
- ultra state turned into a viewport `@media`.
