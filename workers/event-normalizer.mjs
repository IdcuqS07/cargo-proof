export function normalizeMilestoneEvent(event) {
  const args = event?.args;
  const shipmentId = args?.shipmentId ?? args?.[0];
  const milestoneId = args?.milestoneId ?? args?.[1];
  const milestoneType = args?.milestoneType ?? args?.[2];
  const sourceTxHash = args?.sourceTxHash ?? args?.[5];
  const sourceEventTx = event?.transactionHash ?? event?.transaction_hash ?? event?.txHash ?? event?.transaction ?? event?.log?.transactionHash ?? event?.log?.transaction_hash ?? event?.hash;
  const sourceBlock = event?.blockNumber ?? event?.block_number ?? event?.log?.blockNumber ?? event?.log?.block_number;
  if (!shipmentId || !milestoneId || milestoneType === undefined) throw new Error("Milestone event arguments are incomplete");
  if (!sourceEventTx) throw new Error(`Milestone event ${milestoneId} has no source transaction hash`);
  return { shipmentId: String(shipmentId), milestoneId: String(milestoneId), milestoneType: Number(milestoneType), sourceEventTx, sourceTxHash: sourceEventTx, proofSourceTxHash: sourceTxHash || sourceEventTx, sourceBlock };
}
