#!/usr/bin/env bash
# refresh.sh — update Sonic the Ledgerhog to the latest version (macOS/Linux).
#   ./scripts/refresh.sh         # dev mode (default)
#   ./scripts/refresh.sh build   # build a fresh installer
#   CLEAN=1 ./scripts/refresh.sh # force a clean Rust rebuild (e.g. icon won't update)
# Your .sonicledger book file is independent of the code and is never touched.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Repo: $(pwd)"

echo; echo "[1/4] Pulling latest code..."; git pull
echo; echo "[2/4] Installing dependencies..."; npm install
echo; echo "[3/4] Building web assets..."; npm run build

if [ "${CLEAN:-0}" = "1" ]; then
  echo; echo "[clean] Clearing the Rust build cache..."; cargo clean --manifest-path src-tauri/Cargo.toml
fi

MODE="${1:-dev}"
echo; echo "[4/4] Launching ($MODE)..."
if [ "$MODE" = "build" ]; then
  npm run tauri build
  echo "Done. Installer is under src-tauri/target/release/bundle/ — reinstall to update."
else
  npm run tauri dev
fi
