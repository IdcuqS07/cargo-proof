import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";

const root = process.cwd();
const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing`);
  return value;
};
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(root, "artifacts/contracts", `${name}.json`), "utf8"));
const broadcast = process.argv.includes("--broadcast");
const sepoliaProvider = new JsonRpcProvider(requireEnv("SEPOLIA_RPC_URL"));
const creditcoinProvider = new JsonRpcProvider(requireEnv("CREDITCOIN_RPC_URL"));
const sepoliaWallet = new Wallet(requireEnv("SEPOLIA_DEPLOYER_PRIVATE_KEY"), sepoliaProvider);
const creditcoinWallet = new Wallet(requireEnv("CREDITCOIN_DEPLOYER_PRIVATE_KEY"), creditcoinProvider);
const [sepoliaNetwork, creditcoinNetwork, sepoliaBalance, creditcoinBalance] = await Promise.all([
  sepoliaProvider.getNetwork(), creditcoinProvider.getNetwork(), sepoliaProvider.getBalance(sepoliaWallet.address), creditcoinProvider.getBalance(creditcoinWallet.address),
]);
if (sepoliaNetwork.chainId !== 11155111n) throw new Error(`Unexpected Sepolia chain: ${sepoliaNetwork.chainId}`);
if (creditcoinNetwork.chainId !== 102031n) throw new Error(`Unexpected Creditcoin chain: ${creditcoinNetwork.chainId}`);
console.log(`P1 redeploy ${broadcast ? "BROADCAST" : "DRY RUN"}`);
console.log(`Sepolia deployer ${sepoliaWallet.address} balance ${formatEther(sepoliaBalance)}`);
console.log(`Creditcoin deployer ${creditcoinWallet.address} balance ${formatEther(creditcoinBalance)}`);
if (!broadcast) {
  console.log("DRY RUN: no deployment transaction was signed or broadcast.");
  process.exit(0);
}

const registry = await new ContractFactory(artifact("ShipmentRegistry"), artifact("ShipmentRegistry").bytecode, sepoliaWallet).deploy();
await registry.waitForDeployment();
const registryAddress = await registry.getAddress();
const registryTx = registry.deploymentTransaction();
console.log(`ShipmentRegistry: ${registryAddress} (${registryTx?.hash ?? "unknown"})`);

const financing = await new ContractFactory(artifact("CargoProofFinancing"), artifact("CargoProofFinancing").bytecode, creditcoinWallet).deploy();
await financing.waitForDeployment();
const financingAddress = await financing.getAddress();
const financingTx = financing.deploymentTransaction();
console.log(`CargoProofFinancing: ${financingAddress} (${financingTx?.hash ?? "unknown"})`);

const adapter = await new ContractFactory(artifact("AttestcoinAdapter"), artifact("AttestcoinAdapter").bytecode, creditcoinWallet).deploy(financingAddress, registryAddress);
await adapter.waitForDeployment();
const adapterAddress = await adapter.getAddress();
const adapterTx = adapter.deploymentTransaction();
const authorizeTx = await new Contract(financingAddress, ["function setAttestor(address account, bool allowed) external"], creditcoinWallet).setAttestor(adapterAddress, true);
const authorizeReceipt = await authorizeTx.wait();
console.log(`AttestcoinAdapter: ${adapterAddress} (${adapterTx?.hash ?? "unknown"})`);
console.log(`Adapter authorization: ${authorizeReceipt?.hash ?? authorizeTx.hash}`);

const manifest = {
  generatedAt: new Date().toISOString(),
  networks: {
    sepolia: { chainId: sepoliaNetwork.chainId.toString(), deployer: sepoliaWallet.address, ShipmentRegistry: { address: registryAddress, deploymentTx: registryTx?.hash ?? null } },
    creditcoin: {
      chainId: creditcoinNetwork.chainId.toString(), deployer: creditcoinWallet.address,
      CargoProofFinancing: { address: financingAddress, deploymentTx: financingTx?.hash ?? null },
      attestcoinAdapter: adapterAddress, attestcoinAdapterDeploymentTx: adapterTx?.hash ?? null,
      attestcoinAdapterAuthorizationTx: authorizeReceipt?.hash ?? authorizeTx.hash, attestcoinAdapterSourceRegistry: registryAddress,
    },
  },
};
fs.writeFileSync(path.join(root, "deployments/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("P1 deployment manifest written to deployments/manifest.json");
console.log("Next: update Railway/Vercel contract address variables and database mappings before recording new events.");
