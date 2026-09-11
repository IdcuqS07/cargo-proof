import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";

const root = process.cwd();
const flow = JSON.parse(fs.readFileSync(path.join(root, "deployments/real-flow.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deployments/manifest.json"), "utf8"));
const proofPath = path.join(root, "deployments/real-proof.json");
const sourceProvider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const creditProvider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const wallet = new Wallet(process.env.CREDITCOIN_DEPLOYER_PRIVATE_KEY, creditProvider);
let proof;
if (fs.existsSync(proofPath)) {
  proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  console.log("Using previously generated proof payload; no new proof request needed.");
} else {
  const proofBuilderUrl = process.env.PROOF_BUILDER_URL || "https://prover.cc3-testnet.creditcoin.network";
  const proofBuilder = new proofProvider.service.ProofBuilder(flow.chainKey, proofBuilderUrl, 120_000);
  console.log(`Waiting for source block ${flow.blockHeight} attestation before proof generation...`);
  await proofBuilder.waitUntilHeightAttested(flow.chainKey, flow.blockHeight, 15_000, 1_200_000);
  console.log("Source block attested; requesting proof...");
  const proofResult = await proofBuilder.getProof(flow.sourceMilestoneTx);
  if (!proofResult.success || !proofResult.data) throw new Error(`Proof generation failed: ${proofResult.error || "unknown error"}`);
  proof = proofResult.data;
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}
const adapterAddress = manifest.networks.creditcoin.attestcoinAdapter;
const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts/contracts/AttestcoinAdapter.json"), "utf8"));
const adapter = new Contract(adapterAddress, artifact.abi, wallet);
const args = [
  proof.chainKey,
  proof.headerNumber,
  proof.txBytes,
  proof.merkleProof.root,
  proof.merkleProof.siblings.map(({ hash, isLeft }) => ({ hash, isLeft })),
  proof.continuityProof.lowerEndpointDigest,
  proof.continuityProof.roots,
  flow.facilityId,
  flow.shipmentId,
  flow.milestoneId,
  flow.milestoneType,
];
let gasLimit = 1_500_000n;
try { gasLimit = (await creditProvider.estimateGas({ to: adapter.target, from: wallet.address, data: adapter.interface.encodeFunctionData("executeVerifiedMilestone", args) }) * 135n) / 100n; } catch (error) { console.log(`Gas estimation unavailable; using ${gasLimit.toString()}`); }
console.log(`Submitting verified proof with gas limit ${gasLimit.toString()}...`);
const tx = await adapter.executeVerifiedMilestone(...args, { gasLimit });
const receipt = await tx.wait();
const result = { adapter: adapter.target, proofTx: tx.hash, proofReceiptBlock: receipt.blockNumber, sourceTransaction: flow.sourceMilestoneTx, facilityId: flow.facilityId, milestoneId: flow.milestoneId };
fs.writeFileSync(path.join(root, "deployments/real-proof-result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
