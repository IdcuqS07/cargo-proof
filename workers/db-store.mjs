import mysql from "mysql2/promise";

let pool;
function getPool() {
  if (!pool && process.env.DATABASE_URL) pool = mysql.createPool(process.env.DATABASE_URL);
  return pool;
}

export async function listMappings() {
  const db = getPool();
  if (!db) return [];
  const [rows] = await db.query("SELECT shipmentId, facilityId, sourceRegistry, chainKey FROM shipment_facility_mappings WHERE active = 1");
  return rows;
}

export async function upsertWorkerEvent(event) {
  const db = getPool();
  if (!db) return;
  await db.query(`INSERT INTO worker_events (sourceTxHash, sourceBlock, shipmentId, milestoneId, milestoneType, facilityId, status, attempts)
    VALUES (?, ?, ?, ?, ?, ?, 'DETECTED', 0)
    ON DUPLICATE KEY UPDATE facilityId = VALUES(facilityId), updatedAt = CURRENT_TIMESTAMP`, [event.sourceTxHash, event.sourceBlock, event.shipmentId, event.milestoneId, event.milestoneType, event.facilityId]);
}

export async function updateWorkerEvent(sourceTxHash, patch) {
  const db = getPool();
  if (!db) return;
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  values.push(sourceTxHash);
  await db.query(`UPDATE worker_events SET ${fields.join(", ")}, updatedAt = CURRENT_TIMESTAMP WHERE sourceTxHash = ?`, values);
}

export async function createNotification(notification) {
  const db = getPool();
  if (!db) return;
  await db.query(`INSERT INTO notifications (type, severity, title, message, dedupeKey)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message), severity = VALUES(severity)`, [notification.type, notification.severity, notification.title, notification.message, notification.dedupeKey]);
}

export async function countRetryQueue() {
  const db = getPool();
  if (!db) return 0;
  const [rows] = await db.query("SELECT COUNT(*) AS count FROM worker_events WHERE status IN ('DETECTED', 'PROOF_PENDING', 'FAILED')");
  return Number(rows[0]?.count ?? 0);
}

export function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export async function markWorkerFailure(sourceTxHash, errorMessage) {
  const db = getPool();
  if (!db) return;
  await db.query("UPDATE worker_events SET status = 'FAILED', lastError = ?, attempts = attempts + 1, nextRetryAt = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE), updatedAt = CURRENT_TIMESTAMP WHERE sourceTxHash = ?", [errorMessage.slice(0, 10000), sourceTxHash]);
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
