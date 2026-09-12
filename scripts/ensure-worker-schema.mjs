import fs from "node:fs/promises";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to initialize the worker schema");

const migration = await fs.readFile(new URL("../drizzle/0000_swift_sinister_six.sql", import.meta.url), "utf8");
const statements = migration
  .split(/--> statement-breakpoint/g)
  .map((statement) => statement.trim())
  .filter(Boolean);

const connection = await mysql.createConnection(databaseUrl);
try {
  for (const statement of statements) {
    const sql = statement.replace(/^CREATE TABLE `/i, "CREATE TABLE IF NOT EXISTS `");
    try {
      await connection.query(sql);
    } catch (error) {
      if (error?.code === "ER_DUP_KEYNAME" || error?.code === "ER_DUP_ENTRY") continue;
      throw new Error(`Worker schema migration failed: ${error.message}`, { cause: error });
    }
  }
  console.log(`[Schema] ensured ${statements.length} worker database statements`);
} finally {
  await connection.end();
}
