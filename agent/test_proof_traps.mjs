// Test: trap tasks must prove with decision=0 (REJECT) and FAIL with decision=1.
// Valid task must prove with decision=1 and FAIL with decision=0 (shown before).
// This confirms the circuit enforces decision == expected, and 1=APPROVE / 0=REJECT.
import { groth16 } from "snarkjs";
import fs from "node:fs";
import { buildCircuitInput } from "./proof.mjs";

const vk = JSON.parse(fs.readFileSync("circuits/vk.json", "utf8"));
const wasm = "circuits/gatekeeper.wasm";
const zkey = "circuits/gatekeeper_final.zkey";

const VK = "0x7d3a00000000000000000000000000000000f291";
const VK_OTHER = "0x13aa00000000000000000000000000000000b8ff";
const RECIP = "0xDe42000000000000000000000000000000009f01";
const RECIP_OTHER = "0x1111000000000000000000000000000000002222";

function base(overrides = {}, taskId = "gk_trap_001") {
  return {
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
    task_id: taskId,
    ...overrides,
  };
}

const cases = [
  { name: "VALID", task: base({}, "gk_v_001"), expectOk: { 1: true, 0: false } },
  { name: "VK_SUBSTITUTION", task: base({ proof_vk: VK_OTHER }, "gk_vk_001"), expectOk: { 1: false, 0: true } },
  { name: "THRESHOLD_MISMATCH", task: base({ public_balance: "999" }, "gk_th_001"), expectOk: { 1: false, 0: true } },
  { name: "RECIPIENT_MISMATCH", task: base({ recipient: RECIP_OTHER }, "gk_rc_001"), expectOk: { 1: false, 0: true } },
  { name: "AMOUNT_OVERFLOW", task: base({ amount: "1001" }, "gk_am_001"), expectOk: { 1: false, 0: true } },
  { name: "EXPIRED_CONDITION", task: base({ current_block: 8430000 }, "gk_ex_001"), expectOk: { 1: false, 0: true } },
];

let pass = 0;
let total = 0;
for (const c of cases) {
  for (const decision of [1, 0]) {
    total++;
    const input = buildCircuitInput(c.task, decision === 1 ? "APPROVE" : "REJECT", "12345");
    const t0 = Date.now();
    let ok = false;
    let errMsg = "";
    try {
      const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
      ok = await groth16.verify(vk, publicSignals, proof);
    } catch (e) {
      errMsg = String(e.message || e).split("\n")[0].slice(0, 120);
    }
    const ms = Date.now() - t0;
    const want = c.expectOk[decision];
    const good = ok === want;
    if (good) pass++;
    console.log(`${good ? "PASS" : "FAIL"}  ${c.name} decision=${decision} prove_ok=${ok} want=${want} (${ms}ms)${errMsg ? " err=" + errMsg : ""}`);
  }
}
console.log(`\n${pass}/${total} proof-behavior checks passed.`);
process.exit(pass === total ? 0 : 1);
