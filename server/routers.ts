import { getAddress, verifyMessage } from "ethers";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import {
  createNotification,
  listNotifications,
  listShipmentFacilityMappings,
  listWorkerEvents,
  markNotificationRead,
  upsertShipmentFacilityMapping,
} from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { SignJWT } from "jose";

const runWorker = promisify(execFile);

const mappingInput = z.object({
  shipmentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  facilityId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  sourceRegistry: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainKey: z.number().int().positive().default(1),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  walletAuth: router({
    verifySignature: publicProcedure.input(z.object({ address: z.string(), message: z.string().min(1).max(1000), signature: z.string().min(1) })).mutation(async ({ input }) => {
      const timestampMatch = input.message.match(/Timestamp:\s*(.+)/);
      const timestamp = timestampMatch?.[1] ? Date.parse(timestampMatch[1].trim()) : NaN;
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) throw new Error("Wallet signature has expired. Please sign a fresh message.");
      const recovered = getAddress(verifyMessage(input.message, input.signature));
      if (recovered !== getAddress(input.address)) throw new Error("Wallet signature does not match the connected address.");
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET is not configured on the API.");
      const token = await new SignJWT({ address: recovered.toLowerCase() })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(new TextEncoder().encode(secret));
      return { verified: true, address: recovered, token } as const;
    }),
  }),
  cargoProof: router({
    mappings: publicProcedure.query(() => listShipmentFacilityMappings()),
    // Testnet facility creation is already authorized by the on-chain
    // transaction; persist its worker mapping without requiring OAuth.
    upsertMapping: publicProcedure.input(mappingInput).mutation(({ input }) => upsertShipmentFacilityMapping(input)),
    workerEvents: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(({ input }) => listWorkerEvents(input?.limit ?? 50)),
    notifications: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(({ input }) => listNotifications(input?.limit ?? 50)),
    markNotificationRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => markNotificationRead(input.id)),
    createNotification: protectedProcedure.input(z.object({ type: z.enum(["PROOF_FAILED", "RETRY_QUEUE", "RELEASED"]), severity: z.enum(["INFO", "WARNING", "ERROR"]), title: z.string().min(1).max(180), message: z.string().min(1), dedupeKey: z.string().min(1).max(180) })).mutation(({ input }) => createNotification(input)),
    // Testnet operation: the worker is idempotent and this action is exposed
    // without OAuth so operators can recover failed indexing from the dashboard.
    retryWorker: publicProcedure.mutation(async () => {
      const workerPath = path.join(process.cwd(), "workers", "milestone-worker.mjs");
      try {
        const result = await runWorker(process.execPath, [workerPath, "--once"], { env: process.env, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
        return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
      } catch (error) {
        const detail = error as Error & { stdout?: string; stderr?: string };
        return { ok: false, output: [detail.message, detail.stdout, detail.stderr].filter(Boolean).join("\n") };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
