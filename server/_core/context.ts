import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { jwtVerify } from "jose";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Wallet sign-in uses a short-lived local JWT when the OAuth session is not
    // available (for example, a standalone Railway/Vercel deployment).
    const authHeader = opts.req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      try {
        const secret = process.env.JWT_SECRET;
        if (secret) {
          const { payload } = await jwtVerify(authHeader.slice(7), new TextEncoder().encode(secret));
          const address = typeof payload.address === "string" ? payload.address : "";
          if (address) {
            const now = new Date();
            user = { id: -1, openId: `wallet:${address.toLowerCase()}`, name: address, email: null, loginMethod: "wallet", role: "user", createdAt: now, updatedAt: now, lastSignedIn: now };
          }
        }
      } catch {
        user = null;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
