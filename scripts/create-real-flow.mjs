import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const root = process.cwd();
const sepolia = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const creditcoin = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const sourceWallet = new Wallet(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY, sepolia);
const creditWallet = new Wallet(process.env.CREDITCOIN_DEPLOYER_PRIVATE_KEY, creditcoin);
const registry = new Contract("0xE3e0b01141860541B7247f0E05b1Ea6cd60556BE", [
  "function registerShipment(bytes32 shipmentId,address borrower,address lender,bytes32 cargoHash) external",
  "function recordMilestone(bytes32 shipmentId,bytes32 milestoneId,uint8 milestoneType,uint256 occurredAt,bytes32 metadataHash,bytes32 sourceTxHash) external",
], sourceWallet);
const financing = new Contract("0xe378E93D5eC4dDa719355c5274d85e97c3a0A500", [
  "function createFacility(bytes32 facilityId,bytes32 shipmentId,address borrower,uint256 principal,uint256[] trancheAmounts,uint256 deadline) external returns (bytes32)",
], creditWallet);
const suffix = Date.now().toString();
const shipmentId = keccak256(toUtf8Bytes(`cargo-proof-real-shipment-${suffix}`));
const milestoneId = keccak256(toUtf8Bytes(`cargo-proof-real-milestone-${suffix}`));
const facilityId = keccak256(toUtf8Bytes(`cargo-proof-real-facility-${suffix}`));
const cargoHash = keccak256(toUtf8Bytes(`cargo-manifest-${suffix}`));
const metadataHash = keccak256(toUtf8Bytes(`hub-arrival-${suffix}`));
const registrationTx = await registry.registerShipment(shipmentId, sourceWallet.address, sourceWallet.address, cargoHash);
const registrationReceipt = await registrationTx.wait();
const occurredAt = Math.floor(Date.now() / 1000) - 5;
const milestoneTx = await registry.recordMilestone(shipmentId, milestoneId, 1, occurredAt, metadataHash, registrationReceipt.hash);
const milestoneReceipt = await milestoneTx.wait();
const deadline = Math.floor(Date.now() / 1000) + 86400;
const principal = 1000n;
const facilityTx = await financing.createFacility(facilityId, shipmentId, creditWallet.address, principal, [principal], deadline);
const facilityReceipt = await facilityTx.wait();
const flow = { generatedAt: new Date().toISOString(), shipmentId, milestoneId, facilityId, sourceRegistry: registry.target, sourceRegistrationTx: registrationReceipt.hash, sourceMilestoneTx: milestoneReceipt.hash, creditcoinFinancing: financing.target, facilityTx: facilityReceipt.hash, milestoneType: 1, chainKey: 1, blockHeight: milestoneReceipt.blockNumber };
fs.writeFileSync(path.join(root, "deployments/real-flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
console.log(JSON.stringify(flow, null, 2));
