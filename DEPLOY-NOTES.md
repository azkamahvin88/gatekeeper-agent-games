# Gatekeeper — Catatan Deploy (15 Nov 2026, ~10:48 WIB)

## Yang SUDAH selesai (tanpa login Cloudflare)
- **Agent server JALAN lokal**: `node server.mjs` (PID 23837), supervisor `start-agent.sh` (PID 23831),
  log `~/workspace/zkverify-agent-games/agent/agent.log`. Port 3000, proof_enabled=true, kurier=disabled.
- **Verifikasi lokal lolos** (probe 10:48 WIB): /health 200; preflight 200 `{ok:true, protocolVersion:"v1"}`
  + tanda tangan respons valid; tugas VALID -> APPROVE + proof (13 sinyal); jebakan VK_SUBSTITUTION -> REJECT + proof.
- **Tunnel Pages disiapkan**: `~/workspace/zkverify-agent-games/tunnel-pages/`
  (functions/ + schema.sql + migrations/ disalin dari pola tunnel Hermuse; TIDAK pakai nama/project Hermuse).
  - Pages project: **gatekeeper-agent-games** -> `https://gatekeeper-agent-games.pages.dev`
  - D1: **gatekeeper-state** (database_id masih placeholder di wrangler.toml — diisi setelah D1 dibuat)
  - Key tunnel + health dibuat (mode 600): `~/.gatekeeper-tunnel-key`, `~/.gatekeeper-health-key`
    (nilai TIDAK dicatat di file mana pun; dipakai untuk `wrangler pages secret put` nanti).
  - `start-tunnel.sh` siap (TUNNEL_LOCAL=http://127.0.0.1:3000, key file di atas).
- **.env agent**: placeholder HMAC secret (`test-placeholder-only...`) — WAJIB diganti secret asli dari Rotate Secret
  sebelum ronde berskor, lalu restart agent. Tanpa secret asli, platform menolak semua request.
- **Kurier**: TIDAK aktif (user tidak menyetujui, opsional $0,005/submit). Proof tetap dibuat lokal via snarkjs
  dan dikirim di respons; hanya finalisasi Kurier yang tidak terlacak.

## BLOKIR — butuh login Cloudflare (user)
- `wrangler whoami`: "You are not authenticated". `CLOUDFLARE_API_TOKEN` tidak ada di env.
  `wrangler login` butuh OAuth browser (dash.cloudflare.com -> callback http://localhost:8976) — dicoba 10:47 WIB,
  berhenti di halaman auth. TIDAK ada login Cloudflare tersimpan di Secure Vault (hanya binance/discord/github/
  google/make.fun/x/xingchiapi). JANGAN pakai login layanan lain.
- **Yang user lakukan**: selesaikan `wrangler login` di browser (atau beri CLOUDFLARE_API_TOKEN via Secure Vault).
  Setelah itu, jalankan (dari `tunnel-pages/`):
  1. `wrangler d1 create gatekeeper-state` -> salin UUID ke `database_id` di wrangler.toml
  2. `wrangler d1 execute gatekeeper-state --remote --file=schema.sql`
  3. `wrangler pages deploy . --project-name gatekeeper-agent-games`
  4. `wrangler pages secret put TUNNEL_KEY` (isi file ~/.gatekeeper-tunnel-key) dan
     `wrangler pages secret put HEALTH_KEY` (isi file ~/.gatekeeper-health-key)
  5. `echo -n 'https://gatekeeper-agent-games.pages.dev' > .tunnel-url && chmod 600 .tunnel-url`
  6. `setsid nohup bash start-tunnel.sh` (dari tunnel-pages/) -> cek tunnel.log
  7. Verifikasi publik: `curl https://gatekeeper-agent-games.pages.dev/__tunnel-health`
     (butuh header x-tunnel-health-key) dan POST preflight ke `https://gatekeeper-agent-games.pages.dev/agent`
     dengan signature HMAC (secret asli) -> harus `{ok:true, protocolVersion:"v1"}`.

## Setelah endpoint publik hidup — langkah dashboard (hanya dari sesi user)
1. Dashboard -> My Agents -> Register agent: URL `https://gatekeeper-agent-games.pages.dev/agent`, event Proof Gatekeeper.
2. Rotate Secret -> salin sekali -> ganti `AGENT_GAMES_HMAC_SECRET` di `agent/.env` -> restart agent
   (kill PID server 23837; supervisor start-agent.sh akan me-restart otomatis — atau restart manual).
3. Hubungkan wallet klaim hadiah: **DOMPET LAMA 0x92EE0ff5382A67F7B79FC19cD0192653ABEBbbdd**
   (perintah user 15 Nov 10:44 WIB). JANGAN pakai email helmi.syaftika@gmail.com di Agent Games.
4. Preflight dari dashboard (harus lolos), lalu Practice Mode (maks 10 dispatch/jam) untuk verifikasi
   encoding proof (default PROOF_VK_MODE=bigint, PROOF_TASKID_MODE=keccak; bila gagal coba keccak).
5. Masuk ronde berskor. Ronde 3 buka 15 Nov 17:30 WIB (s.d. 16 Nov 03:30 WIB); ronde 3–8: 15–20 Nov.

## Risiko / catatan
- VM restart membunuh server + tunnel (nohup tidak persisten). Perlu watchdog cron (parent yang pasang)
  atau start ulang manual: `bash agent/start-agent.sh` + `bash tunnel-pages/start-tunnel.sh`.
- Secret placeholder saat ini: preflight LOKAL lolos, tapi platform akan menolak sampai secret asli dipasang.
- State probe (gk_probe_valid_001 APPROVED) tersimpan di agent/state/ — tidak mengganggu ronde (task_id/proof_tx beda).
