// Probe round 2: controls + hunt for the 13th input signal.
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

function sizeOf(name) {
  const h = fnvHash(name);
  const hMSB = parseInt(h.slice(0, 8), 16);
  const hLSB = parseInt(h.slice(8, 16), 16);
  try {
    return ex.getInputSignalSize(hMSB, hLSB);
  } catch (e) {
    return "ERR:" + e.message;
  }
}

// Controls: random gibberish must return 0 if the method is sound.
for (const c of ["zzzzqqqq12345", "flibberty", "notasignal", "xxxxxxxx", "qwertyuiop"]) {
  console.log("control", c, "->", sizeOf(c));
}

const candidates = [
  "proofTxHash","proof_tx_hash","proofTx","proof_tx","deadlineAt","deadline_at",
  "deadline","issuedAt","issued_at","timestamp","reasonCode","reason_code",
  "hash","salt","nullifier","commitment","commitmentHash","one","out","output",
  "decisionValue","decision_code","decisionCode","approvedFlag","isTrap",
  "trapCode","trap_code","validCondition","conditionValid","proofValid",
  "vkRegistered","vkProof","registered","proof","tx","ref","reference",
  "proofRef","proofReference","proof_reference","task","taskHash","task_hash",
  "input","inputs","publicInput","publicInputs","signal","signals",
  "registeredVk","proofVk","registered_vk","proof_vk","public_balance",
  "expiry_block","current_block","condition_recipient","max_transfer",
  "task_id","minimum","recipient","amount","decision",
  "registeredVkHash","proofVkHash","publicBalance","expiryBlock","currentBlock",
  "conditionRecipient","maxTransfer","taskId",
  "decisionHash","outcomeHash","resultHash","evaluation","evaluationResult",
  "gatekeeper","gatekeeperDecision","verdict","verdictCode","code",
  "blockHeight","block_height","currentBlockHeight","expiryHeight",
  "minAmount","min_amount","requiredMinimum","required_minimum",
  "availableBalance","available_balance","balanceInProof","proofBalance",
  "recipientAddress","recipient_address","expectedRecipient","expected_recipient",
  "payee","beneficiary","amountRequested","requestedAmount","requested_amount",
  "transferCap","transfer_cap","singleTransferCap","maxAmount","max_amount",
];
for (const name of candidates) {
  const s = sizeOf(name);
  if (typeof s === "number" && s !== 0) console.log("SIZE!=0:", name, "->", s);
}
console.log("done");
