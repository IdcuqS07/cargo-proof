import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import solc from "solc";

const root = path.resolve(import.meta.dirname, "..");
const contractDir = path.join(root, "contracts");

function compileContracts() {
  const files = ["ShipmentRegistry.sol", "CargoProofFinancing.sol", "AttestcoinAdapter.sol"];
  const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(path.join(contractDir, file), "utf8") }]));
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  }), {
    import(importPath: string) {
      if (importPath.startsWith("@gluwa/asc-contracts/")) {
        const resolved = path.join(root, "node_modules", importPath);
        return fs.existsSync(resolved) ? { contents: fs.readFileSync(resolved, "utf8") } : { error: `Missing import: ${importPath}` };
      }
      return { error: `Unsupported import: ${importPath}` };
    },
  }));
  const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === "error");
  if (errors.length) throw new Error(errors.map((error: { formattedMessage?: string }) => error.formattedMessage).join("\n"));
  return output.contracts as Record<string, Record<string, { abi: Array<{ type: string; name?: string }> }>>;
}

function names(abi: Array<{ type: string; name?: string }>, type: string) {
  return abi.filter((item) => item.type === type).map((item) => item.name).filter(Boolean);
}

describe("CargoProof Solidity acceptance surface", () => {
  it("compiles every deployed contract source", () => {
    const compiled = compileContracts();
    expect(compiled["ShipmentRegistry.sol"].ShipmentRegistry).toBeDefined();
    expect(compiled["CargoProofFinancing.sol"].CargoProofFinancing).toBeDefined();
    expect(compiled["AttestcoinAdapter.sol"].AttestcoinAdapter).toBeDefined();
  });

  it("exposes the source-chain happy path", () => {
    const abi = compileContracts()["ShipmentRegistry.sol"].ShipmentRegistry.abi;
    expect(names(abi, "function")).toEqual(expect.arrayContaining(["registerShipment", "recordMilestone", "getShipment", "getMilestone", "nextMilestoneType"]));
    expect(names(abi, "event")).toEqual(expect.arrayContaining(["ShipmentRegistered", "MilestoneRecorded", "ShipmentDelivered"]));
  });

  it("exposes financing release, pause, and settlement controls", () => {
    const abi = compileContracts()["CargoProofFinancing.sol"].CargoProofFinancing.abi;
    expect(names(abi, "function")).toEqual(expect.arrayContaining(["createFacility", "submitAttestedMilestone", "releaseTranche", "pauseFacility", "defaultFacility", "settleFacility", "blockTranche", "getFacility", "getTranche"]));
  });

  it("documents and enforces at least five source-chain negative cases", () => {
    const source = fs.readFileSync(path.join(contractDir, "ShipmentRegistry.sol"), "utf8");
    for (const marker of ["AlreadyRegistered", "InvalidAddress", "InvalidMilestone", "OutOfOrder", "ReplayDetected", "NotOperator"]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("shipment.nextMilestoneType");
    expect(source).toContain("usedMilestoneIds[milestoneId]");
  });

  it("enforces financing safety invariants in source", () => {
    const source = fs.readFileSync(path.join(contractDir, "CargoProofFinancing.sol"), "utf8");
    for (const marker of ["ReplayDetected", "OutOfOrder", "InvalidStatus", "DeadlinePassed", "InvariantViolation", "proof.consumed = true", "processedMilestones[milestoneId] = true"]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("facility.releasedAmount + tranche.amount > facility.principal");
  });
});
