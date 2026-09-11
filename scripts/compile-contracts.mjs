import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const contractDir = path.join(root, "contracts");
const files = ["ShipmentRegistry.sol", "CargoProofFinancing.sol", "AttestcoinAdapter.sol"];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(path.join(contractDir, file), "utf8") }]));
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import(importPath) {
    if (importPath.startsWith("@gluwa/asc-contracts/")) {
      const resolved = path.join(root, "node_modules", importPath);
      return fs.existsSync(resolved) ? { contents: fs.readFileSync(resolved, "utf8") } : { error: `Missing import: ${importPath}` };
    }
    return { error: `Unsupported import: ${importPath}` };
  },
}));
const errors = output.errors ?? [];
for (const error of errors) console.log(error.formattedMessage);
if (errors.some((error) => error.severity === "error")) process.exit(1);
const artifactDir = path.join(root, "artifacts", "contracts");
fs.mkdirSync(artifactDir, { recursive: true });
for (const file of files) {
  const contractName = path.basename(file, ".sol");
  const artifact = output.contracts[file][contractName];
  fs.writeFileSync(path.join(artifactDir, `${contractName}.json`), JSON.stringify({ contractName, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, deployedBytecode: `0x${artifact.evm.deployedBytecode.object}` }, null, 2));
  console.log(`compiled ${contractName}: ${artifact.evm.bytecode.object.length / 2} bytes`);
}
