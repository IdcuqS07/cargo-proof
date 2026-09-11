import { describe, expect, it } from "vitest";
import { SUPPORTED_WALLET_NETWORKS, shortAddress } from "../client/src/lib/wallet";

describe("wallet helpers", () => {
  it("formats an EVM address for the dashboard", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("defines the supported CargoProof networks", () => {
    expect(SUPPORTED_WALLET_NETWORKS.sepolia.chainId).toBe(BigInt(11155111));
    expect(SUPPORTED_WALLET_NETWORKS.creditcoin.chainId).toBe(BigInt(102031));
  });
});
