#!/usr/bin/env bash
# Single command to run every automated check in this repo. Exits non-zero
# on the first failure. Needs a real TCP port for the integration suite —
# if running inside a sandboxed shell, disable the sandbox for this script.
set -e
cd "$(dirname "$0")/.."

echo "=== jk_write_tx_core unit tests ==="
(cd test/jk_write_tx && g++ -std=c++17 -Wall -Wextra -I ../../components/jk_write_tx test_jk_write_tx_core.cpp -o test_jk_write_tx_core && ./test_jk_write_tx_core)

echo
echo "=== jk_history_format unit tests ==="
(cd test/jk_history && g++ -std=c++17 -Wall -Wextra -I ../../components/jk_history test_jk_history_format.cpp ../../components/jk_history/jk_history_format.cpp -o test_jk_history_format && ./test_jk_history_format)

echo
echo "=== register catalog validator ==="
node test/register_catalog/validate.js

echo
echo "=== JS syntax checks ==="
node --check jk_bms.js
node --check demo/mock-server.js
node --check demo/panel.js
node --check test/topology/run.js
echo "syntax OK"

echo
echo "=== topology + write-transaction integration suite ==="
TEST_PORT="${TEST_PORT:-18999}" node test/topology/run.js

echo
echo "All suites passed."
