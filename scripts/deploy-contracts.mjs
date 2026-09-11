import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Wallet, ContractFactory, formatEther } from "ethers";

const root = process.cwd();
const dryRun = !process.argv.includes("--broadcast");
const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing`);
  return value;
};
const loadArtifact = (name) => JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", `${name}.json`), "utf8"));
const deploymentDir = path.join(root, "deployments");
const registryArtifact = loadArtifact("ShipmentRegistry");
const financingArtifact = loadArtifact("CargoProofFinancing");

const sepoliaProvider = new JsonRpcProvider(requireEnv("SEPOLIA_RPC_URL"));
const creditcoinProvider = new JsonRpcProvider(requireEnv("CREDITCOIN_RPC_URL"));
const sepoliaWallet = new Wallet(requireEnv("SEPOLIA_DEPLOYER_PRIVATE_KEY"), sepoliaProvider);
const creditcoinWallet = new Wallet(requireEnv("CREDITCOIN_DEPLOYER_PRIVATE_KEY"), creditcoinProvider);
const [sepoliaNetwork, creditcoinNetwork, sepoliaBalance, creditcoinBalance] = await Promise.all([
  sepoliaProvider.getNetwork(),
  creditcoinProvider.getNetwork(),
  sepoliaProvider.getBalance(sepoliaWallet.address),
  creditcoinProvider.getBalance(creditcoinWallet.address),
]);

console.log(`Sepolia chain ${sepoliaNetwork.chainId} deployer ${sepoliaWallet.address} balance ${formatEther(sepoliaBalance)}`);
console.log(`Creditcoin chain ${creditcoinNetwork.chainId} deployer ${creditcoinWallet.address} balance ${formatEther(creditcoinBalance)}`);
console.log(`Registry bytecode: ${registryArtifact.bytecode.length / 2 - 1} bytes`);
console.log(`Financing bytecode: ${financingArtifact.bytecode.length / 2 - 1} bytes`);
if (dryRun) {
  console.log("DRY RUN: no deployment transaction was signed or broadcast.");
  process.exit(0);
}

const manifest = { generatedAt: new Date().toISOString(), networks: {} };
const registry = await new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, sepoliaWallet).deploy();
await registry.waitForDeployment();
const registryAddress = await registry.getAddress();
const registryTx = registry.deploymentTransaction();
manifest.networks.sepolia = { chainId: sepoliaNetwork.chainId.toString(), deployer: sepoliaWallet.address, ShipmentRegistry: { address: registryAddress, deploymentTx: registryTx?.hash ?? null } };
console.log(`ShipmentRegistry deployed at ${registryAddress}`);

const financing = await new ContractFactory(financingArtifact.abi, financingArtifact.bytecode, creditcoinWallet).deploy();
await financing.waitForDeployment();
const financingAddress = await financing.getAddress();
const financingTx = financing.deploymentTransaction();
manifest.networks.creditcoin = { chainId: creditcoinNetwork.chainId.toString(), deployer: creditcoinWallet.address, CargoProofFinancing: { address: financingAddress, deploymentTx: financingTx?.hash ?? null }, attestcoinAdapter: process.env.ATTESTCOIN_ADAPTER_ADDRESS || null };
console.log(`CargoProofFinancing deployed at ${financingAddress}`);
fs.mkdirSync(deploymentDir, { recursive: true });
fs.writeFileSync(path.join(deploymentDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Deployment manifest written to deployments/manifest.json");
