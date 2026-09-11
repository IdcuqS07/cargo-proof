import { Contract, Interface, JsonRpcProvider } from "ethers";

const txHash = process.argv[2];
if (!txHash) throw new Error("Usage: node scripts/verify-facility-state.mjs <createFacilityTxHash>");
const provider = new JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const address = "0xe378E93D5eC4dDa719355c5274d85e97c3a0A500";
const abi = [
  "event FacilityCreated(bytes32 indexed facilityId, bytes32 indexed shipmentId, address indexed lender, address borrower, uint256 principal, uint8 trancheCount, uint256 deadline)",
  "function getFacility(bytes32) view returns (tuple(bytes32 shipmentId,address lender,address borrower,uint256 principal,uint256 releasedAmount,uint8 trancheCount,uint8 nextMilestone,uint256 deadline,uint8 status,bool exists))",
];
const receipt = await provider.waitForTransaction(txHash, 1, 30_000);
if (!receipt) throw new Error("Transaction receipt was not found.");
const iface = new Interface(abi);
const event = receipt.logs.map((log) => { try { return iface.parseLog(log); } catch { return null; } }).find((parsed) => parsed?.name === "FacilityCreated");
if (!event) throw new Error("FacilityCreated event was not found in this transaction.");
const facilityId = event.args.facilityId;
const contract = new Contract(address, abi, provider);
const facility = await contract.getFacility(facilityId);
console.log(JSON.stringify({
  chainId: (await provider.getNetwork()).chainId.toString(),
  txHash,
  facilityId,
  shipmentId: facility.shipmentId,
  lender: facility.lender,
  borrower: facility.borrower,
  principal: facility.principal.toString(),
  releasedAmount: facility.releasedAmount.toString(),
  trancheCount: Number(facility.trancheCount),
  nextMilestone: Number(facility.nextMilestone),
  deadline: new Date(Number(facility.deadline) * 1000).toISOString(),
  status: Number(facility.status),
  exists: facility.exists,
}, null, 2));
