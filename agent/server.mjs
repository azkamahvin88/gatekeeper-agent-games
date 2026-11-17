// server.mjs — Proof Gatekeeper agent for zkVerify Agent Games Season 01.
//
// POST /agent
//   1. Verify x-agent-games-signature (HMAC-SHA256 over the RAW body) BEFORE
//      parsing. 401 on mismatch. Header accepted as hex, optionally prefixed
//      with "sha256=" (the exact header format is NOT documented on /build;
//      preflight will confirm it).
//   2. Preflight (type agent-games.preflight.v1) -> {ok:true, protocolVersion:"v1"}.
//   3. Gatekeeper (type agent-games.proof-gatekeeper.v1) -> deterministic
//      decision via gatekeeper.mjs, Groth16 proof via proof.mjs, response
//      signed with x-agent-games-signature over the raw response body.
//   4. Fail closed: any error/uncertainty/timeout -> REJECT (never APPROVE
//      by default); a proof failure still returns the decision, minus proof
//      fields (costs -2, but a timeout would lose the decision too).
//   5. Idempotency: a retried task_id returns the cached response.
//      A proof_tx is recorded as seen only when its task is APPROVED.
//
// Env (see .env.example):
//   AGENT_GAMES_HMAC_SECRET  required — from dashboard "Rotate Secret"
//   PORT                     default 3000
//   KURIER_API_KEY           optional — enables Kurier submit + background poll
//   PROOF_ENABLED            default "1" — set "0" to answer without proofs
//   PROOF_VK_MODE / PROOF_TASKID_MODE — proof input encodings (see proof.mjs)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./gatekeeper.mjs";
import { generateProof, submitToKurier, pollKurierJob } from "./proof.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, "state");
fs.mkdirSync(STATE_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const HMAC_SECRET = process.env.AGENT_GAMES_HMAC_SECRET;
if (!HMAC_SECRET) {
  console.error("FATAL: AGENT_GAMES_HMAC_SECRET is not set. See .env.example.");
  process.exit(1);
}
const PROOF_ENABLED = process.env.PROOF_ENABLED !== "0";
const KURIER_API_KEY = process.env.KURIER_API_KEY || "";
const REQUEST_MAX_BYTES = 1_000_000;
const PROOF_TIMEOUT_MS = 50_000;

function log(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const decisionsFile = path.join(STATE_DIR, "decisions.json");
const seenFile = path.join(STATE_DIR, "seen_proof_tx.json");
const kurierFile = path.join(STATE_DIR, "kurier_jobs.json");
const decisions = loadJson(decisionsFile, {}); // task_id -> response object
const seenProofTx = loadJson(seenFile, {}); // proof_tx (lowercase) -> task_id
const kurierJobs = loadJson(kurierFile, {}); // task_id -> {jobId, status}

function hmacHex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}
function signatureMatches(header, rawBody) {
  if (!header) return false;
  const given = String(header).replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = hmacHex(HMAC_SECRET, rawBody);
  if (given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

function sendSigned(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "x-agent-games-signature": hmacHex(HMAC_SECRET, body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > REQUEST_MAX_BYTES) {
        reject(new Error("request too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleGatekeeper(env, startedMs) {
  const input = env.input || {};
  const taskId = env.task_id;
  const proofTx = typeof input.proof_tx === "string" ? input.proof_tx.toLowerCase() : "";

  // Idempotency: a retried task_id returns the exact cached response.
  if (taskId && decisions[taskId]) {
    return { status: 200, body: decisions[taskId], cached: true };
  }

  const { decision, reason_code } = decide(input, (tx) => seenProofTx[tx] || null);

  // Build the response. Proof is included on every provable task except
  // PROOF_REUSED (the platform excludes those from the proof requirement).
  const response = { decision, reason_code, proof_tx: input.proof_tx || null };
  let proofGenerated = false;
  if (PROOF_ENABLED && reason_code !== "PROOF_REUSED") {
    try {
      const { proof, publicSignals } = await generateProof(input, decision, undefined, PROOF_TIMEOUT_MS);
      response.proof = proof;
      response.public_signals = publicSignals;
      proofGenerated = true;
    } catch (e) {
      log({ level: "warn", task_id: taskId, msg: "proof generation failed, answering without proof", error: String(e.message || e).slice(0, 200) });
    }
  }

  // Persist: record the proof as seen only when the task is APPROVED.
  if (taskId) {
    decisions[taskId] = response;
    saveJson(decisionsFile, decisions);
  }
  if (decision === "APPROVE" && proofTx) {
    seenProofTx[proofTx] = taskId || "unknown";
    saveJson(seenFile, seenProofTx);
  }

  // Kurier: submit MY proof in the background (never blocks the 60s answer).
  if (KURIER_API_KEY && proofGenerated) {
    submitToKurier(response.proof, response.public_signals, KURIER_API_KEY)
      .then((jobId) => {
        kurierJobs[taskId || "unknown"] = { jobId, status: "Submitted" };
        saveJson(kurierFile, kurierJobs);
        return pollKurierJob(jobId, KURIER_API_KEY).then((last) => {
          kurierJobs[taskId || "unknown"] = { jobId, status: last.status ?? last.jobStatus ?? "unknown", last };
          saveJson(kurierFile, kurierJobs);
          log({ level: "info", task_id: taskId, msg: "kurier job settled", jobId, status: kurierJobs[taskId || "unknown"].status });
        });
      })
      .catch((e) => log({ level: "warn", task_id: taskId, msg: "kurier submit failed", error: String(e.message || e).slice(0, 200) }));
  }

  log({
    level: "info",
    task_id: taskId,
    decision,
    reason_code,
    proof_tx: proofTx || null,
    proof_generated: proofGenerated,
    kurier: KURIER_API_KEY ? "enabled" : "disabled",
    duration_ms: Date.now() - startedMs,
  });
  return { status: 200, body: response, cached: false };
}

const server = http.createServer(async (req, res) => {
  const startedMs = Date.now();
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, protocolVersion: "v1" }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/agent") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const rawBody = await readBody(req);
    if (!signatureMatches(req.headers["x-agent-games-signature"], rawBody)) {
      log({ level: "warn", msg: "HMAC mismatch, rejecting request" });
      sendSigned(res, 401, { error: "invalid signature" });
      return;
    }
    let env;
    try {
      env = JSON.parse(rawBody.toString("utf8"));
    } catch {
      sendSigned(res, 400, { error: "invalid json" });
      return;
    }

    // Preflight — the platform's health check.
    if (env.type === "agent-games.preflight.v1") {
      sendSigned(res, 200, { ok: true, protocolVersion: "v1" });
      log({ level: "info", msg: "preflight ok", agent_id: env.agent_id || null });
      return;
    }

    if (env.type !== "agent-games.proof-gatekeeper.v1") {
      sendSigned(res, 400, { error: "unknown task type" });
      return;
    }

    // Envelope freshness: fail closed on stale / far-future tasks.
    const now = Date.now();
    const deadline = env.deadline_at ? Date.parse(env.deadline_at) : NaN;
    const issued = env.issued_at ? Date.parse(env.issued_at) : NaN;
    if (!Number.isNaN(deadline) && deadline <= now) {
      sendSigned(res, 400, { error: "task deadline already passed" });
      return;
    }
    if (!Number.isNaN(issued) && (now - issued > 10 * 60 * 1000 || issued - now > 5 * 60 * 1000)) {
      sendSigned(res, 400, { error: "task timestamp out of range" });
      return;
    }
    if (!env.task_id || !env.input || typeof env.input !== "object") {
      sendSigned(res, 400, { error: "missing task_id or input" });
      return;
    }

    const { status, body } = await handleGatekeeper(env, startedMs);
    sendSigned(res, status, body);
  } catch (e) {
    log({ level: "error", msg: "unhandled error", error: String(e.message || e).slice(0, 300) });
    try {
      sendSigned(res, 500, { error: "internal error" });
    } catch {}
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log({ level: "info", msg: "gatekeeper agent listening", port: PORT, proof_enabled: PROOF_ENABLED, kurier: KURIER_API_KEY ? "enabled" : "disabled" });
});
