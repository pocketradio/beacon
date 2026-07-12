// beacon api — front door for incoming notification events.
// auth with a tenant-scoped JWT, then drop the event on the delivery queue.
import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { createDeliveryQueue, getEnv } from "@beacon/shared";

const env = getEnv();
const queue = createDeliveryQueue();

interface AuthContext {
  tenantId: string;
  userId: string;
}

type AuthedRequest = Request & { auth?: AuthContext };

// what we expect to find inside a verified JWT
const tokenClaims = z.object({
  tenantId: z.uuid(),
  userId: z.uuid()
});

const eventBody = z.object({
  externalUserId: z.string().min(1),
  category: z.string().min(1),
  urgency: z.enum(["critical", "high", "normal", "low"]).default("normal"),
  title: z.string().min(1),
  body: z.string().min(1),
  dedupeKey: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    (req as AuthedRequest).auth = tokenClaims.parse(jwt.verify(token, env.JWT_SECRET));
    next();
  } catch {
    // bad signature, expired, or claims we don't recognise — all 401
    res.status(401).json({ error: "invalid token" });
  }
}

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ingest a single notification event and hand it off for delivery
app.post("/v1/events", requireAuth, async (req: Request, res: Response) => {
  const parsed = eventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload", details: z.flattenError(parsed.error) });
    return;
  }

  const auth = (req as AuthedRequest).auth;
  if (!auth) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const jobId = randomUUID();
  await queue.add(
    "deliver-immediate",
    { tenantId: auth.tenantId, ...parsed.data },
    { jobId, removeOnComplete: 1000, removeOnFail: 5000 }
  );

  res.status(202).json({ jobId, status: "queued" });
});

app.listen(env.API_PORT, () => {
  console.log(`beacon api listening on :${env.API_PORT}`);
});
