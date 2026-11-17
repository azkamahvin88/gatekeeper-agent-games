// test_server.mjs — local test harness for the Gatekeeper agent.
// Starts server.mjs as a child process with a TEST HMAC secret, then
// exercises: preflight (good/bad signature), and one mock task per trap
// variety from the event page's trap encyclopedia. Verifies every response
// signature and prints a PASS/FAIL table. Exits non-zero on any failure.
//
// Usage:  node test_server.mjs
// Requires: circuits downloaded, vk.json exported (done during setup).
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_SECRET = "test-harness-secret-12345";
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;

// Fresh state for the harness run.
for (const f of ["decisions.json", "seen_proof_tx.json", "kurier_jobs.json"]) {
  try {
    fs.unlinkSync(path.join(__dirname, "state", f));
  } catch {}
}

const hmac = (body) => crypto.createHmac("sha256", TEST_SECRET).update(body).digest("hex");

async function post(pathname, obj, { sign = true, secret = TEST_SECRET } = {}) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const headers = { "content-type": "application/json" };
  if (sign) headers["x-agent-games-signature"] = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const res = await fetch(BASE + pathname, { method: "POST", headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, respSig: res.headers.get("x-agent-games-signature"), rawBody: text };
}

function verifyRespSig(entry) {
  if (!entry.respSig) return false;
  const expected = hmac(Buffer.from(entry.rawBody, "utf8"));
  const a = entry.respSig.replace(/^sha256=/i, "").toLowerCase();
  return a.length === expected.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(expected));
}

const VK = "0x7d3a00000000000000000000000000000000f291";
const VK_OTHER = "0x13aa00000000000000000000000000000000b8ff";
const RECIP = "0xDe42000000000000000000000000000000009f01";
const RECIP_OTHER = "0x1111000000000000000000000000000000002222";

function task(overrides = {}, taskId = "gk_test_001") {
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: taskId,
    mode: "practice",
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
    input: {
      registered_vk: VK,
      proof_vk: VK,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: 8430000,
      current_block: 8420000,
      recipient: RECIP,
      condition_recipient: RECIP,
      amount: "500",
      max_transfer: "1000",
      proof_tx: "0xa8c100000000000000000000000000000000008ff1",
      ...overrides,
    },
  };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + "/health");
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const child = spawn("node", ["server.mjs"], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), AGENT_GAMES_HMAC_SECRET: TEST_SECRET },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stdout.write("[server] " + d));
child.stderr.on("data", (d) => process.stderr.write("[server:err] " + d));

try {
  if (!(await waitHealth())) throw new Error("server did not come up");

  // 1. Preflight, valid signature.
  const pf = await post("/agent", { type: "agent-games.preflight.v1", agent_id: "agt_test", issued_at: new Date().toISOString(), nonce: "abc123" });
  check("preflight valid signature -> 200 {ok:true}", pf.status === 200 && pf.json?.ok === true && pf.json?.protocolVersion === "v1", `status=${pf.status}`);
  check("preflight response signature valid", verifyRespSig(pf));

  // 2. Preflight, bad signature -> 401.
  const pfBad = await post("/agent", { type: "agent-games.preflight.v1", agent_id: "agt_test", issued_at: new Date().toISOString(), nonce: "abc123" }, { secret: "wrong-secret" });
  check("preflight bad signature -> 401", pfBad.status === 401, `status=${pfBad.status}`);

  // 3. Missing signature -> 401.
  const pfNoSig = await post("/agent", { type: "agent-games.preflight.v1" }, { sign: false });
  check("missing signature -> 401", pfNoSig.status === 401, `status=${pfNoSig.status}`);

  // 4. Decision cases.
  const cases = [
    { name: "VALID -> APPROVE", t: task({}, "gk_valid_001"), want: ["APPROVE", "VALID_CONDITION"], proof: true },
    { name: "VK_SUBSTITUTION -> REJECT", t: task({ proof_vk: VK_OTHER }, "gk_vk_001"), want: ["REJECT", "VK_SUBSTITUTION"], proof: true },
    { name: "THRESHOLD_MISMATCH -> REJECT", t: task({ public_balance: "999" }, "gk_thr_001"), want: ["REJECT", "THRESHOLD_MISMATCH"], proof: true },
    { name: "RECIPIENT_MISMATCH -> REJECT", t: task({ recipient: RECIP_OTHER }, "gk_rec_001"), want: ["REJECT", "RECIPIENT_MISMATCH"], proof: true },
    { name: "AMOUNT_OVERFLOW -> REJECT", t: task({ amount: "1001" }, "gk_amt_001"), want: ["REJECT", "AMOUNT_OVERFLOW"], proof: true },
    { name: "EXPIRED_CONDITION -> REJECT", t: task({ current_block: 8430000 }, "gk_exp_001"), want: ["REJECT", "EXPIRED_CONDITION"], proof: true },
    // Reuse the proof_tx of the VALID task above, new task_id -> PROOF_REUSED.
    { name: "PROOF_REUSED -> REJECT", t: task({}, "gk_reuse_001"), want: ["REJECT", "PROOF_REUSED"], proof: false },
    // Idempotent retry of the VALID task_id -> same response as first time.
    { name: "retry same task_id -> cached APPROVE", t: task({}, "gk_valid_001"), want: ["APPROVE", "VALID_CONDITION"], proof: true },
  ];
  for (const c of cases) {
    const r = await post("/agent", c.t);
    const okDecision = r.status === 200 && r.json?.decision === c.want[0] && r.json?.reason_code === c.want[1];
    check(`${c.name} decision`, okDecision, `status=${r.status} got=${r.json?.decision}/${r.json?.reason_code}`);
    check(`${c.name} response signature valid`, verifyRespSig(r));
    check(`${c.name} proof_tx echoed`, r.json?.proof_tx === c.t.input.proof_tx);
    const hasProof = !!(r.json?.proof && r.json?.public_signals);
    if (c.proof) check(`${c.name} includes Groth16 proof + public_signals`, hasProof);
    else check(`${c.name} omits proof (PROOF_REUSED excluded)`, !hasProof);
  }
} catch (e) {
  console.error("HARNESS ERROR:", e);
  results.push({ name: "harness", ok: false, detail: String(e.message || e) });
} finally {
  child.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(" -", f.name, f.detail || "");
  process.exit(1);
}
process.exit(0);
