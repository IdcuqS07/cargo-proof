import { id } from "ethers";
for (const signature of [
  "ShipmentRegistered(bytes32,address,address,bytes32)",
  "MilestoneRecorded(bytes32,bytes32,uint8,uint256,bytes32,bytes32)"
]) console.log(signature, id(signature));
