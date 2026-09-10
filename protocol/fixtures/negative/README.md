# Negative validator fixtures

Each `*.json` file in this directory is produced by
`test/protocol_catalog/test_negative_fixtures.js` from `BASE_VALID` (a
minimal, deliberately schema/semantic-valid one-register canonical source
defined in that file) with exactly one mutation applied — named after the
failure class it is meant to trigger. They exist so the validator's failure
paths are proven, not just its happy path (spec section 10: "Створи
negative fixtures/tests для кожного класу помилки... Тест повинен
доводити, що validator справді завершується non-zero і дає точне
location-aware повідомлення").

Do not hand-edit these files — regenerate with:

```
node test/protocol_catalog/test_negative_fixtures.js --write-fixtures
```

Running the script without `--write-fixtures` re-derives the same fixtures
in memory, feeds each through `tools/protocol/lib/mini-schema.js` +
`tools/protocol/lib/semantic-checks.js`, and asserts the expected error
`code` (or a schema violation, for the two schema-level cases) is present —
this is the actual test; the on-disk copies are for human inspection and
diffing across changes to the checker.
