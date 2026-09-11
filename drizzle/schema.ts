import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, uniqueIndex, index } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const shipmentFacilityMappings = mysqlTable("shipment_facility_mappings", {
  id: int("id").autoincrement().primaryKey(),
  shipmentId: varchar("shipmentId", { length: 66 }).notNull(),
  facilityId: varchar("facilityId", { length: 66 }).notNull(),
  sourceRegistry: varchar("sourceRegistry", { length: 42 }).notNull(),
  chainKey: int("chainKey").default(1).notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  shipmentUnique: uniqueIndex("shipment_facility_shipment_unique").on(table.shipmentId),
  facilityIndex: index("shipment_facility_facility_idx").on(table.facilityId),
}));

export const workerEvents = mysqlTable("worker_events", {
  id: int("id").autoincrement().primaryKey(),
  sourceTxHash: varchar("sourceTxHash", { length: 66 }).notNull(),
  sourceBlock: int("sourceBlock").notNull(),
  shipmentId: varchar("shipmentId", { length: 66 }).notNull(),
  milestoneId: varchar("milestoneId", { length: 66 }).notNull(),
  milestoneType: int("milestoneType").notNull(),
  facilityId: varchar("facilityId", { length: 66 }),
  proofTxHash: varchar("proofTxHash", { length: 66 }),
  releaseTxHash: varchar("releaseTxHash", { length: 66 }),
  status: mysqlEnum("status", ["DETECTED", "PROOF_PENDING", "PROOF_ACCEPTED", "RELEASED", "FAILED"]).default("DETECTED").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: text("lastError"),
  nextRetryAt: timestamp("nextRetryAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  sourceTxUnique: uniqueIndex("worker_events_source_tx_unique").on(table.sourceTxHash),
  milestoneIndex: index("worker_events_milestone_idx").on(table.milestoneId),
  statusIndex: index("worker_events_status_idx").on(table.status),
}));

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["PROOF_FAILED", "RETRY_QUEUE", "RELEASED"]).notNull(),
  severity: mysqlEnum("severity", ["INFO", "WARNING", "ERROR"]).default("INFO").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  dedupeKey: varchar("dedupeKey", { length: 180 }).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  dedupeUnique: uniqueIndex("notifications_dedupe_unique").on(table.dedupeKey),
  unreadIndex: index("notifications_unread_idx").on(table.readAt),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ShipmentFacilityMapping = typeof shipmentFacilityMappings.$inferSelect;
export type WorkerEvent = typeof workerEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
