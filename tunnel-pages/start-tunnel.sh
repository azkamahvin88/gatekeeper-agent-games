#!/bin/bash
# Supervisor tunnel client Gatekeeper: Pages -> agent lokal :3000.
# Butuh TUNNEL_BASE_URL (atau file .tunnel-url, chmod 600, di dir ini)
# yang baru ada SETELAH Pages ter-deploy. Key: ~/.gatekeeper-tunnel-key.
export PATH="$HOME/.npm-global/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [ -z "${TUNNEL_BASE_URL:-}" ] && [ -f "$SCRIPT_DIR/.tunnel-url" ]; then
  export TUNNEL_BASE_URL="$(cat "$SCRIPT_DIR/.tunnel-url")"
fi
: "${TUNNEL_BASE_URL:?Set TUNNEL_BASE_URL atau buat file .tunnel-url dulu (isi: https://gatekeeper-agent-games.pages.dev)}"
export TUNNEL_LOCAL="http://127.0.0.1:3000"
export TUNNEL_KEY_FILE="$HOME/.gatekeeper-tunnel-key"
while true; do
  echo "[$(date -u '+%H:%M:%S')] starting gatekeeper tunnel client -> $TUNNEL_BASE_URL -> $TUNNEL_LOCAL..." >> tunnel.log
  node ~/hermuse/tunnel-client.mjs >> tunnel.log 2>&1
  echo "[$(date -u '+%H:%M:%S')] tunnel client exited (code $?), restarting in 5s..." >> tunnel.log
  sleep 5
done
