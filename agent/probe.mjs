// Probe: enumerate which input signal names exist in gatekeeper.wasm
// by FNV-1a hashing candidate names and asking the wasm for their size.
// getInputSignalSize < 0  => name not found.  >= 0 => found (size = arity).
import fs from "node:fs";
import { WitnessCalculatorBuilder } from "circom_runtime";

function fnvHash(str) {
  const uint64_max = BigInt(2) ** BigInt(64);
  let hash = BigInt("0xCBF29CE484222325");
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str[i].charCodeAt(0));
    hash *= BigInt(0x100000001B3);
    hash %= uint64_max;
  }
  let shash = hash.toString(16);
  shash = "0".repeat(16 - shash.length).concat(shash);
  return shash;
}

const wasm = fs.readFileSync("circuits/gatekeeper.wasm");
const wc = await WitnessCalculatorBuilder(wasm, { sanityCheck: false });
const ex = wc.instance.exports;
ex.init(0);
console.log("circom version:", ex.getVersion(), ex.getMinorVersion(), ex.getPatchVersion());
console.log("getInputSize (total input signals):", ex.getInputSize());
console.log("getWitnessSize:", ex.getWitnessSize());

const base = [
  "registered_vk","proof_vk","minimum","public_balance","expiry_block","current_block",
  "recipient","condition_recipient","amount","max_transfer","proof_tx","task_id",
  "decision","reason_code","mode","issued_at","deadline_at",
  "registeredVk","proofVk","publicBalance","expiryBlock","currentBlock",
  "conditionRecipient","maxTransfer","proofTx","taskId","reasonCode",
  "vk","vkHash","registeredVkHash","proofVkHash","vk_registered","vk_proof",
  "balance","threshold","expiry","current","recipientHash","amountHash",
  "approved","approve","isApproved","isValid","valid","result","outcome",
  "decisionCode","action","taskHash","statementHash","conditionHash","proofHash",
  "txHash","inputHash","in","input","publicInput","a","b","x","y","s","v","d",
  "statement","condition","proof","public_signals","publicSignals",
  "registered_vk_hash","proof_vk_hash","minimum_amount","max_amount",
  "sender","payer","payout","transfer","limit","cap","block","height",
  "decision_value","decision_flag","is_approved","is_valid","check","checks",
  "trap","trap_type","trapType","valid_condition","isValidCondition",
  "nonce","agent_id","agentId","event","eventId",
];
const candidates = [...new Set([...base, ...base.map((n) => "main." + n)])];

const found = [];
for (const name of candidates) {
  const h = fnvHash(name);
  const hMSB = parseInt(h.slice(0, 8), 16);
  const hLSB = parseInt(h.slice(8, 16), 16);
  let size;
  try {
    size = ex.getInputSignalSize(hMSB, hLSB);
  } catch (e) {
    size = "ERR";
  }
  if (typeof size === "number" && size >= 0) {
    found.push([name, size]);
    console.log("FOUND:", name, "size:", size);
  }
}
console.log("total found:", found.length, "of", candidates.length, "candidates");
