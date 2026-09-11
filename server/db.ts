import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  notifications,
  shipmentFacilityMappings,
  users,
  workerEvents,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  } else {
    values.lastSignedIn = new Date();
    updateSet.lastSignedIn = values.lastSignedIn;
  }
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) {
    values.role = user.role ?? "admin";
    updateSet.role = values.role;
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listShipmentFacilityMappings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(shipmentFacilityMappings).where(eq(shipmentFacilityMappings.active, 1)).orderBy(desc(shipmentFacilityMappings.updatedAt));
}

export async function upsertShipmentFacilityMapping(input: {
  shipmentId: string;
  facilityId: string;
  sourceRegistry: string;
  chainKey: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(shipmentFacilityMappings).values(input).onDuplicateKeyUpdate({
    set: { facilityId: input.facilityId, sourceRegistry: input.sourceRegistry, chainKey: input.chainKey, active: 1, updatedAt: new Date() },
  });
  const result = await db.select().from(shipmentFacilityMappings).where(eq(shipmentFacilityMappings.shipmentId, input.shipmentId)).limit(1);
  return result[0];
}

export async function listWorkerEvents(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workerEvents).orderBy(desc(workerEvents.createdAt)).limit(limit);
}

export async function listNotifications(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  return { success: true } as const;
}

export async function createNotification(input: {
  type: "PROOF_FAILED" | "RETRY_QUEUE" | "RELEASED";
  severity: "INFO" | "WARNING" | "ERROR";
  title: string;
  message: string;
  dedupeKey: string;
}) {
  const db = await getDb();
  if (!db) return undefined;
  await db.insert(notifications).values(input).onDuplicateKeyUpdate({ set: { title: input.title, message: input.message, severity: input.severity } });
  const result = await db.select().from(notifications).where(and(eq(notifications.dedupeKey, input.dedupeKey))).limit(1);
  return result[0];
}
