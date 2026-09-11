import { JsonRpcProvider } from "ethers";

const txHash = process.argv[2];
if (!txHash) throw new Error("Usage: node scripts/verify-create-facility.mjs <txHash>");
const provider = new JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const network = await provider.getNetwork();
const receipt = await provider.waitForTransaction(txHash, 1, 30_000);
console.log(JSON.stringify({
  chainId: network.chainId.toString(),
  txHash,
  found: Boolean(receipt),
  status: receipt?.status ?? null,
  blockNumber: receipt?.blockNumber ?? null,
  contractAddress: receipt?.to ?? null,
  gasUsed: receipt?.gasUsed?.toString() ?? null,
}, null, 2));
