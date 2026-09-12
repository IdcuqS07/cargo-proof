import assert from "node:assert/strict";
import { normalizeMilestoneEvent } from "../workers/event-normalizer.mjs";

const tx = "0x" + "ab".repeat(32);
const shipment = "0x" + "01".repeat(32);
const milestone = "0x" + "02".repeat(32);
const sourceTx = "0x" + "03".repeat(32);

const queryEvent = { args: [shipment, milestone, 1n, 123n, "0x" + "04".repeat(32), sourceTx], transactionHash: tx, blockNumber: 42 };
const listenerEvent = { args: Object.assign([shipment, milestone, 1n, 123n, "0x" + "04".repeat(32), sourceTx], { shipmentId: shipment, milestoneId: milestone, milestoneType: 1n, sourceTxHash: sourceTx }), log: { transactionHash: tx, blockNumber: 42 } };

for (const event of [queryEvent, listenerEvent]) {
  const normalized = normalizeMilestoneEvent(event);
  assert.equal(normalized.shipmentId, shipment);
  assert.equal(normalized.milestoneId, milestone);
  assert.equal(normalized.milestoneType, 1);
  assert.equal(normalized.sourceTxHash, tx);
  assert.equal(normalized.proofSourceTxHash, sourceTx);
  assert.equal(normalized.sourceBlock, 42);
}
console.log("SMOKE PASS: query and listener event shapes normalize correctly");
