import { describe, expect, it } from "vitest";
import { JsonRpcProvider, Wallet } from "ethers";

const required = [
  "SEPOLIA_RPC_URL",
  "SEPOLIA_DEPLOYER_PRIVATE_KEY",
  "CREDITCOIN_RPC_URL",
  "CREDITCOIN_CHAIN_ID",
] as const;

describe("deployment RPC credentials", () => {
  it("connects to both configured networks and derives deployer addresses", async () => {
    for (const key of required) expect(process.env[key], `${key} is missing`).toBeTruthy();

    const sepolia = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const creditcoin = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
    const [sepoliaNetwork, creditcoinNetwork, sepoliaBlock, creditcoinBlock] = await Promise.all([
      sepolia.getNetwork(),
      creditcoin.getNetwork(),
      sepolia.getBlockNumber(),
      creditcoin.getBlockNumber(),
    ]);
    const sepoliaWallet = new Wallet(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY!);
    const creditcoinWallet = new Wallet(process.env.CREDITCOIN_DEPLOYER_PRIVATE_KEY!);

    expect(sepoliaNetwork.chainId).toBeGreaterThan(0n);
    expect(creditcoinNetwork.chainId).toBe(BigInt(process.env.CREDITCOIN_CHAIN_ID!));
    expect(sepoliaBlock).toBeGreaterThanOrEqual(0);
    expect(creditcoinBlock).toBeGreaterThanOrEqual(0);
    expect(sepoliaWallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(creditcoinWallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  }, 30_000);
});
