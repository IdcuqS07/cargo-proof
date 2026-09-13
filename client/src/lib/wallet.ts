import { BrowserProvider, Contract, formatEther, getAddress, isAddress, keccak256, toUtf8Bytes } from "ethers";

export type InjectedEthereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};

declare global {
  interface Window { ethereum?: InjectedEthereum; }
}

export const SUPPORTED_WALLET_NETWORKS = {
  sepolia: { chainId: BigInt(11155111), name: "Ethereum Sepolia", hex: "0xaa36a7" },
  creditcoin: { chainId: BigInt(102031), name: "Creditcoin testnet", hex: "0x18e8f" },
} as const;
export type WalletNetwork = keyof typeof SUPPORTED_WALLET_NETWORKS;
export type WalletSnapshot = { address: string; chainId: bigint; network: WalletNetwork | null; balance: string; source: "injected" | "walletconnect" };

const FINANCING_ADDRESS = import.meta.env.VITE_FINANCING_ADDRESS || "0xE5c9b4a12F7Db2Fa039c6885f36e8F353f4Cac02";
const SOURCE_REGISTRY_ADDRESS = import.meta.env.VITE_SOURCE_REGISTRY_ADDRESS || "0xceac99B0CCb3c2418A0b59d751AD3d95E039dc60";
const FINANCING_ABI = ["function createFacility(bytes32 facilityId, bytes32 shipmentId, address borrower, uint256 principal, uint256[] trancheAmounts, uint256 deadline) returns (bytes32)", "function pauseFacility(bytes32 facilityId)"];
const SOURCE_REGISTRY_ABI = ["function registerShipment(bytes32 shipmentId,address borrower,address lender,bytes32 cargoHash)", "function recordMilestone(bytes32 shipmentId,bytes32 milestoneId,uint8 milestoneType,uint256 occurredAt,bytes32 metadataHash,bytes32 sourceTxHash)", "function operators(address) view returns (bool)", "function owner() view returns (address)", "function nextMilestoneType(bytes32) view returns (uint8)"];
let activeProvider: InjectedEthereum | undefined;
let walletConnectProvider: InjectedEthereum | undefined;

function resolveNetwork(chainId: bigint): WalletNetwork | null {
  const match = Object.entries(SUPPORTED_WALLET_NETWORKS).find(([, value]) => value.chainId === chainId);
  return (match?.[0] as WalletNetwork | undefined) ?? null;
}

export function getInjectedProvider() {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No EVM wallet detected. Install MetaMask or another injected wallet.");
  return window.ethereum;
}

function getActiveProvider() {
  return activeProvider ?? getInjectedProvider();
}

function explainContractError(error: unknown, fallback: string) {
  const candidate = error as { data?: unknown; info?: { error?: { data?: unknown } }; shortMessage?: string };
  const rawData = candidate?.data ?? candidate?.info?.error?.data;
  const selector = typeof rawData === "string" ? rawData.slice(0, 10).toLowerCase() : "";
  if (selector === "0x23369fa6") return "Shipment ini sudah terdaftar di Ethereum Sepolia. Gunakan Shipment ID baru atau lanjutkan ke pencatatan milestone.";
  return candidate?.shortMessage || fallback;
}

export async function readWalletSnapshot(accounts?: string[]): Promise<WalletSnapshot | null> {
  const injected = getActiveProvider();
  const provider = new BrowserProvider(injected as never);
  const selected = accounts ?? (await provider.send("eth_accounts", []));
  const address = selected[0];
  if (!address) return null;
  const rawChainId = await provider.send("eth_chainId", []);
  const chainId = BigInt(rawChainId as string);
  let balance = BigInt(0);
  try {
    balance = await provider.getBalance(address);
  } catch (error) {
    console.warn("[Wallet] Native balance unavailable; continuing with zero display value", error);
  }
  return { address: getAddress(address), chainId, network: resolveNetwork(chainId), balance: formatEther(balance), source: injected === walletConnectProvider ? "walletconnect" : "injected" };
}

export async function connectWallet(): Promise<WalletSnapshot> {
  const injected = getInjectedProvider();
  activeProvider = injected;
  const provider = new BrowserProvider(injected as never);
  const accounts = await provider.send("eth_requestAccounts", []);
  const snapshot = await readWalletSnapshot(accounts);
  if (!snapshot) throw new Error("No wallet account was selected.");
  return snapshot;
}

export async function connectWalletConnect(): Promise<WalletSnapshot> {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
  if (!projectId) throw new Error("WalletConnect is not configured. Add VITE_WALLETCONNECT_PROJECT_ID in project secrets.");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const provider = await EthereumProvider.init({ projectId, chains: [102031], optionalChains: [11155111], showQrModal: true, metadata: { name: "CargoProof", description: "Conditional credit rail", url: window.location.origin, icons: [] } });
  await provider.connect();
  walletConnectProvider = provider as unknown as InjectedEthereum;
  activeProvider = walletConnectProvider;
  const snapshot = await readWalletSnapshot();
  if (!snapshot) throw new Error("No WalletConnect account was selected.");
  return snapshot;
}

export async function disconnectWallet() {
  if (walletConnectProvider?.disconnect) await walletConnectProvider.disconnect();
  walletConnectProvider = undefined;
  activeProvider = undefined;
}

export async function signWalletMessage(message: string) {
  const provider = new BrowserProvider(getActiveProvider() as never);
  return provider.getSigner().then((signer) => signer.signMessage(message));
}

async function requireNetwork(network: WalletNetwork) {
  const snapshot = await readWalletSnapshot();
  if (!snapshot) throw new Error("Connect a wallet before submitting a transaction.");
  if (snapshot.chainId !== SUPPORTED_WALLET_NETWORKS[network].chainId) throw new Error(`Switch your wallet to ${SUPPORTED_WALLET_NETWORKS[network].name} before this action. Detected chain ID: ${snapshot.chainId.toString()} (expected ${SUPPORTED_WALLET_NETWORKS[network].chainId.toString()}).`);
  return new BrowserProvider(getActiveProvider() as never);
}

export async function registerShipmentOnchain(input: { shipmentId: string; borrower: string; lender: string; cargoHash?: string }) {
  if (!isAddress(input.borrower) || !isAddress(input.lender)) throw new Error("Borrower and lender must be valid wallet addresses.");
  const provider = await requireNetwork("sepolia");
  const signer = await provider.getSigner();
  const contract = new Contract(SOURCE_REGISTRY_ADDRESS, SOURCE_REGISTRY_ABI, signer);
  const account = await signer.getAddress();
  const [allowed, owner] = await Promise.all([contract.operators(account), contract.owner()]);
  if (!allowed && account.toLowerCase() !== String(owner).toLowerCase()) throw new Error(`Connected wallet is not a ShipmentRegistry operator. Ask registry owner ${owner} to authorize ${account} with setOperator.`);
  const shipmentId = keccak256(toUtf8Bytes(input.shipmentId));
  const cargoHash = input.cargoHash && /^0x[0-9a-fA-F]{64}$/.test(input.cargoHash) ? input.cargoHash : keccak256(toUtf8Bytes(`cargo-manifest:${input.shipmentId}`));
  try {
    const tx = await contract.registerShipment(shipmentId, input.borrower, input.lender, cargoHash);
    const receipt = await tx.wait();
    return { shipmentId, txHash: receipt.hash };
  } catch (error) {
    throw new Error(explainContractError(error, "Shipment registration failed"));
  }
}

export async function recordMilestoneOnchain(input: { shipmentId: string; milestoneType: number; sourceTxHash: string }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.sourceTxHash)) throw new Error("Source transaction hash must be a 32-byte hex value.");
  const provider = await requireNetwork("sepolia");
  const signer = await provider.getSigner();
  const contract = new Contract(SOURCE_REGISTRY_ADDRESS, SOURCE_REGISTRY_ABI, signer);
  const account = await signer.getAddress();
  const [allowed, owner] = await Promise.all([contract.operators(account), contract.owner()]);
  if (!allowed && account.toLowerCase() !== String(owner).toLowerCase()) throw new Error(`Connected wallet is not a ShipmentRegistry operator. Ask registry owner ${owner} to authorize ${account} with setOperator.`);
  const shipmentId = /^0x[0-9a-fA-F]{64}$/.test(input.shipmentId) ? input.shipmentId : keccak256(toUtf8Bytes(input.shipmentId));
  const nextType = Number(await contract.nextMilestoneType(shipmentId));
  if (nextType < 1 || nextType > 3) throw new Error(`Shipment milestone sequence is complete or invalid on Sepolia (next type: ${nextType}).`);
  const milestoneId = keccak256(toUtf8Bytes(`cargo-proof-milestone:${shipmentId}:${nextType}:${Date.now()}`));
  const metadataHash = keccak256(toUtf8Bytes(`milestone-metadata:${milestoneId}`));
  const tx = await contract.recordMilestone(shipmentId, milestoneId, nextType, Math.floor(Date.now() / 1000), metadataHash, input.sourceTxHash);
  const receipt = await tx.wait();
  return { shipmentId, milestoneId, milestoneType: nextType, txHash: receipt.hash };
}

export async function createFacilityOnchain(input: { shipmentId: string; borrower: string; principal: number; trancheCount: number }) {
  if (!isAddress(input.borrower)) throw new Error("Borrower wallet address is invalid.");
  const snapshot = await readWalletSnapshot();
  if (!snapshot) throw new Error("Connect a wallet before creating a facility.");
  if (snapshot.chainId !== SUPPORTED_WALLET_NETWORKS.creditcoin.chainId) throw new Error(`Switch your wallet to Creditcoin testnet before creating a facility. Detected chain ID: ${snapshot.chainId.toString()} (expected 102031).`);
  const provider = new BrowserProvider(getActiveProvider() as never);
  const signer = await provider.getSigner();
  const contract = new Contract(FINANCING_ADDRESS, FINANCING_ABI, signer);
  const unique = `${input.shipmentId}:${Date.now()}`;
  const facilityId = keccak256(toUtf8Bytes(unique));
  const shipmentId = keccak256(toUtf8Bytes(input.shipmentId));
  const trancheAmount = Math.floor(input.principal / input.trancheCount);
  const trancheAmounts = Array.from({ length: input.trancheCount }, (_, index) => index === input.trancheCount - 1 ? input.principal - trancheAmount * (input.trancheCount - 1) : trancheAmount);
  const deadline = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
  const transaction = await contract.createFacility(facilityId, shipmentId, input.borrower, input.principal, trancheAmounts, deadline);
  const receipt = await transaction.wait();
  return { facilityId, shipmentId, txHash: receipt.hash };
}

export async function pauseFacilityOnchain(facilityId: string) {
  const provider = await requireNetwork("creditcoin");
  const signer = await provider.getSigner();
  const contract = new Contract(FINANCING_ADDRESS, FINANCING_ABI, signer);
  const transaction = await contract.pauseFacility(facilityId);
  const receipt = await transaction.wait();
  return { txHash: receipt.hash };
}

export async function switchWalletNetwork(network: WalletNetwork) {
  const injected = getActiveProvider();
  const target = SUPPORTED_WALLET_NETWORKS[network];
  try { await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target.hex }] }); }
  catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await injected.request({ method: "wallet_addEthereumChain", params: [{ chainId: target.hex, chainName: target.name, nativeCurrency: { name: network === "sepolia" ? "Sepolia Ether" : "Creditcoin", symbol: network === "sepolia" ? "ETH" : "CTC", decimals: 18 }, rpcUrls: [network === "sepolia" ? "https://rpc.sepolia.org" : "https://rpc.cc3-testnet.creditcoin.network"] }] });
  }
}

export function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
