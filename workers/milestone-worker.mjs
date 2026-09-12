import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { closeDatabase, createNotification, countRetryQueue, databaseEnabled, listMappings, markWorkerFailure, updateWorkerEvent, upsertWorkerEvent } from "./db-store.mjs";
import { notifyOwner } from "./notify.mjs";
import { normalizeMilestoneEvent } from "./event-normalizer.mjs";

const root = process.cwd();
const once = process.argv.includes("--once");
const flowPath = path.join(root, "deployments/real-flow.json");
const statePath = path.join(root, "deployments/worker-state.json");
const flow = fs.existsSync(flowPath) ? JSON.parse(fs.readFileSync(flowPath, "utf8")) : null;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { processed: {}, retryQueue: [] };
const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const creditcoin = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const sourceRegistryAddress = process.env.SOURCE_REGISTRY_ADDRESS;
const financingAddress = process.env.FINANCING_ADDRESS;
const adapterAddress = process.env.ATTESTCOIN_ADAPTER_ADDRESS;
for (const [name, value] of Object.entries({ SOURCE_REGISTRY_ADDRESS: sourceRegistryAddress, FINANCING_ADDRESS: financingAddress, ATTESTCOIN_ADAPTER_ADDRESS: adapterAddress })) {
  if (!value) throw new Error(`${name} is required for the milestone worker`);
}
const sourceRegistry = new Contract(sourceRegistryAddress, [
  "event MilestoneRecorded(bytes32 indexed shipmentId, bytes32 indexed milestoneId, uint8 milestoneType, uint256 occurredAt, bytes32 metadataHash, bytes32 sourceTxHash)",
], provider);
const financingRead = new Contract(financingAddress, [
  "function proofs(bytes32) view returns (bytes32 facilityId, bytes32 milestoneId, uint8 milestoneType, bytes32 proofHash, bool accepted, bool consumed)",
], creditcoin);
const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts/contracts/AttestcoinAdapter.json"), "utf8"));
const adapter = new Contract(adapterAddress, artifact.abi, new Wallet(process.env.CREDITCOIN_DEPLOYER_PRIVATE_KEY, creditcoin));
const financing = new Contract(financingAddress, ["function releaseTranche(bytes32,bytes32,bytes32)"], new Wallet(process.env.WORKER_LENDER_PRIVATE_KEY || process.env.CREDITCOIN_DEPLOYER_PRIVATE_KEY, creditcoin));
const saveState = () => fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

async function queryLogsInChunks(rpc, address, topics, fromBlock, toBlock) {
  const events = [];
  for (let start = fromBlock; start <= toBlock; start += 5000) {
    const end = Math.min(start + 4999, toBlock);
    const logs = await rpc.send("eth_getLogs", [{ address, topics, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]);
    events.push(...logs);
  }
  return events;
}

async function resolveLogTransactionHash(log) {
  if (log.transactionHash || log.hash || log.txHash) return log.transactionHash || log.hash || log.txHash;
  if (log.blockHash && log.transactionIndex !== undefined) {
    const tx = await provider.send("eth_getTransactionByBlockHashAndIndex", [log.blockHash, `0x${Number(log.transactionIndex).toString(16)}`]);
    return tx?.hash;
  }
  if (log.blockHash) {
    const receipts = await provider.send("eth_getBlockReceipts", [log.blockHash]);
    for (const receipt of receipts || []) {
      const match = (receipt.logs || []).some((item) => item.address?.toLowerCase() === log.address?.toLowerCase() && item.data === log.data && JSON.stringify(item.topics) === JSON.stringify(log.topics));
      if (match) return receipt.transactionHash;
    }
  }
  return undefined;
}

async function alert(notification) {
  await createNotification(notification);
  await notifyOwner({ title: notification.title, content: notification.message });
}

async function releaseIfReady(event) {
  const proof = await financingRead.proofs(event.milestoneId);
  if (!proof.accepted) return "waiting-proof";
  if (proof.consumed) return "already-released";
  const payoutTxHash = keccak256(toUtf8Bytes(`cargo-proof-payout:${event.facilityId}:${event.milestoneId}:${event.sourceEventTx}`));
  const tx = await financing.releaseTranche(event.facilityId, event.milestoneId, payoutTxHash);
  const receipt = await tx.wait();
  await updateWorkerEvent(event.sourceEventTx, { status: "RELEASED", releaseTxHash: receipt.hash });
  state.processed[event.milestoneId] = { facilityId: event.facilityId, releaseTx: receipt.hash, sourceEventTx: event.sourceEventTx };
  saveState();
  await alert({ type: "RELEASED", severity: "INFO", title: "CargoProof tranche released", message: `Milestone ${event.milestoneId} released tranche for facility ${event.facilityId}. Transaction: ${receipt.hash}`, dedupeKey: `released:${event.milestoneId}` });
  console.log(`Tranche released for ${event.milestoneId}: ${receipt.hash}`);
  return "released";
}

async function processEvent(event, mappingByShipment) {
  let eventWithTransaction = event;
  if (!event.transactionHash && event.blockNumber !== undefined) {
    const rawLogs = await provider.getLogs({ address: event.address || sourceRegistryAddress, fromBlock: event.blockNumber, toBlock: event.blockNumber, topics: event.topics });
    const rawLog = rawLogs.find((log) => log.index === event.index) || rawLogs[0];
    if (rawLog) eventWithTransaction = { ...event, transactionHash: rawLog.transactionHash, blockNumber: rawLog.blockNumber };
  }
  const normalized = normalizeMilestoneEvent(eventWithTransaction);
  const { shipmentId, milestoneId, milestoneType, proofSourceTxHash: sourceTxHash, sourceEventTx, sourceBlock } = normalized;
  const mapping = mappingByShipment.get(shipmentId.toLowerCase());
  const facilityId = mapping?.facilityId || (flow?.shipmentId?.toLowerCase() === shipmentId.toLowerCase() ? flow.facilityId : null);
  console.log(`[Worker] Event ${sourceEventTx} shipment=${shipmentId} facility=${facilityId || "NONE"}`);
  const workerEvent = { sourceTxHash: sourceEventTx, sourceBlock, shipmentId, milestoneId, milestoneType, facilityId };
  await upsertWorkerEvent(workerEvent);
  if (!facilityId) {
    await markWorkerFailure(sourceEventTx, `No active shipment-facility mapping for ${shipmentId}`);
    await alert({ type: "PROOF_FAILED", severity: "ERROR", title: "Shipment mapping missing", message: `Worker detected milestone ${milestoneId}, but no active facility mapping exists for shipment ${shipmentId}.`, dedupeKey: `mapping-missing:${sourceEventTx}` });
    return;
  }
  if (state.processed[milestoneId]) return;
  console.log(`Detected MilestoneRecorded ${milestoneId} for facility ${facilityId}`);
  const eventData = { shipmentId, milestoneId, milestoneType, sourceTxHash, sourceEventTx, facilityId };
  const current = await releaseIfReady(eventData);
  if (current === "released" || current === "already-released") return;
  await updateWorkerEvent(sourceEventTx, { facilityId, status: "PROOF_PENDING" });
  const proofBuilder = new proofProvider.service.ProofBuilder(Number(mapping?.chainKey ?? flow?.chainKey ?? 1), process.env.PROOF_BUILDER_URL || "https://prover.cc3-testnet.creditcoin.network", 120_000);
  const sourceReceipt = await provider.getTransactionReceipt(sourceEventTx);
  await proofBuilder.waitUntilHeightAttested(Number(mapping?.chainKey ?? flow?.chainKey ?? 1), sourceReceipt.blockNumber, 15_000, 1_200_000);
  const proofResult = await proofBuilder.getProof(sourceEventTx);
  if (!proofResult.success || !proofResult.data) throw new Error(`Proof generation failed: ${proofResult.error || "unknown error"}`);
  const proof = proofResult.data;
  const proofTx = await adapter.executeVerifiedMilestone(proof.chainKey, proof.headerNumber, proof.txBytes, proof.merkleProof.root, proof.merkleProof.siblings.map(({ hash, isLeft }) => ({ hash, isLeft })), proof.continuityProof.lowerEndpointDigest, proof.continuityProof.roots, facilityId, shipmentId, milestoneId, milestoneType, { gasLimit: 1_500_000n });
  const proofReceipt = await proofTx.wait();
  await updateWorkerEvent(sourceEventTx, { facilityId, status: "PROOF_ACCEPTED", proofTxHash: proofReceipt.hash });
  await releaseIfReady(eventData);
}

async function safeProcessEvent(event, mappingByShipment) {
  try {
    await processEvent(event, mappingByShipment);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markWorkerFailure(event.transactionHash, message);
    await alert({ type: "PROOF_FAILED", severity: "ERROR", title: "CargoProof proof failed", message: `Worker failed for source transaction ${event.transactionHash}: ${message}`, dedupeKey: `proof-failed:${event.transactionHash}` });
    console.error(`[Worker] ${message}`);
  }
}

async function run() {
  const mappings = databaseEnabled() ? await listMappings() : [];
  const mappingByShipment = new Map(mappings.map(item => [item.shipmentId.toLowerCase(), item]));
  const latest = await provider.getBlockNumber();
  const fromBlock = Number(process.env.WORKER_FROM_BLOCK || (flow?.blockHeight ?? latest));
  console.log(`Worker ${once ? "one-shot" : "continuous"} (${databaseEnabled() ? "database mappings" : "fallback mappings"}): scanning from ${fromBlock} to ${latest}`);
  const eventTopic = sourceRegistry.interface.getEvent("MilestoneRecorded").topicHash;
  const rawLogs = await queryLogsInChunks(provider, sourceRegistryAddress, [eventTopic], fromBlock, latest);
  const events = await Promise.all(rawLogs.map(async (log) => {
    const parsed = sourceRegistry.interface.parseLog(log);
    const transactionHash = await resolveLogTransactionHash(log);
    if (!parsed) throw new Error(`Unable to decode MilestoneRecorded log ${transactionHash || "unknown"}`);
    if (!transactionHash) throw new Error(`Unable to resolve transaction hash for block ${log.blockNumber}`);
    return { args: parsed.args, transactionHash, blockNumber: Number(log.blockNumber), address: log.address, topics: log.topics, index: Number(log.logIndex ?? log.index) };
  }));
  console.log(`[Worker] Found ${events.length} MilestoneRecorded event(s) in scan range`);
  for (const event of events) await safeProcessEvent(event, mappingByShipment);
  const retryCount = await countRetryQueue();
  if (retryCount >= 3) await alert({ type: "RETRY_QUEUE", severity: "WARNING", title: "CargoProof retry queue is growing", message: `${retryCount} worker events are waiting for retry or resolution.`, dedupeKey: `retry-queue:${Math.floor(retryCount / 3)}` });
  if (!once) {
    sourceRegistry.on(sourceRegistry.filters.MilestoneRecorded(), async (...args) => {
      const event = args[args.length - 1];
      await safeProcessEvent(event, mappingByShipment);
    });
    console.log("Worker listening for future MilestoneRecorded events");
    await new Promise(() => {});
  }
}

run().then(async () => { if (once) await closeDatabase(); }).catch(async error => { console.error("[Worker] fatal", error); if (once) await closeDatabase(); process.exitCode = 1; });
