// Test: can we generate a valid Groth16 proof for the gatekeeper circuit?
// Tries candidate encodings for vkHash/taskId and decision values on a
// VALID mock task (all checks pass). A witness only computes if the
// circuit's assertions hold, so success tells us the encoding + decision
// mapping; failure messages tell us which assertion broke.
import { groth16 } from "snarkjs";
import { keccak256 } from "js-sha3";
import fs from "node:fs";

const P = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const modP = (x) => ((x % P) + P) % P;
const hexToBig = (h) => BigInt(h);
const keccakModP = (bytes) => modP(BigInt("0x" + keccak256(bytes)));

const VK = "0x7d3a00000000000000000000000000000000f291";
const RECIP = "0xDe42000000000000000000000000000000009f01";

const task = {
  registered_vk: VK,
  proof_vk: VK, // same -> VK matches
  minimum: "1000",
  public_balance: "1460",
  expiry_block: 8430000,
  current_block: 8420000,
  recipient: RECIP,
  condition_recipient: RECIP,
  amount: "500",
  max_transfer: "1000",
  proof_tx: "0xa8c100000000000000000000000000000000008ff1",
  task_id: "gk_8d31_test001",
};

function buildInput(task, decision, vkMode, taskIdMode, salt) {
  const vkHash =
    vkMode === "bigint"
      ? (v) => modP(hexToBig(v))
      : (v) => keccakModP(Buffer.from(v.slice(2), "hex"));
  const taskId =
    taskIdMode === "keccak"
      ? keccakModP(Buffer.from(task.task_id, "utf8"))
      : taskIdMode === "zero"
        ? 0n
        : BigInt("0x" + task.task_id.replace(/[^0-9a-fA-F]/g, "").slice(0, 16) || "0");
  return {
    salt: salt.toString(),
    minimum: task.minimum,
    recipient: hexToBig(task.recipient).toString(),
    amount: task.amount,
    decision: decision.toString(),
    registeredVkHash: vkHash(task.registered_vk).toString(),
    proofVkHash: vkHash(task.proof_vk).toString(),
    publicBalance: task.public_balance,
    expiryBlock: task.expiry_block.toString(),
    currentBlock: task.current_block.toString(),
    conditionRecipient: hexToBig(task.condition_recipient).toString(),
    maxTransfer: task.max_transfer,
    taskId: taskId.toString(),
  };
}

const vk = JSON.parse(fs.readFileSync("circuits/vk.json", "utf8"));
const wasm = "circuits/gatekeeper.wasm";
const zkey = "circuits/gatekeeper_final.zkey";

const t0 = Date.now();
for (const vkMode of ["bigint", "keccak"]) {
  for (const taskIdMode of ["keccak", "zero"]) {
    for (const decision of [1, 0]) {
      const input = buildInput(task, decision, vkMode, taskIdMode, 12345);
      try {
        const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
        const ok = await groth16.verify(vk, publicSignals, proof);
        console.log(`SUCCESS vkMode=${vkMode} taskIdMode=${taskIdMode} decision=${decision} verify=${ok}`);
        console.log("  publicSignals:", JSON.stringify(publicSignals));
        console.log("  proof.pi_a:", JSON.stringify(proof.pi_a));
        fs.writeFileSync(`proof_valid_${vkMode}_${taskIdMode}_d${decision}.json`, JSON.stringify({ proof, publicSignals }, null, 2));
      } catch (e) {
        console.log(`FAIL vkMode=${vkMode} taskIdMode=${taskIdMode} decision=${decision}: ${String(e.message || e).split("\n")[0].slice(0, 300)}`);
      }
    }
  }
}
console.log("elapsed ms:", Date.now() - t0);
process.exit(0);
