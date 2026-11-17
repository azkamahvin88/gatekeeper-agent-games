// proof.mjs — local Groth16 proof generation (snarkjs) + optional Kurier submission.
//
// Circuit inputs, discovered empirically from gatekeeper.wasm (14 Nov 2026):
// the wasm exposes exactly 13 input signals (getInputSize() = 13, nPublic = 13):
//   salt, minimum, recipient, amount, decision, registeredVkHash, proofVkHash,
//   publicBalance, expiryBlock, currentBlock, conditionRecipient, maxTransfer, taskId
// (probed by FNV-1a hashing candidate names and asking the wasm for each
//  signal's size; random control strings returned 0 = not found.)
//
// ENCODING — UNVERIFIED against the platform (the platform publishes no
// encoding spec; these are the natural encodings, to be confirmed by the
// local witness test + Practice Mode):
//   integers / block numbers : decimal string as-is
//   addresses                : BigInt(address) as decimal string
//   registeredVkHash / proofVkHash : BigInt(vk hex) mod p   (PROOF_VK_MODE=bigint)
//                                or keccak256(vk bytes) mod p (PROOF_VK_MODE=keccak)
//   taskId                   : keccak256(utf8 task_id) mod p (PROOF_TASKID_MODE=keccak)
//                                or 0 (PROOF_TASKID_MODE=zero)
//   decision                 : 1 = APPROVE, 0 = REJECT
//   salt                     : random 254-bit field element per task
// Flip the modes with env vars; the local witness test (test_proof.mjs)
// reports which combination actually satisfies the circuit.
import { groth16 } from "snarkjs";
import { keccak256 } from "js-sha3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CIRCUITS_DIR = path.join(__dirname, "circuits");
export const WASM_PATH = path.join(CIRCUITS_DIR, "gatekeeper.wasm");
export const ZKEY_PATH = path.join(CIRCUITS_DIR, "gatekeeper_final.zkey");
export const VK_PATH = path.join(CIRCUITS_DIR, "vk.json");

export const BN128_P = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);
export const GATEKEEPER_VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab4970c90c5316d4168bfbad77b0"; // from /api/circuit-info
export const KURIER_API_URL = "https://api.kurier.xyz/api/v1";

const modP = (x) => ((x % BN128_P) + BN128_P) % BN128_P;
const hexToBig = (h) => BigInt(h);
const keccakModP = (bytes) => modP(BigInt("0x" + keccak256(bytes)));

export function randomSalt() {
  // Random 254-bit field element (non-zero).
  let v = 0n;
  while (v === 0n) v = modP(BigInt("0x" + crypto.randomBytes(32).toString("hex")));
  return v.toString();
}

/** Build the circuit input object for one task + decision. */
export function buildCircuitInput(task, decision, salt) {
  const vkMode = process.env.PROOF_VK_MODE || "bigint";
  const taskIdMode = process.env.PROOF_TASKID_MODE || "keccak";
  const vkHash = (v) =>
    vkMode === "keccak"
      ? keccakModP(Buffer.from(String(v).slice(2), "hex"))
      : modP(hexToBig(String(v)));
  const taskId =
    taskIdMode === "zero"
      ? 0n
      : keccakModP(Buffer.from(String(task.task_id), "utf8"));
  return {
    salt: String(salt ?? randomSalt()),
    minimum: String(task.minimum),
    recipient: hexToBig(String(task.recipient)).toString(),
    amount: String(task.amount),
    decision: decision === "APPROVE" ? "1" : "0",
    registeredVkHash: vkHash(task.registered_vk).toString(),
    proofVkHash: vkHash(task.proof_vk).toString(),
    publicBalance: String(task.public_balance),
    expiryBlock: String(task.expiry_block),
    currentBlock: String(task.current_block),
    conditionRecipient: hexToBig(String(task.condition_recipient)).toString(),
    maxTransfer: String(task.max_transfer),
    taskId: taskId.toString(),
  };
}

/**
 * Generate + locally verify a Groth16 proof for one task.
 * @returns {Promise<{proof: object, publicSignals: string[]}|null>}
 *          null when generation/verification fails (caller must still answer
 *          with the decision but without proof fields).
 */
export async function generateProof(task, decision, salt, timeoutMs = 50000) {
  const input = buildCircuitInput(task, decision, salt);
  const vk = JSON.parse(fs.readFileSync(VK_PATH, "utf8"));
  const job = (async () => {
    const { proof, publicSignals } = await groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
    const ok = await groth16.verify(vk, publicSignals, proof);
    if (!ok) throw new Error("local groth16 verification failed");
    return { proof, publicSignals };
  })();
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("proof generation timeout")), timeoutMs),
  );
  try {
    return await Promise.race([job, timer]);
  } catch (e) {
    // Do not let a stray fullProve keep the process busy after a timeout.
    job.catch(() => {});
    throw e;
  }
}

/** Submit a proof to Kurier (mainnet). Returns the job id. Throws on HTTP error. */
export async function submitToKurier(proof, publicSignals, apiKey) {
  const res = await fetch(`${KURIER_API_URL}/submit-proof/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proofType: "groth16",
      vkRegistered: true,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: { proof, publicSignals, vk: GATEKEEPER_VK_HASH },
    }),
  });
  if (!res.ok) throw new Error(`Kurier submit HTTP ${res.status}`);
  const body = await res.json();
  return body.jobId ?? body.id ?? body;
}

/** Poll a Kurier job until Finalized/Failed or the deadline. Returns last status. */
export async function pollKurierJob(jobId, apiKey, { intervalMs = 5000, maxMs = 180000 } = {}) {
  const started = Date.now();
  let last = null;
  for (;;) {
    const res = await fetch(`${KURIER_API_URL}/job-status/${encodeURIComponent(apiKey)}/${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
    if (!res.ok) throw new Error(`Kurier job-status HTTP ${res.status}`);
    last = await res.json();
    const status = last.status ?? last.jobStatus ?? last.state;
    if (status === "Finalized" || status === "Failed") return last;
    if (Date.now() - started > maxMs) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
