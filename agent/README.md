# Proof Gatekeeper Agent — zkVerify Agent Games Season 01

Agent untuk track **Proof Gatekeeper**: menerima tugas lewat HTTPS POST,
memutuskan APPROVE/REJECT secara deterministik dari 7 jenis jebakan yang
terdokumentasi, dan membuktikan keputusan itu dengan Groth16 proof
(snarkjs, sirkuit resmi) yang diverifikasi platform.

**Status: dibangun + lolos uji lokal penuh. Belum di-deploy, belum
didaftarkan.** Lihat [Blokir](#blokir--yang-butuh-user) di bawah.

## Hasil test lokal (14 Nov 2026)

| Suite | Hasil |
|---|---|
| `test_server.mjs` (preflight + HMAC + 6 keputusan + reuse + retry idempotent + tanda tangan respons) | **36/36 PASS** |
| `test_proof_traps.mjs` (proof benar/salah per keputusan: VALID + 5 trap × decision 1/0) | **12/12 PASS** |

- Generasi proof lokal: **~0,3–1,1 detik** per tugas (batas platform 60 detik).
- Proof diverifikasi lokal terhadap `vk.json` (`groth16.verify`) sebelum dikirim.
- Sirkuit: `GatekeeperEvaluation` (circom 2.2.3), Groth16/BN128, `nPublic = 13`,
  `vk_hash` `0x6b79c6012a6d8651f3e13bc4d2a20370280ab4970c90c5316d4168bfbad77b0`
  (dicocokkan dengan `https://agentgames.zkverify.io/api/circuit-info`).
- `npm test` penuh (server + proof) lolos **36/36 + 12/12, exit 0** setelah
  perbaikan URL Kurier.
- Catatan: `snarkjs` meninggalkan worker ports terbuka sehingga skrip
  sekali-jalan tidak exit sendiri — semua skrip test memanggil
  `process.exit()` eksplisit. Pool worker-nya tetap 4 port (diukur: tidak
  bertambah per proof), jadi server aman untuk 48 tugas.

## Cara jalanin

```bash
cd ~/workspace/zkverify-agent-games/agent
npm install            # snarkjs + js-sha3 (sudah terpasang)
cp .env.example .env   # isi AGENT_GAMES_HMAC_SECRET dari dashboard
npm start              # listen 0.0.0.0:$PORT (default 3000)
npm test               # test_server.mjs + test_proof_traps.mjs
```

Env vars (lihat `.env.example`):

| Var | Wajib | Keterangan |
|---|---|---|
| `AGENT_GAMES_HMAC_SECRET` | ya | Dari dashboard → Rotate Secret (ditampilkan sekali). Tanpa ini server tidak jalan. |
| `PORT` | tidak | Default `3000`. |
| `KURIER_API_KEY` | tidak | Bila diisi, proof saya ikut di-submit ke Kurier (background, tidak memblokir jawaban) dan statusnya dipoll sampai Finalized. |
| `PROOF_ENABLED` | tidak | Default `1`. Set `0` untuk menjawab tanpa proof (tiap tugas provable kena −2). |
| `PROOF_VK_MODE` | tidak | `bigint` (default) / `keccak` — encoding `registeredVkHash`/`proofVkHash`. |
| `PROOF_TASKID_MODE` | tidak | `keccak` (default) / `zero` — encoding `taskId`. |

## File

| File | Isi |
|---|---|
| `server.mjs` | HTTP server: verifikasi HMAC (raw body), preflight, routing Gatekeeper, tanda tangan respons, idempotency per `task_id`, seen-set `proof_tx`, submit Kurier background. |
| `gatekeeper.mjs` | Logika keputusan murni (tanpa I/O): 7 reason code dari trap encyclopedia. |
| `proof.mjs` | Build input sirkuit, `groth16.fullProve` + verifikasi lokal, submit + poll Kurier. |
| `circuits/` | `gatekeeper.wasm`, `gatekeeper_final.zkey`, `vk.json` (dari situs resmi). |
| `state/` | Data runtime (dibuat otomatis, gitignored): `decisions.json`, `seen_proof_tx.json`, `kurier_jobs.json`. |
| `probe.mjs`, `probe2.mjs` | Cara input sirkuit ditemukan (FNV-hash probing — lihat bawah). |
| `test_proof.mjs` | Eksperimen encoding awal (8 kombinasi). |
| `test_server.mjs`, `test_proof_traps.mjs` | Harness uji. |

## Logika keputusan

Urutan cek (satu mismatch = REJECT; tiap tugas hanya punya satu jenis jebakan):

1. `VK_SUBSTITUTION` — `proof_vk != registered_vk`
2. `THRESHOLD_MISMATCH` — `public_balance < minimum`
3. `RECIPIENT_MISMATCH` — `recipient != condition_recipient`
4. `AMOUNT_OVERFLOW` — `amount > max_transfer`
5. `EXPIRED_CONDITION` — `current_block >= expiry_block`
6. `PROOF_REUSED` — `proof_tx` sudah pernah dipakai tugas yang DI-APPROVE
7. Lolos semua → `APPROVE` / `VALID_CONDITION`

Respons: `{ decision, reason_code, proof_tx, proof, public_signals }`
+ header `x-agent-games-signature` (HMAC-SHA256 atas raw body respons).
Untuk `PROOF_REUSED`, proof sengaja tidak disertakan (platform mengecualikan
jenis ini dari syarat proof).

## Bagaimana input sirkuit ditemukan

Platform tidak mempublikasikan source `.circom` maupun file `.sym`.
Input sirkuit ditemukan secara empiris dari `gatekeeper.wasm`:

- `getInputSize()` = 13, `nPublic` = 13.
- `circom_runtime` memetakan nama sinyal lewat hash FNV-1a; `getInputSignalSize`
  mengembalikan ukuran sinyal (0 = tidak ada). Dengan menebak nama kandidat,
  ditemukan 13 input: `salt, minimum, recipient, amount, decision,
  registeredVkHash, proofVkHash, publicBalance, expiryBlock, currentBlock,
  conditionRecipient, maxTransfer, taskId`.
- Public signals (13, urutan dari `public.json`): `[<nilai hasil sirkuit>,
  registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
  currentBlock, recipient, conditionRecipient, amount, maxTransfer, decision,
  taskId]`. Sinyal pertama dihitung sirkuit dari input (berubah saat `taskId`
  berubah); `salt` tidak muncul di public signals (input privat).
- Sirkuit menegakkan `decision == expected`: keputusan benar membuktikan
  (witness terhitung), keputusan salah gagal di assertion template baris 102.
  `decision`: `1 = APPROVE`, `0 = REJECT`.

## Deploy yang direkomendasikan

**Satu jalur paling realistis (gratis): Cloudflare Pages + D1 polling tunnel
dari VM ini** — infrastruktur yang sama dengan tunnel Hermuse yang sudah ada
(`~/hermuse/tunnel-client.mjs`):

- Tunnel client meneruskan path apa adanya (`fetch(LOCAL + path)`), jadi
  dengan `TUNNEL_LOCAL=http://127.0.0.1:3000`, endpoint publiknya menjadi
  `https://<project>.pages.dev/agent` — HTTPS, tanpa custom port (sesuai
  aturan 1.2). Timeout first-byte 30 dtk (proof ~1 dtk, aman), batas respons
  ~1,35 MB (respons kita hanya beberapa KB).
- Agent + tunnel client harus dijaga tetap hidup (supervisor + cron watchdog,
  seperti `start-pages-tunnel.sh` / `restart-tunnel.sh`); VM restart membunuh
  proses nohup.
- **Butuh dari user (belum ada):** nama project Pages baru + nama D1 baru
  untuk agent ini (TIDAK memakai project/D1 Hermuse — satu tunnel client
  hanya meneruskan ke satu LOCAL), dan pilihan auth Cloudflare
  (`wrangler login` vs `CLOUDFLARE_API_TOKEN`). Setelah itu:
  `bash scripts/setup-tunnel.sh <pages> <d1>` lalu jalankan agent + tunnel
  client dengan `TUNNEL_LOCAL=http://127.0.0.1:3000`.

Alternatif yang dipertimbangkan dan ditolak:

- **Cloudflare Workers (free):** tidak realistis untuk `fullProve` snarkjs
  (batas CPU, runtime bukan Node).
- **Render/Railway/Fly free tier:** tidur setelah idle (platform memforfeit
  tugas saat agent offline) atau butuh kartu; tidak always-on gratis.
- **VPS berbayar (~$3–5/bln):** paling stabil, tapi berbayar — perlu
  persetujuan user.

## Pendaftaran di dashboard (setelah deploy)

1. Dashboard → My Agents → **Register agent**: nama agent, URL endpoint
   lengkap `https://<project>.pages.dev/agent`, pilih event Proof Gatekeeper.
2. **Rotate Secret** → salin sekali → isi `AGENT_GAMES_HMAC_SECRET` → restart agent.
3. Jalankan **preflight** dari dashboard (harus lolos sebelum agent aktif).
4. **Practice Mode** (Dashboard → Practice, maks 10 dispatch/jam): uji
   melawan tugas latihan — **ini satu-satunya cara memverifikasi encoding
   proof** (lihat bawah). Loloskan practice traps dulu.
5. Masuk ronde berskor. Ronde 3–8: 15–20 Nov, tiap hari 17:30–03:30 WIB,
   8 tugas/agent/ronde. Tutup 21 Nov.

Skor: benar +12, APPROVE jebakan −6, REJECT valid −3, timeout −2,
proof hilang/invalid −2, bonus reliabilitas +0..+5.

## Blokir — yang butuh user

1. **Hosting**: nama Pages + D1 baru + pilihan auth Cloudflare (lihat atas).
   Tanpa ini agent tidak bisa didaftarkan (endpoint harus publik HTTPS).
2. **Kurier API key (opsional tapi disarankan)**: daftar di https://kurier.xyz
   (mainnet). Submit proof $0,005/proof (USDC di Base, via x402) — untuk
   ~48 tugas tersisa ≈ **$0,24**. Tanpa key, proof tetap dibuat lokal dan
   dikirim di respons; hanya finalisasi Kurier yang tidak terlacak.
3. **Wallet untuk hadiah**: aturan 1.1 mewajibkan wallet terhubung untuk klaim
   VFY (GitHub sudah terhubung 14 Nov 23:30 WIB; wallet belum).
4. **Rotate Secret + klik Register agent + preflight + practice**: hanya bisa
   dari dashboard yang login (sesi user).

## Yang belum terverifikasi (jangan ditebak)

1. **Format header `x-agent-games-signature`**: /build tidak mendokumentasikan
   apakah hex polos atau `sha256=<hex>`. Server menerima keduanya; preflight
   akan mengonfirmasi.
2. **Encoding `registeredVkHash` / `proofVkHash` / `taskId` yang diharapkan
   platform**: tidak ada spesifikasinya. Proof lokal valid terhadap vk
   (terbukti 12/12), TAPI platform menghitung ulang public signals dari tugas
   yang dikirimnya — bila encoding saya berbeda dari platform, proof bisa
   ditolak platform walau valid secara kriptografis. Default: vkHash =
   `BigInt(vk) mod p`, taskId = `keccak256(task_id) mod p`. **Konfirmasi
   lewat Practice Mode setelah deploy**; bila gagal, coba `PROOF_VK_MODE=keccak`.
3. **Batas expiry** (`>=` vs `>`): dipakai `current_block >= expiry_block`.
4. **Seen-set**: hanya tugas APPROVED yang menandai `proof_tx` sebagai
   terpakai (sesuai "already accepted in a previous task").
5. **Verifikasi proof masuk (on-chain)**: Kurier tidak punya endpoint lookup
   untuk `proof_tx`; verifikasi on-chain penuh butuh zkVerifyJS + akun Volta
   terdanai — belum diimplementasikan. Agent memeriksa field tugas; platform
   yang memverifikasi ulang proof saya.
6. **Kurier `submit-proof`**: format dari /build + Swagger terverifikasi;
   `job-status` path-based (`/job-status/{apiKey}/{jobId}`) terverifikasi dari
   Swagger `https://api.kurier.xyz/docs/json`. Biaya $0,005/submit terverifikasi
   dari `GET /api/v1/pricing/`.

## Keamanan

- Tidak ada secret di kode/log/file (hanya placeholder di `.env.example`).
- HMAC diverifikasi atas raw body SEBELUM parsing; perbandingan
  `timingSafeEqual`; respons selalu ditandatangani.
- Fail closed: error/timeout/ragu → REJECT; proof gagal → jawab tanpa proof.
- Secret tidak pernah masuk log (log hanya `task_id`, keputusan, durasi).
- Tidak ada LLM — keputusan 100% deterministik dari checks di atas.
