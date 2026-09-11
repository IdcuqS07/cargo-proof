# Deployment manifest

Deployment has not been executed yet. Fill this manifest after deploying with a funded deployer wallet.

| Contract | Network | Address | Deployment tx | Explorer |
|---|---|---|---|---|
| ShipmentRegistry | Ethereum Sepolia | `0xE3e0b01141860541B7247f0E05b1Ea6cd60556BE` | `0xbba98455b91e16948c833cd3d4087ccb279ea613f7eb50fa86de27061bb8e4db` | Provider explorer pending |
| CargoProofFinancing | Creditcoin testnet | `0xe378E93D5eC4dDa719355c5274d85e97c3a0A500` | `0xd4f2af2dfab90039cee87f67b7e775a467960485c1c9b14b0840bae7eb7a2477` | Provider explorer pending |
| AttestcoinAdapter | Creditcoin testnet | `0xaAB31Fb58cf430689A48a5b3d2a632a38Fbb8f05` | `0x8fc9de08c15cd561335d4eeaf00999172320f10ac641b213f65277be2b125a12` | Provider explorer pending |
| Attestcoin adapter | Creditcoin testnet | `TBD` | `TBD` | `TBD` |

Required deployment environment variables should be supplied through a secret manager or shell environment, never committed:

```bash
SEPOLIA_RPC_URL=
SEPOLIA_DEPLOYER_PRIVATE_KEY=
CREDITCOIN_RPC_URL=
CREDITCOIN_DEPLOYER_PRIVATE_KEY=
CREDITCOIN_CHAIN_ID=
ATTESTCOIN_ADAPTER_ADDRESS=
```

Deployment status:

1. Both MVP contracts and `AttestcoinAdapter` are deployed and their bytecode was verified at the addresses above.
2. The adapter was authorized with `setAttestor`: `0x689135dae381a498daddbd15a30c2a9014d7dcd474074c973e38559e19094863`.
3. A real Sepolia `MilestoneRecorded` transaction was attested and submitted through the adapter. Proof transaction: `0xea6a67ad4e44e6c5f972ab374fac9ac056aba69f50ba7614e6576c8ee9713e66`.
