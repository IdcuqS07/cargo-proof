import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { trpc } from "@/lib/trpc";
import { connectWallet, connectWalletConnect, createFacilityOnchain, disconnectWallet, pauseFacilityOnchain, readWalletSnapshot, registerShipmentOnchain, recordMilestoneOnchain, shortAddress, signWalletMessage, switchWalletNetwork, type WalletNetwork, type WalletSnapshot } from "@/lib/wallet";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  CircleDashed,
  Clock3,
  Copy,
  CreditCard,
  FileCheck2,
  GitBranch,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Radio,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Ship,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

type ViewKey = "overview" | "facilities" | "shipments" | "proofs";
type FacilityStatus = "ACTIVE" | "PAUSED" | "DEFAULTED" | "SETTLED";
type OnchainFacility = { facilityId: string; shipmentId: string; borrower: string; principal: string; released: string; nextMilestone: number; status: number; trancheCount: number; updatedAt: string };
type LiveTranche = { label: string; amount: number; status: "RELEASED" | "PENDING"; milestone: string; tx: string; time: string };
type LiveWorkerEvent = { id: number; status: string; milestoneId: string; shipmentId: string; facilityId: string | null; sourceTxHash: string; proofTxHash: string | null; releaseTxHash: string | null; updatedAt: Date | string };
type LiveShipment = { shipmentId: string; borrower: string; lender: string; milestoneCount: number; lastMilestone: string; registrationTx: string; status: string };

const CREDITCOIN_RPC = "https://rpc.cc3-testnet.creditcoin.network";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const FINANCING_ADDRESS = "0xe378E93D5eC4dDa719355c5274d85e97c3a0A500";
const SOURCE_REGISTRY_ADDRESS = "0xE3e0b01141860541B7247f0E05b1Ea6cd60556BE";
const SOURCE_REGISTRY_READ_ABI = ["event ShipmentRegistered(bytes32 indexed shipmentId,address indexed borrower,address indexed lender,bytes32 cargoHash)", "event MilestoneRecorded(bytes32 indexed shipmentId,bytes32 indexed milestoneId,uint8 milestoneType,uint256 occurredAt,bytes32 metadataHash,bytes32 sourceTxHash)"];
const FINANCING_READ_ABI = ["function getFacility(bytes32) view returns (tuple(bytes32 shipmentId,address lender,address borrower,uint256 principal,uint256 releasedAmount,uint8 trancheCount,uint8 nextMilestone,uint256 deadline,uint8 status,bool exists))", "event FacilityCreated(bytes32 indexed facilityId,bytes32 indexed shipmentId,address indexed lender,address borrower,uint256 principal,uint8 trancheCount,uint256 deadline)", "event TrancheReleased(bytes32 indexed facilityId,uint8 indexed trancheIndex,uint256 amount,bytes32 milestoneId,bytes32 proofHash,bytes32 payoutTxHash)"];

async function queryLogsInChunks(contract: Contract, filter: unknown, fromBlock: number, toBlock: number) {
  const logs: any[] = [];
  for (let start = fromBlock; start <= toBlock; start += 5000) {
    const end = Math.min(start + 4999, toBlock);
    logs.push(...await contract.queryFilter(filter as any, start, end));
  }
  return logs;
}

async function loadOnchainFacilities(): Promise<Facility[]> {
  const provider = new JsonRpcProvider(CREDITCOIN_RPC);
  const contract = new Contract(FINANCING_ADDRESS, FINANCING_READ_ABI, provider);
  const latest = await provider.getBlockNumber();
  const logs = await queryLogsInChunks(contract, contract.filters.FacilityCreated(), Math.max(0, latest - 45000), latest);
  return Promise.all(logs.map(async (log) => {
    const args = (log as any).args;
    const value = await contract.getFacility(args.facilityId);
    const status = ["ACTIVE", "PAUSED", "DEFAULTED", "SETTLED", "CANCELLED"][Number(value.status)] as FacilityStatus;
    return { id: args.facilityId, shipment: value.shipmentId, borrower: value.borrower, amount: Number(value.principal), released: Number(value.releasedAmount), status, next: `Milestone ${Number(value.nextMilestone)}`, lane: "Creditcoin testnet", source: log.transactionHash };
  }));
}

async function loadLiveShipments(): Promise<LiveShipment[]> {
  const provider = new JsonRpcProvider(SEPOLIA_RPC);
  const registry = new Contract(SOURCE_REGISTRY_ADDRESS, SOURCE_REGISTRY_READ_ABI, provider);
  const latest = await provider.getBlockNumber();
  // Public RPC providers cap eth_getLogs ranges at 50,000 blocks.
  const fromBlock = Math.max(0, latest - 45000);
  const registrations = await queryLogsInChunks(registry, registry.filters.ShipmentRegistered(), fromBlock, latest);
  const milestones = await queryLogsInChunks(registry, registry.filters.MilestoneRecorded(), fromBlock, latest);
  return registrations.map((log) => {
    const args = (log as any).args;
    const shipmentMilestones = milestones.filter((item) => (item as any).args?.shipmentId?.toLowerCase() === args.shipmentId.toLowerCase());
    const last = shipmentMilestones.at(-1) as any;
    const count = shipmentMilestones.length;
    return { shipmentId: args.shipmentId, borrower: args.borrower, lender: args.lender, milestoneCount: count, lastMilestone: last ? `Milestone ${Number(last.args.milestoneType)}` : "Registered · milestone pending", registrationTx: log.transactionHash, status: count >= 3 ? "DELIVERED" : count > 0 ? "IN TRANSIT" : "REGISTERED" };
  });
}

type Facility = {
  id: string;
  shipment: string;
  borrower: string;
  amount: number;
  released: number;
  status: FacilityStatus;
  next: string;
  lane: string;
  source: string;
};

const initialFacilities: Facility[] = [];

const navItems: { key: ViewKey; label: string; icon: LucideIcon; badge?: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "facilities", label: "Facilities", icon: CreditCard },
  { key: "shipments", label: "Shipments", icon: Ship },
  { key: "proofs", label: "Proof operations", icon: FileCheck2, badge: "02" },
];

const trancheHistory: Record<string, { label: string; amount: number; status: "RELEASED" | "PENDING" | "BLOCKED"; milestone: string; tx: string; time: string }[]> = {};

const statusStyles: Record<FacilityStatus, string> = {
  ACTIVE: "status-active",
  PAUSED: "status-paused",
  DEFAULTED: "status-danger",
  SETTLED: "status-settled",
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function downloadReceipt(facility: Facility) {
  const receipt = {
    receiptVersion: "cargo-proof-demo-v1",
    facilityId: facility.id,
    shipmentId: facility.shipment,
    sourceChain: "Ethereum Sepolia",
    settlementChain: "Creditcoin testnet",
    sourceTransaction: facility.source,
    milestone: facility.next,
    facilityStatus: facility.status,
    principal: facility.amount,
    releasedAmount: facility.released,
    trustBoundary: "Verifies an authorized on-chain event; does not independently verify physical reality.",
    generatedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${facility.id.toLowerCase()}-proof-receipt.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success("Proof receipt downloaded");
}

function downloadReport(facilities: Facility[]) {
  const header = ["facilityId", "shipmentId", "borrower", "principal", "released", "status", "nextMilestone", "lane"];
  const rows = facilities.map((facility) => [facility.id, facility.shipment, facility.borrower, facility.amount, facility.released, facility.status, facility.next, facility.lane]);
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cargo-proof-facilities-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success("Facility report downloaded");
}

function StatusPill({ status }: { status: FacilityStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}><span className="status-dot" />{status}</span>;
}

function TrancheHistory({ facility, onTransaction, liveItems }: { facility: Facility; onTransaction: (label: string, tx: string) => void; liveItems?: LiveTranche[] }) {
  const items = liveItems?.length ? liveItems : trancheHistory[facility.id] ?? [];
  return <div className="tranche-history"><div className="history-heading"><span className="eyebrow">Tranche history</span><span className="history-total">{items.filter((item) => item.status === "RELEASED").length} of {items.length} released</span></div><div className="tranche-list">{items.map((item) => <div className="tranche-item" key={item.label}><div className={`tranche-state ${item.status.toLowerCase()}`}>{item.status === "RELEASED" ? <Check size={11} /> : <Clock3 size={11} />}</div><div className="tranche-main"><strong>{item.label} <span>· {item.milestone}</span></strong><small>{item.time}</small></div><div className="tranche-amount"><strong>{money(item.amount)}</strong><button onClick={() => onTransaction(item.label, item.tx)}>{item.tx} <ArrowUpRight size={10} /></button></div></div>)}</div></div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: LucideIcon; tone: "lime" | "violet" | "amber" | "blue" }) {
  return <div className="metric-card surface animate-rise">
    <div className={`metric-icon metric-${tone}`}><Icon size={17} strokeWidth={1.8} /></div>
    <div className="metric-copy"><div className="eyebrow">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>
    <ArrowUpRight className="metric-arrow" size={15} />
  </div>;
}

function Pipeline({ events }: { events: LiveWorkerEvent[] }) {
  const latest = events[0];
  const phase = latest?.status === "RELEASED" ? 4 : latest?.status === "PROOF_ACCEPTED" ? 3 : latest?.status === "PROOF_PENDING" ? 2 : latest?.status === "DETECTED" ? 1 : 0;
  const steps = [{ title: "Source event", copy: "Ethereum Sepolia", tag: phase >= 1 ? "Detected" : "Awaiting event", icon: Ship }, { title: "Attestation", copy: "Attestcoin Protocol", tag: phase >= 2 ? "Proof pending" : "Pending", icon: ShieldCheck }, { title: "Proof check", copy: "Creditcoin ASC", tag: phase >= 3 ? "Accepted" : "Pending", icon: FileCheck2 }, { title: "Tranche payout", copy: "Financing contract", tag: phase >= 4 ? "Released" : "Next release", icon: CircleDollarSign }];
  return <div className="pipeline-card surface"><div className="pipeline-head"><div><div className="section-title">Verification pipeline</div><p>Live status from Sepolia events, worker events, and Creditcoin receipts.</p></div><div className="pipeline-meta"><span className="network-dot" /><strong>{latest ? "LIVE INDEXED" : "WAITING FOR EVENT"}</strong><span>·</span><span>{latest ? `Source ${latest.sourceTxHash.slice(0, 10)}…` : "No worker event"}</span></div></div><div className="pipeline">{steps.map((step, index) => <Fragment key={step.title}><div className={`pipe-step ${index < phase ? "complete" : index === phase ? "active" : ""}`}><div className="pipe-circle"><step.icon size={15} strokeWidth={1.8} /></div><h4>{step.title}</h4><p>{step.copy}</p><span className="pipe-tag">{step.tag}</span></div>{index < steps.length - 1 && <div key={`${step.title}-line`} className={`pipe-line ${index < phase ? "complete" : ""}`} />}</Fragment>)}</div></div>;
}

function ActivityFeed({ notifications = [], workerEvents = [], onRetryWorker, retrying = false }: { notifications?: Array<{ id: number; severity: string; title: string; message: string }>; workerEvents?: Array<{ id: number; status: string; milestoneId: string; shipmentId: string; facilityId: string | null; sourceTxHash: string; proofTxHash: string | null; releaseTxHash: string | null; updatedAt: Date | string }>; onRetryWorker: () => void; retrying?: boolean }) {
  const workerStatus = workerEvents[0]?.status ?? "WAITING";
  return <div className="activity-card surface">
    <div className="section-row"><div><span className="section-title">Live activity</span><span className="section-subtitle">Last 24 hours</span></div><button className="text-button" onClick={() => toast.success("Activity feed is up to date")}>View log <ArrowRight size={12} /></button></div>
    <div className="worker-alerts">{notifications.slice(0, 2).map((notification) => <div className={`worker-alert ${notification.severity.toLowerCase()}`} key={notification.id}><CircleAlert size={12} /><div><strong>{notification.title}</strong><small>{notification.message}</small></div></div>)}</div><div className="activity-list">
      {workerEvents.length > 0 ? workerEvents.slice(0, 4).map((event) => <div className="activity-item" key={event.id}><div className={`activity-icon ${event.status === "RELEASED" ? "lime" : event.status === "PROOF_ACCEPTED" ? "violet" : ""}`}><Check size={11} /></div><div className="activity-copy"><p><strong>{event.status.replaceAll("_", " ")}</strong> · {event.milestoneId.slice(0, 10)}…</p><small>{event.facilityId ? `Facility ${event.facilityId.slice(0, 10)}…` : `Shipment ${event.shipmentId.slice(0, 10)}…`} · {event.sourceTxHash.slice(0, 10)}…</small></div></div>) : <div className="empty-note">No indexed worker events yet. Run the one-shot worker after a Sepolia milestone is recorded.</div>}
    </div>
    <div className="worker-state"><span className="worker-pulse" /><span>Worker event status</span><strong>{workerStatus.replaceAll("_", " ")}</strong></div><div className="retry-queue"><div><span className="eyebrow">Retry queue</span><strong>{retrying ? "Submitting…" : "Run live worker"}</strong></div><button onClick={onRetryWorker} disabled={retrying}>{retrying ? <CircleDashed size={12} className="spin" /> : <Zap size={12} />} {retrying ? "Retrying" : "Retry now"}</button></div>
  </div>;
}

function FacilityTable({ facilities, onPause, onInspect }: { facilities: Facility[]; onPause: (id: string) => void | Promise<void>; onInspect: (facility: Facility) => void }) {
  const [query, setQuery] = useState("");
  const filtered = facilities.filter((facility) => `${facility.id} ${facility.shipment} ${facility.borrower}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="table-card surface">
    <div className="card-padding section-row"><div><span className="section-title">Financing facilities</span><span className="section-subtitle">{facilities.length} active records</span></div><div className="table-tools"><label className="search-box"><Search size={12} /><input aria-label="Search facilities" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label><button className="filter-btn" onClick={() => toast("Filters are ready for the connected indexer")}>Filter <ChevronDown size={12} /></button></div></div>
    <div className="table-scroll"><table className="facility-table"><thead><tr><th>Facility</th><th>Borrower</th><th>Principal / released</th><th>Status</th><th>Next milestone</th><th /></tr></thead><tbody>{filtered.map((facility) => <tr key={facility.id}>
      <td><div className="facility-id">{facility.id}<small>{facility.shipment}</small></div></td><td><div className="borrower">{facility.borrower}<small>{facility.lane}</small></div></td><td><div className="amount"><strong>{money(facility.amount)}</strong><small>{money(facility.released)} released</small><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min((facility.released / facility.amount) * 100, 100)}%` }} /></div></div></td><td><StatusPill status={facility.status} /></td><td><span className="borrower">{facility.next}</span><small className="next-meta">{facility.status === "ACTIVE" ? "Awaiting proof" : "Payout blocked"}</small></td><td><button className="row-action" aria-label={`Inspect ${facility.id}`} onClick={() => onInspect(facility)}><MoreHorizontal size={15} /></button>{facility.status === "ACTIVE" && <button className="row-action" aria-label={`Pause ${facility.id}`} onClick={() => onPause(facility.id)}><PauseCircle size={14} /></button>}</td>
    </tr>)}</tbody></table></div>
    {filtered.length === 0 && <div className="empty-note">No facilities match “{query}”.</div>}
  </div>;
}

function CreateFacilityModal({ onClose, onCreate, walletAddress, onCreateOnchain }: { onClose: () => void; onCreate: (facility: Facility) => void; walletAddress: string | null; onCreateOnchain: (input: { shipmentId: string; borrower: string; principal: number; trancheCount: number }) => Promise<{ facilityId: string; txHash: string }> }) {
  const [shipment, setShipment] = useState("CP-2026-012");
  const [borrower, setBorrower] = useState(walletAddress ?? "");
  useEffect(() => { if (walletAddress && !borrower) setBorrower(walletAddress); }, [walletAddress, borrower]);
  const [principal, setPrincipal] = useState("12000");
  const [tranches, setTranches] = useState("3");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = Number(principal);
    if (!walletAddress) { toast.error("Connect a wallet before creating a facility"); return; }
    if (!shipment || !borrower || !amount || amount < 1) { toast.error("Enter a valid borrower wallet address and facility amount"); return; }
    try {
      const result = await onCreateOnchain({ shipmentId: shipment, borrower, principal: amount, trancheCount: Number(tranches) });
      onCreate({ id: result.facilityId, shipment, borrower, amount, released: 0, status: "ACTIVE", next: "Cargo departed", lane: "Creditcoin testnet", source: result.txHash });
      toast.success(`Facility created on Creditcoin: ${result.txHash.slice(0, 10)}…`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Facility transaction failed"); }
  }
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="create-title"><form className="modal" onSubmit={submit}>
    <div className="modal-header"><div><h2 id="create-title">Create financing facility</h2><p>Set conditional credit rules for a shipment milestone lifecycle.</p></div><button type="button" className="close-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>
    <div className="form-grid"><div className="form-field full"><label htmlFor="shipment">Shipment ID</label><input id="shipment" value={shipment} onChange={(event) => setShipment(event.target.value)} placeholder="CP-2026-012" /></div><div className="form-field full"><label htmlFor="borrower">Borrower wallet address</label><input id="borrower" value={borrower} onChange={(event) => setBorrower(event.target.value)} placeholder="0x…" /></div><div className="form-field"><label htmlFor="principal">Principal (USD)</label><input id="principal" type="number" min="1" value={principal} onChange={(event) => setPrincipal(event.target.value)} /></div><div className="form-field"><label htmlFor="tranches">Tranches</label><select id="tranches" value={tranches} onChange={(event) => setTranches(event.target.value)}><option value="3">3 milestones</option><option value="2">2 milestones</option></select></div></div>
    <div className="form-help"><strong>Wallet transaction.</strong> You will review and sign this createFacility transaction on Creditcoin testnet. No production funds are used.</div><div className="modal-actions"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary"><LockKeyhole size={13} /> Sign &amp; create facility</button></div>
  </form></div>;
}

function Overview({ facilities, wallet, profileName, onPause, onInspect, onCreate, onchainFacility, notifications, workerEvents, onRetryWorker, retryingWorker }: { facilities: Facility[]; wallet: WalletSnapshot | null; profileName: string; onPause: (id: string) => void; onInspect: (facility: Facility) => void; onCreate: () => void; onchainFacility: OnchainFacility | null; notifications: Array<{ id: number; severity: string; title: string; message: string }>; workerEvents: Array<{ id: number; status: string; milestoneId: string; shipmentId: string; facilityId: string | null; sourceTxHash: string; proofTxHash: string | null; releaseTxHash: string | null; updatedAt: Date | string }>; onRetryWorker: () => void; retryingWorker: boolean }) {
  const totalPrincipal = facilities.reduce((total, facility) => total + facility.amount, 0);
  const totalReleased = facilities.reduce((total, facility) => total + facility.released, 0);
  const needsAttention = facilities.filter((facility) => facility.status !== "ACTIVE").length;
  const pendingFacilities = facilities.filter((facility) => facility.released < facility.amount).length;
  const completedProofs = workerEvents.filter((event) => ["PROOF_ACCEPTED", "RELEASED", "PAYOUT_RELEASED"].includes(event.status)).length;
  const proofRate = workerEvents.length ? `${Math.round((completedProofs / workerEvents.length) * 100)}%` : "—";
  const greetingName = profileName.trim() || (wallet ? `Wallet ${shortAddress(wallet.address)}` : "CargoProof operator");
  return <>
    <div className="page-heading"><div><p className="kicker">Credit rail / Overview</p><h1>Good morning, {greetingName}.</h1><p>Monitor conditional financing across your shipment portfolio.</p></div><div className="heading-actions"><button className="btn-secondary" onClick={() => downloadReport(facilities)}><ArrowUpRight size={13} /> Export report</button><button className="btn-primary" onClick={onCreate}><Plus size={14} /> Create facility</button></div></div>
    <div className="metrics-grid"><MetricCard label="Total facilities" value={String(facilities.length).padStart(2, "0")} detail={`${needsAttention} needs attention`} icon={CreditCard} tone="lime" /><MetricCard label="Capital deployed" value={money(totalReleased)} detail={`${totalPrincipal ? Math.round((totalReleased / totalPrincipal) * 100) : 0}% of principal`} icon={CircleDollarSign} tone="violet" /><MetricCard label="Pending tranches" value={String(pendingFacilities).padStart(2, "0")} detail={`Across ${pendingFacilities} facilities`} icon={Clock3} tone="amber" /><MetricCard label="Proof success rate" value={proofRate} detail={workerEvents.length ? `Based on ${workerEvents.length} worker events` : "No worker events indexed"} icon={BadgeCheck} tone="blue" /></div>
    {onchainFacility && <div className="onchain-strip surface"><div><span className="eyebrow">Live on-chain snapshot</span><strong>Creditcoin facility {onchainFacility.facilityId.slice(0, 10)}…</strong><small>Shipment {onchainFacility.shipmentId.slice(0, 10)}… · tranche {onchainFacility.nextMilestone} of {onchainFacility.trancheCount} next</small></div><div className="onchain-values"><span><small>Principal</small><strong>{money(Number(onchainFacility.principal) / 1e0)}</strong></span><span><small>Released</small><strong>{money(Number(onchainFacility.released) / 1e0)}</strong></span><span className="status-pill status-active"><span className="status-dot" />{onchainFacility.status === 0 ? "ACTIVE" : "ON-CHAIN"}</span></div></div>}
    <Pipeline events={workerEvents} />
    <div className="dashboard-grid"><FacilityTable facilities={facilities} onPause={onPause} onInspect={onInspect} /><ActivityFeed notifications={notifications} workerEvents={workerEvents} onRetryWorker={onRetryWorker} retrying={retryingWorker} /></div>
  </>;
}

function FacilitiesView({ facilities, onPause, onInspect, onCreate }: { facilities: Facility[]; onPause: (id: string) => void | Promise<void>; onInspect: (facility: Facility) => void; onCreate: () => void }) {
  return <><div className="page-heading"><div><p className="kicker">Portfolio / Facilities</p><h1>Financing facilities</h1><p>Every facility is governed by a milestone-based release schedule.</p></div><div className="heading-actions"><button className="btn-primary" onClick={onCreate}><Plus size={14} /> Create facility</button></div></div><div className="dashboard-grid"><FacilityTable facilities={facilities} onPause={onPause} onInspect={onInspect} /><div className="view-card surface"><div className="section-title">Facility rules</div><p>The financing contract prevents payout when a proof is invalid, out of order, replayed, or the facility is paused.</p><div className="proof-list"><div className="proof-row"><div className="proof-number">01</div><div><strong>Ordered milestones</strong><small>Departed → hub → delivered</small></div><Check size={14} color="#c7f36b" /></div><div className="proof-row"><div className="proof-number">02</div><div><strong>Replay protection</strong><small>One source event, one payout</small></div><Check size={14} color="#c7f36b" /></div><div className="proof-row"><div className="proof-number">03</div><div><strong>Principal invariant</strong><small>Total payout ≤ principal</small></div><Check size={14} color="#c7f36b" /></div></div></div></div></>;
}

function ShipmentsView({ wallet, setWallet, onRefresh, refreshing, shipments }: { wallet: WalletSnapshot | null; setWallet: (wallet: WalletSnapshot | null) => void; onRefresh: () => void; refreshing: boolean; shipments: LiveShipment[] }) {
  const [shipmentId, setShipmentId] = useState("CP-2026-012"); const [sourceTx, setSourceTx] = useState(""); const [milestoneType, setMilestoneType] = useState(1); const [busy, setBusy] = useState(false); const [registered, setRegistered] = useState(false);
  const indexedShipment = useMemo(() => { const hash = keccak256(toUtf8Bytes(shipmentId)).toLowerCase(); return shipments.find((item) => item.shipmentId.toLowerCase() === hash); }, [shipmentId, shipments]);
  useEffect(() => { if (!indexedShipment) return; setMilestoneType(Math.min(indexedShipment.milestoneCount + 1, 3)); setRegistered(true); setSourceTx((current) => current || indexedShipment.registrationTx); }, [indexedShipment]);
  const submitRegister = async () => { if (!wallet) return toast.error("Connect wallet first"); if (!shipmentId.trim()) return toast.error("Enter a Shipment ID first"); setBusy(true); try { if (wallet.network !== "sepolia") { await switchWalletNetwork("sepolia"); const refreshed = await readWalletSnapshot(); if (!refreshed) throw new Error("Wallet account is unavailable after switching to Sepolia"); setWallet(refreshed); } const result = await registerShipmentOnchain({ shipmentId: shipmentId.trim(), borrower: wallet.address, lender: wallet.address }); setSourceTx(result.txHash); setRegistered(true); toast.success(`Shipment registered on Sepolia: ${result.txHash.slice(0, 10)}…`); } catch (error) { toast.error(error instanceof Error ? error.message : "Shipment registration failed"); } finally { setBusy(false); } };
  const submitMilestone = async () => { if (!sourceTx) return toast.error("Register the shipment first or provide its source transaction hash"); setBusy(true); try { if (wallet?.network !== "sepolia") { await switchWalletNetwork("sepolia"); const refreshed = await readWalletSnapshot(); setWallet(refreshed); } const result = await recordMilestoneOnchain({ shipmentId: shipmentId.trim(), milestoneType, sourceTxHash: sourceTx }); const label = ["", "Cargo departed", "Hub arrival", "Delivered"][result.milestoneType] ?? `Milestone ${result.milestoneType}`; toast.success(`${label} recorded on Ethereum Sepolia: ${result.txHash.slice(0, 10)}…`); setMilestoneType(Math.min(result.milestoneType + 1, 3)); onRefresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Milestone transaction failed"); } finally { setBusy(false); } };
  const milestones = ["Cargo departed", "Hub arrival", "Delivered"];
  return <><div className="page-heading"><div><p className="kicker">Source chain / Registry</p><h1>Shipment registry</h1><p>Ethereum Sepolia transactions are the source of truth for milestone proofs.</p></div><div className="heading-actions"><button className="btn-secondary" onClick={onRefresh} disabled={busy || refreshing}><Activity size={13} /> {refreshing ? "Refreshing…" : "Refresh shipments"}</button><button className="btn-secondary" onClick={submitRegister} disabled={busy || registered}>Register shipment <ArrowRight size={13} /></button></div></div><div className="view-grid"><div className="view-card surface"><div className="section-row"><span className="section-title">Indexed shipments</span><span className="status-pill status-active"><span className="status-dot" />{shipments.length} live</span></div><div className="shipment-grid">{shipments.map((item) => <div className="shipment-card" key={item.shipmentId}><div><strong>{item.shipmentId.slice(0, 14)}…</strong><small>{item.borrower}</small><div className="shipment-route"><Route size={11} />{item.lastMilestone}</div></div><div><StatusPill status={item.status === "DELIVERED" ? "SETTLED" : item.status === "IN TRANSIT" ? "ACTIVE" : "PAUSED"} /><small><a href={`https://sepolia.etherscan.io/tx/${item.registrationTx}`} target="_blank" rel="noreferrer">View registration ↗</a></small></div></div>)}</div></div><div className="view-card surface"><div className="section-row"><span className="section-title">Live shipment operator</span><span className="status-pill status-active"><span className="status-dot" />Sepolia</span></div><div className="form-grid"><div className="form-field full"><label htmlFor="source-shipment">Shipment ID label</label><input id="source-shipment" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} /></div><div className="form-field full"><label htmlFor="source-tx">Registration transaction hash</label><input id="source-tx" value={sourceTx} onChange={(event) => setSourceTx(event.target.value)} placeholder="0x…" /></div></div><div className="form-help"><strong>Wallet transaction.</strong> MetaMask must be connected to Ethereum Sepolia. Current wallet: {wallet ? wallet.address : "not connected"}.</div><div className="operator-next"><div><span className="eyebrow">Next milestone</span><strong>{milestones[milestoneType - 1] ?? "Sequence complete"}</strong></div><button className="btn-primary" onClick={submitMilestone} disabled={busy || milestoneType > 3}>{busy ? "Confirming…" : "Record event"} <ArrowUpRight size={13} /></button></div></div><div className="view-card surface"><div className="section-title">Transaction lifecycle</div><div className="activity-list"><div className="activity-item"><div className="activity-icon lime"><Ship size={11} /></div><div className="activity-copy"><p><strong>Register shipment</strong></p><small>{registered ? `Confirmed · ${sourceTx.slice(0, 12)}…` : "Awaiting Sepolia transaction"}</small></div></div><div className="activity-item"><div className="activity-icon violet"><ShieldCheck size={11} /></div><div className="activity-copy"><p><strong>Record ordered milestones</strong></p><small>Milestone {milestoneType} of 3 · {wallet?.network === "sepolia" ? "Wallet on Sepolia" : "Switch wallet to Sepolia"}</small></div></div><div className="activity-item"><div className="activity-icon"><CircleDollarSign size={11} /></div><div className="activity-copy"><p><strong>Worker proof and payout</strong></p><small>Run the one-shot worker after the event is confirmed</small></div></div></div></div></div></>;
}

function ProofsView({ events, onRefresh, refreshing }: { events: LiveWorkerEvent[]; onRefresh: () => void; refreshing: boolean }) {
  const stateIcon = (state: string) => state === "RELEASED" || state === "PROOF_ACCEPTED" ? Check : state === "FAILED" ? CircleAlert : Clock3;
  return <><div className="page-heading"><div><p className="kicker">Attestcoin / Operations</p><h1>Proof operations</h1><p>Live worker events from source transaction to financing decision.</p></div><div className="heading-actions"><button className="btn-secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh status"} <Activity size={13} /></button></div></div><div className="view-grid"><div className="view-card surface"><div className="section-row"><span className="section-title">Verification queue</span><span className="status-pill status-active"><span className="status-dot" />{events.length} indexed</span></div><div className="proof-list">{events.length ? events.map((event, index) => { const Icon = stateIcon(event.status); return <div className="proof-row" key={event.id}><div className="proof-number">{String(index + 1).padStart(2, "0")}</div><div><strong>{event.status.replaceAll("_", " ")} · {event.milestoneId.slice(0, 12)}…</strong><small>Source TX {event.sourceTxHash.slice(0, 12)}… · Shipment {event.shipmentId.slice(0, 12)}…</small></div><span className={`proof-state ${event.status === "FAILED" ? "failed" : event.status === "PROOF_PENDING" ? "waiting" : ""}`}><Icon size={11} /> {event.status.replaceAll("_", " ")}</span></div>; }) : <div className="empty-note">No worker events indexed yet. Record a Sepolia milestone and run the worker.</div>}</div></div><div className="view-card surface"><div className="section-title">Trust boundary</div><p>CargoProof verifies that an authorized operator published an event on-chain. It does not independently verify the physical world.</p><div className="proof-list"><div className="proof-row"><div className="proof-number"><Ship size={13} /></div><div><strong>Source event</strong><small>Ethereum Sepolia registry</small></div><BadgeCheck size={14} color="#c7f36b" /></div><div className="proof-row"><div className="proof-number"><ShieldCheck size={13} /></div><div><strong>Cross-chain proof</strong><small>Attestcoin continuity + Merkle proof</small></div><BadgeCheck size={14} color="#c7f36b" /></div><div className="proof-row"><div className="proof-number"><CircleDollarSign size={13} /></div><div><strong>Financial action</strong><small>Creditcoin financing contract</small></div><BadgeCheck size={14} color="#c7f36b" /></div></div></div></div></>;
}

export default function Home() {
  const [view, setView] = useState<ViewKey>("overview");
  const [facilities, setFacilities] = useState(initialFacilities);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Facility | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [transaction, setTransaction] = useState<{ label: string; tx: string; facility: Facility } | null>(null);
  const [onchainFacility, setOnchainFacility] = useState<OnchainFacility | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(() => window.localStorage.getItem("cargo-proof-profile-name") ?? "");
  const [trancheItems, setTrancheItems] = useState<Record<string, LiveTranche[]>>({});
  const [liveShipments, setLiveShipments] = useState<LiveShipment[]>([]);
  const [refreshingShipments, setRefreshingShipments] = useState(false);
  const { data: workerNotifications = [] } = trpc.cargoProof.notifications.useQuery({ limit: 5 }, { refetchInterval: 30000 });
  const { data: workerEvents = [], refetch: refetchWorkerEvents } = trpc.cargoProof.workerEvents.useQuery({ limit: 10 }, { refetchInterval: 15000 });
  const verifyWalletSignature = trpc.walletAuth.verifySignature.useMutation();
  const [refreshingProofs, setRefreshingProofs] = useState(false);
  const [retryingWorker, setRetryingWorker] = useState(false);
  const retryWorkerMutation = trpc.cargoProof.retryWorker.useMutation();
  const upsertMappingMutation = trpc.cargoProof.upsertMapping.useMutation();
  const onRetryWorker = async () => {
    setRetryingWorker(true);
    try {
      const result = await retryWorkerMutation.mutateAsync();
      if (result.output.includes("Tranche released")) toast.success("Worker retried successfully and released a tranche");
      else if (result.output.includes("not yet attested")) toast("Worker is waiting for the next attested Sepolia height");
      else toast.success("Worker retry completed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Worker retry failed"); }
    finally { setRetryingWorker(false); }
  };
  const refreshProofStatus = async () => {
    setRefreshingProofs(true);
    try {
      const result = await refetchWorkerEvents();
      toast.success(`Proof status refreshed: ${result.data?.length ?? 0} indexed`);
    } catch (error) {
      toast.error(error instanceof Error ? `Status refresh failed: ${error.message}` : "Status refresh failed");
    } finally { setRefreshingProofs(false); }
  };
  const refreshLiveShipments = async () => {
    setRefreshingShipments(true);
    try {
      const shipments = await loadLiveShipments();
      setLiveShipments(shipments);
      toast.success(`Shipment list refreshed: ${shipments.length} live`);
    } catch (error) {
      setLiveShipments([]);
      toast.error(error instanceof Error ? `Shipment refresh failed: ${error.message}` : "Shipment refresh failed");
    } finally { setRefreshingShipments(false); }
  };
  const refreshShipmentsView = async () => {
    await refreshLiveShipments();
    try {
      const facilities = await loadOnchainFacilities();
      setFacilities(facilities);
      setOnchainFacility(null);
    } catch (error) {
      toast.error(error instanceof Error ? `Facility refresh failed: ${error.message}` : "Facility refresh failed");
    }
  };
  const openCreate = () => setModalOpen(true);
  const pauseFacility = async (id: string) => { try { const result = await pauseFacilityOnchain(id); toast.success(`Facility paused: ${result.txHash.slice(0, 10)}…`); const facilities = await loadOnchainFacilities(); setFacilities(facilities); } catch (error) { toast.error(error instanceof Error ? error.message : "Pause transaction failed"); } };
  const inspect = (facility: Facility) => { setSelected(facility); void loadTranches(facility.id); toast(`Inspecting ${facility.id}`); };
  const loadTranches = async (facilityId: string) => { const provider = new JsonRpcProvider(CREDITCOIN_RPC); const contract = new Contract(FINANCING_ADDRESS, FINANCING_READ_ABI, provider); const latest = await provider.getBlockNumber(); const logs = await queryLogsInChunks(contract, contract.filters.TrancheReleased(facilityId), Math.max(0, latest - 45000), latest); const items = logs.map((log, index) => { const args = (log as any).args; return { label: `Tranche ${String(Number(args.trancheIndex) + 1).padStart(2, "0")}`, amount: Number(args.amount), status: "RELEASED" as const, milestone: args.milestoneId.slice(0, 12) + "…", tx: log.transactionHash, time: new Date().toLocaleString() }; }); setTrancheItems((current) => ({ ...current, [facilityId]: items })); };
  const handleCreate = async (facility: Facility) => { try { await upsertMappingMutation.mutateAsync({ shipmentId: keccak256(toUtf8Bytes(facility.shipment)), facilityId: facility.id, sourceRegistry: SOURCE_REGISTRY_ADDRESS, chainKey: 1 }); } catch (error) { toast.error(error instanceof Error ? `Facility created, but worker mapping failed: ${error.message}` : "Facility mapping failed"); } const facilities = await loadOnchainFacilities(); setFacilities(facilities); setModalOpen(false); setView("facilities"); toast.success(`${facility.id} created on Creditcoin testnet`); };
  const inspectTransaction = (label: string, tx: string) => { if (selected) setTransaction({ label, tx, facility: selected }); };
  useEffect(() => { let active = true; refreshLiveShipments(); const timer = window.setInterval(refreshLiveShipments, 15000); loadOnchainFacilities().then((values) => { if (!active) return; setFacilities(values); }).catch(() => { if (active) { setOnchainFacility(null); setFacilities([]); toast.error("Live on-chain facilities unavailable."); } }); return () => { active = false; window.clearInterval(timer); }; }, []);
  useEffect(() => {
    const injected = window.ethereum;
    if (!injected) return;
    const refresh = (...args: unknown[]) => { readWalletSnapshot(Array.isArray(args[0]) ? args[0] as string[] : undefined).then(setWallet).catch(() => setWallet(null)); };
    refresh();
    injected.on?.("accountsChanged", refresh);
    injected.on?.("chainChanged", refresh);
    return () => { injected.removeListener?.("accountsChanged", refresh); injected.removeListener?.("chainChanged", refresh); };
  }, []);
  const handleConnectWallet = async () => {
    setWalletBusy(true);
    try {
      const connected = await connectWallet();
      setWallet(connected);
      setWalletMenuOpen(false);
      toast.success(`${shortAddress(connected.address)} connected on ${connected.network ?? `chain ${connected.chainId}`}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to connect wallet");
    } finally { setWalletBusy(false); }
  };
  const handleConnectMobileWallet = async () => {
    setWalletBusy(true);
    try { const connected = await connectWalletConnect(); setWallet(connected); setWalletMenuOpen(false); toast.success(`${shortAddress(connected.address)} connected via WalletConnect`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to connect mobile wallet"); }
    finally { setWalletBusy(false); }
  };
  const handleSignWallet = async () => {
    if (!wallet) return toast.error("Connect a wallet first");
    setWalletBusy(true);
    try {
      const message = `CargoProof wallet authentication\nTimestamp: ${new Date().toISOString()}\nNonce: ${crypto.randomUUID()}`;
      const signature = await signWalletMessage(message);
      await verifyWalletSignature.mutateAsync({ address: wallet.address, message, signature });
      toast.success("Wallet signature verified");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Signature verification failed"); }
    finally { setWalletBusy(false); }
  };
  const createOnchain = (input: { shipmentId: string; borrower: string; principal: number; trancheCount: number }) => createFacilityOnchain(input);
  const handleSwitchNetwork = async (network: WalletNetwork) => {
    setWalletBusy(true);
    try { await switchWalletNetwork(network); setWallet(await readWalletSnapshot()); toast.success(`Switched to ${network === "sepolia" ? "Ethereum Sepolia" : "Creditcoin testnet"}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to switch network"); }
    finally { setWalletBusy(false); }
  };
  const currentLabel = useMemo(() => navItems.find((item) => item.key === view)?.label ?? "Overview", [view]);
  const networkLabel = wallet?.network === "sepolia" ? "Ethereum Sepolia" : wallet?.network === "creditcoin" ? "Creditcoin testnet" : "Wallet not connected";
  const networkDetail = wallet?.network === "creditcoin" ? "Attestcoin adapter connected" : wallet?.network === "sepolia" ? "Source registry connected" : "Connect wallet to continue";
  return <div className="app-shell">
            <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>Cargo<span>Proof</span></strong><small>Conditional credit rail</small></div></div><div className="network-card"><div className="network-label"><span className="network-dot" />Network status</div><strong><span className="network-dot" />{networkLabel}</strong><em>{networkDetail}</em></div><div className="nav-label">Workspace</div><nav className="nav-list" aria-label="Main navigation">{navItems.map(({ key, label, icon: Icon, badge }) => <button key={key} className={`nav-item ${view === key ? "active" : ""}`} onClick={() => { setView(key); setSidebarOpen(false); }}><Icon size={15} strokeWidth={1.8} /><span>{label}</span>{badge && <span className="nav-badge">{badge}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="help-card"><p>Need to understand a proof state?</p><button onClick={() => setView("proofs")}>Open proof guide <ArrowRight size={11} /></button></div><div className="profile"><div className="avatar">{wallet ? wallet.address.slice(2, 4).toUpperCase() : "—"}</div><div><strong>{profileName.trim() || (wallet ? "Connected wallet" : "Wallet not connected")}</strong><small>{wallet ? `${wallet.network ?? "Unsupported network"} · ${shortAddress(wallet.address)}` : "Connect wallet to continue"}</small></div><button className="row-action" onClick={() => setProfileOpen(true)} aria-label="Edit profile"><Settings2 size={14} /></button></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Open navigation"><Menu size={16} /></button><div className="crumb"><span>Workspace</span><ArrowRight size={11} /><b>{currentLabel}</b></div><div className="topbar-divider" /><div className="sync-state"><span />Worker sync <strong>{workerEvents.length ? "Indexed" : "Waiting"}</strong></div></div><div className="topbar-right"><button className="top-icon" onClick={() => toast(workerNotifications.length ? `${workerNotifications.length} worker alerts` : "No new alerts")} aria-label="Notifications"><Bell size={14} /></button><div className="wallet-wrap">
            <button className="wallet wallet-button" onClick={() => wallet ? setWalletMenuOpen((open) => !open) : handleConnectWallet()} disabled={walletBusy} aria-label={wallet ? "Open wallet menu" : "Connect wallet"}><span className="wallet-avatar"><WalletCards size={12} /></span><span>{wallet ? shortAddress(wallet.address) : walletBusy ? "Connecting…" : "Connect wallet"}</span><ChevronDown size={11} /></button><button className="wallet-mobile-button" onClick={handleConnectMobileWallet} disabled={walletBusy}>Mobile</button>
            {walletMenuOpen && wallet && <div className="wallet-menu"><strong>{shortAddress(wallet.address)}</strong><small>{wallet.network ?? `Unsupported chain · ${wallet.chainId}`}</small><small>{Number(wallet.balance).toFixed(4)} native balance</small>{!wallet.network && <><button onClick={() => handleSwitchNetwork("sepolia")}>Switch to Sepolia</button><button onClick={() => handleSwitchNetwork("creditcoin")}>Switch to Creditcoin</button></>}<button onClick={handleSignWallet}>Sign in with wallet</button><button className="wallet-disconnect" onClick={() => { void disconnectWallet(); setWallet(null); setWalletMenuOpen(false); toast("Wallet disconnected from this dashboard"); }}>Disconnect</button></div>}
          </div></div></header><div className="content-wrap">{view === "overview" && <Overview facilities={facilities} wallet={wallet} profileName={profileName} onPause={pauseFacility} onInspect={inspect} onCreate={openCreate} onchainFacility={onchainFacility} notifications={workerNotifications} workerEvents={workerEvents} onRetryWorker={onRetryWorker} retryingWorker={retryingWorker} />}{view === "facilities" && <FacilitiesView facilities={facilities} onPause={pauseFacility} onInspect={inspect} onCreate={openCreate} />}{view === "shipments" && <ShipmentsView wallet={wallet} setWallet={setWallet} onRefresh={() => { void refreshShipmentsView(); }} refreshing={refreshingShipments} shipments={liveShipments} />}{view === "proofs" && <ProofsView events={workerEvents} onRefresh={() => { void refreshProofStatus(); }} refreshing={refreshingProofs} />}</div></main>
    {profileOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-title"><form className="modal" onSubmit={(event) => { event.preventDefault(); window.localStorage.setItem("cargo-proof-profile-name", profileName.trim()); setProfileOpen(false); toast.success("Profile name saved"); }}><div className="modal-header"><div><p className="kicker">Workspace settings</p><h2 id="profile-title">Profile</h2><p>Choose the name shown in your dashboard greeting.</p></div><button type="button" className="close-button" onClick={() => setProfileOpen(false)} aria-label="Close"><X size={15} /></button></div><div className="form-field full"><label htmlFor="profile-name">Display name</label><input id="profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="e.g. Budi Cargo Operations" maxLength={60} /></div><div className="form-help"><strong>Wallet identity:</strong> {wallet ? shortAddress(wallet.address) : "Not connected"}. The wallet address remains available in the wallet menu.</div><div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setProfileOpen(false)}>Cancel</button><button type="submit" className="btn-primary">Save profile</button></div></form></div>}
    {modalOpen && <CreateFacilityModal onClose={() => setModalOpen(false)} onCreate={handleCreate} walletAddress={wallet?.address ?? null} onCreateOnchain={createOnchain} />}
    {selected && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="facility-title"><div className="modal"><div className="modal-header"><div><p className="kicker">Facility detail</p><h2 id="facility-title">{selected.id} · {selected.borrower}</h2><p>{selected.shipment} · {selected.lane}</p></div><button className="close-button" onClick={() => setSelected(null)} aria-label="Close"><X size={15} /></button></div><div className="view-grid"><div><div className="eyebrow">Principal</div><div className="metric-value">{money(selected.amount)}</div></div><div><div className="eyebrow">Released</div><div className="metric-value">{money(selected.released)}</div></div></div><div className="form-help"><strong>Next rule:</strong> {selected.next} requires a valid Attestcoin proof from the source-chain event. Status: <StatusPill status={selected.status} /></div><TrancheHistory facility={selected} onTransaction={inspectTransaction} liveItems={trancheItems[selected.id]} /><div className="modal-actions"><button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(selected.source); toast.success("Source reference copied"); }}> <Copy size={13} /> {selected.source}</button><button className="btn-secondary" onClick={() => downloadReceipt(selected)}><FileCheck2 size={13} /> Export receipt</button><button className="btn-primary" onClick={() => setSelected(null)}>Done</button></div></div></div>}
    {transaction && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal transaction-modal"><div className="modal-header"><div><p className="kicker">Transaction detail</p><h2 id="transaction-title">{transaction.label}</h2><p>{transaction.facility.id} · {transaction.facility.shipment}</p></div><button className="close-button" onClick={() => setTransaction(null)} aria-label="Close"><X size={15} /></button></div><div className="transaction-ref"><span>Transaction reference</span><strong>{transaction.tx}</strong><button onClick={() => { navigator.clipboard?.writeText(transaction.tx); toast.success("Transaction reference copied"); }}><Copy size={12} /> Copy</button></div><div className="audit-trail"><div className="audit-step done"><span><Check size={11} /></span><div><strong>Source event recorded</strong><small>Ethereum Sepolia · {transaction.facility.source}</small></div></div><div className="audit-step done"><span><ShieldCheck size={11} /></span><div><strong>Attestation verified</strong><small>Attestcoin continuity proof accepted</small></div></div><div className="audit-step current"><span><CircleDollarSign size={11} /></span><div><strong>Creditcoin decision</strong><small>{transaction.tx === "Awaiting proof" ? "Awaiting valid proof" : "Receipt linked to payout rule"}</small></div></div></div><div className="modal-actions"><button className="btn-secondary" onClick={() => setTransaction(null)}>Close</button><button className="btn-primary" onClick={() => downloadReceipt(transaction.facility)}><FileCheck2 size={13} /> Export receipt</button></div></div></div>}
  </div>;
}
