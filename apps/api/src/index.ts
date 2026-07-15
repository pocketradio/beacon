import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { db, notificationPreferences } from "@beacon/db";
import { createDeliveryQueue, getEnv, type Urgency } from "@beacon/shared";

const URGENCIES: readonly Urgency[] = ["critical", "high", "normal", "low"];


function isUrgency(value: unknown): value is Urgency {
  return typeof value === "string" && (URGENCIES as readonly string[]).includes(value);
}

const env = getEnv();
const queue = createDeliveryQueue();

const classifierUrl = `http://localhost:${env.CLASSIFIER_PORT}/classify`;


// urgency, with fallback
async function resolveUrgency(event: {
  category: string;
  title: string;
  body: string;
  hint: Urgency;
}): Promise<Urgency> {
  try {
    const res = await fetch(classifierUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
    if (!res.ok) return event.hint;
    const data = (await res.json()) as { urgency?: unknown };
    return isUrgency(data.urgency) ? data.urgency : event.hint;
  } catch {
    return event.hint;
  }
}

interface AuthContext {
  tenantId: string;
  userId: string;
}

type AuthedRequest = Request & { auth?: AuthContext };

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

const preferenceBody = z.object({
  category: z.string().min(1),
  channel: z.enum(["email", "push", "both"]).default("both"),
  cooldownSecs: z.number().int().min(0).default(300),
  isOptedOut: z.boolean().default(false)
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
    res.status(401).json({ error: "invalid token" });
  }
}

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

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

  const urgency = await resolveUrgency({
    category: parsed.data.category,
    title: parsed.data.title,
    body: parsed.data.body,
    hint: parsed.data.urgency
  });

  // tenant from token
  const jobId = randomUUID();
  await queue.add(
    "deliver-immediate",
    { tenantId: auth.tenantId, ...parsed.data, urgency },
    { jobId, removeOnComplete: 1000, removeOnFail: 5000 }
  );

  res.status(202).json({ jobId, status: "queued" });
});

app.post("/v1/preferences", requireAuth, async (req: Request, res: Response) => {
  const parsed = preferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload", details: z.flattenError(parsed.error) });
    return;
  }

  const auth = (req as AuthedRequest).auth;
  if (!auth) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  await db
    .insert(notificationPreferences)
    .values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      ...parsed.data
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.tenantId,
        notificationPreferences.userId,
        notificationPreferences.category
      ],
      set: {
        channel: parsed.data.channel,
        cooldownSecs: parsed.data.cooldownSecs,
        isOptedOut: parsed.data.isOptedOut,
        updatedAt: new Date()
      }
    });

  res.json({ status: "saved" });
});

app.listen(env.API_PORT, () => {
  console.log(`beacon api listening on :${env.API_PORT}`);
});
