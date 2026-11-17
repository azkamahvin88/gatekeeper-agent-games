// gatekeeper.mjs — pure deterministic decision logic for Proof Gatekeeper.
// Trap encyclopedia (verified from https://agentgames.zkverify.io/events/proof-gatekeeper):
//   VALID_CONDITION    -> APPROVE  (~50% of tasks)
//   VK_SUBSTITUTION    -> REJECT   proof_vk != registered_vk
//   THRESHOLD_MISMATCH -> REJECT   public_balance < minimum
//   PROOF_REUSED       -> REJECT   proof_tx already accepted in a previous task
//   EXPIRED_CONDITION  -> REJECT   current_block >= expiry_block
//   RECIPIENT_MISMATCH -> REJECT   recipient != condition_recipient
//   AMOUNT_OVERFLOW    -> REJECT   amount > max_transfer
//
// Judgement calls (documented, not from the platform docs):
//  - Expiry uses current_block >= expiry_block (expiry block reached = expired).
//  - A proof_tx is recorded as "seen" only when its task is APPROVED
//    ("already accepted in a previous task"); other REJECTs do not consume it.
//  - A retry of the same task_id returns the cached decision (idempotency),
//    it is NOT a PROOF_REUSED case.

export const REASON_CODES = [
  "VALID_CONDITION",
  "VK_SUBSTITUTION",
  "THRESHOLD_MISMATCH",
  "PROOF_REUSED",
  "EXPIRED_CONDITION",
  "RECIPIENT_MISMATCH",
  "AMOUNT_OVERFLOW",
];

const normAddr = (a) => String(a || "").toLowerCase();
const normHex = (h) => String(h || "").toLowerCase();
const toBig = (v) => {
  const s = String(v);
  return BigInt(s.startsWith("0x") || s.startsWith("0X") ? s : s);
};

/**
 * Decide a Gatekeeper task. Pure function (no I/O except the seen-set lookup).
 * @param {object} input  the task `input` object from the envelope
 * @param {(proofTx: string) => string|null} seenProofTx  returns the task_id
 *        that first used this proof_tx, or null when unseen
 * @returns {{decision: "APPROVE"|"REJECT", reason_code: string}}
 */
export function decide(input, seenProofTx) {
  if (!input || typeof input !== "object") {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION" };
  }
  // 1. Verification key must match the registered condition VK.
  if (normHex(input.proof_vk) !== normHex(input.registered_vk)) {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION" };
  }
  // 2. Public balance must meet the minimum threshold.
  try {
    if (toBig(input.public_balance) < toBig(input.minimum)) {
      return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
    }
  } catch {
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
  }
  // 3. Recipient must match the condition recipient.
  if (normAddr(input.recipient) !== normAddr(input.condition_recipient)) {
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" };
  }
  // 4. Amount must not exceed the single-transfer cap.
  try {
    if (toBig(input.amount) > toBig(input.max_transfer)) {
      return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" };
    }
  } catch {
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" };
  }
  // 5. Condition must not be expired.
  try {
    if (toBig(input.current_block) >= toBig(input.expiry_block)) {
      return { decision: "REJECT", reason_code: "EXPIRED_CONDITION" };
    }
  } catch {
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION" };
  }
  // 6. Proof reference must not have been accepted before.
  if (input.proof_tx && seenProofTx && seenProofTx(normHex(input.proof_tx))) {
    return { decision: "REJECT", reason_code: "PROOF_REUSED" };
  }
  return { decision: "APPROVE", reason_code: "VALID_CONDITION" };
}
