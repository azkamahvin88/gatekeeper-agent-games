#!/bin/bash
# Jalankan Proof Gatekeeper agent (server lokal :3000).
# Memuat .env (mode 600) lalu supervisor sederhana: restart bila mati.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
set -a
# shellcheck disable=SC1091
source ./.env
set +a
: "${AGENT_GAMES_HMAC_SECRET:?AGENT_GAMES_HMAC_SECRET belum diisi di .env}"
while true; do
  echo "[$(date -u '+%H:%M:%S')] starting gatekeeper agent on :${PORT:-3000}..." >> agent.log
  node server.mjs >> agent.log 2>&1
  echo "[$(date -u '+%H:%M:%S')] agent exited (code $?), restarting in 5s..." >> agent.log
  sleep 5
done
