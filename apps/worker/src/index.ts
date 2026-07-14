import { Worker, type Job } from "bullmq";
import { and, desc, eq, gt } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";

import {
  db,
  notificationLogs,
  notificationPreferences,
  tenants,
  users,
  type NewNotificationLog
} from "@beacon/db";
import {
  DELIVERY_QUEUE_NAME,
  createRedisClient,
  getEnv,
  publishPush,
  type DeliveryJobData,
  type DeliveryJobName,
  type PushMessage
} from "@beacon/shared";

const env = getEnv();
const redis = createRedisClient("worker-commands");
const publisher = createRedisClient("worker-publisher");

const mailer: Transporter | null = env.SMTP_URL
  ? nodemailer.createTransport(env.SMTP_URL)
  : null;

const DIGEST_PENDING = "beacon:digest:pending";


async function writeLog(entry: NewNotificationLog): Promise<void> {
  await db.insert(notificationLogs).values(entry);
}


async function findUser(tenantId: string, externalUserId: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.externalUserId, externalUserId)))
    .limit(1);
  return row ?? null;
}


async function loadPreference(tenantId: string, userId: string, category: string) {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.category, category)
      )
    )
    .limit(1);
  return row ?? null;
}


// dedup
async function isDuplicate(tenantId: string, dedupeKey: string | undefined): Promise<boolean> {
  if (!dedupeKey) return false;
  const fresh = await redis.set(`beacon:dedup:${tenantId}:${dedupeKey}`, "1", "EX", 3600, "NX");
  return fresh === null;
}


// per-tenant window
async function overRateLimit(tenantId: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60000);
  const key = `beacon:rl:${tenantId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);

  const [row] = await db
    .select({ limit: tenants.rateLimitPerMinute })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const limit = row?.limit ?? 600;
  return count > limit;
}


async function inCooldown(userId: string, category: string, cooldownSecs: number): Promise<boolean> {
  const since = new Date(Date.now() - cooldownSecs * 1000);
  const [recent] = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.userId, userId),
        eq(notificationLogs.category, category),
        eq(notificationLogs.status, "delivered"),
        gt(notificationLogs.createdAt, since)
      )
    )
    .orderBy(desc(notificationLogs.createdAt))
    .limit(1);
  return recent != null;
}


async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  // dev fallback
  if (!mailer) {
    console.log(`[email:dev] to=${to} subject="${subject}"`);
    return;
  }
  await mailer.sendMail({ from: env.EMAIL_FROM, to, subject, text: body });
}


async function deliver(
  email: string | null,
  channel: "email" | "push" | "both",
  message: PushMessage
): Promise<void> {
  if ((channel === "email" || channel === "both") && email) {
    await sendEmail(email, message.title, message.body);
  }
  if (channel === "push" || channel === "both") {
    await publishPush(publisher, message);
  }
}


// batch low urgency
async function queueForDigest(tenantId: string, userId: string, category: string): Promise<void> {
  const member = `${tenantId}|${userId}|${category}`;
  await redis.sadd(DIGEST_PENDING, member);
  await redis.incr(`beacon:digest:count:${member}`);
}


async function process(job: Job<DeliveryJobData, void, DeliveryJobName>): Promise<void> {
  const { tenantId, externalUserId, category, urgency, title, body } = job.data;

  const user = await findUser(tenantId, externalUserId);
  if (!user) {
    console.warn(`no user for ${externalUserId} in tenant ${tenantId}, skipping`);
    return;
  }

  const base = { tenantId, userId: user.id, category, jobType: job.name, urgency } as const;
  const pref = await loadPreference(tenantId, user.id, category);
  const channel = pref?.channel ?? "both";

  if (await isDuplicate(tenantId, job.data.dedupeKey)) {
    await writeLog({ ...base, channel, status: "duplicate" });
    return;
  }

  if (pref?.isOptedOut) {
    await writeLog({ ...base, channel, status: "opted_out" });
    return;
  }

  // critical bypasses
  if (urgency !== "critical" && (await overRateLimit(tenantId))) {
    await writeLog({ ...base, channel, status: "rate_limited" });
    return;
  }

  const cooldown = pref?.cooldownSecs ?? 300;
  if (urgency !== "critical" && (await inCooldown(user.id, category, cooldown))) {
    await writeLog({ ...base, channel, status: "rate_limited" });
    return;
  }

  if (urgency === "low") {
    await queueForDigest(tenantId, user.id, category);
    await writeLog({ ...base, jobType: "deliver-digest", channel, status: "queued" });
    return;
  }

  await deliver(user.email, channel, { tenantId, userId: user.id, category, urgency, title, body });
  await writeLog({ ...base, channel, status: "delivered", deliveredAt: new Date() });
}


// flush per minute
async function flushDigests(): Promise<void> {
  const members = await redis.smembers(DIGEST_PENDING);
  for (const member of members) {
    const [tenantId, userId, category] = member.split("|");
    if (!tenantId || !userId || !category) continue;

    const countRaw = await redis.get(`beacon:digest:count:${member}`);
    await redis.srem(DIGEST_PENDING, member);
    await redis.del(`beacon:digest:count:${member}`);

    const count = countRaw ? Number(countRaw) : 0;
    if (count === 0) continue;

    const pref = await loadPreference(tenantId, userId, category);
    const channel = pref?.channel ?? "both";
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    const title = `${count} new ${category} updates`;
    const body = `You have ${count} pending ${category} notifications.`;
    await deliver(u?.email ?? null, channel, {
      tenantId,
      userId,
      category,
      urgency: "low",
      title,
      body
    });

    await writeLog({
      tenantId,
      userId,
      category,
      jobType: "deliver-digest",
      channel,
      status: "delivered",
      urgency: "low",
      eventCount: count,
      deliveredAt: new Date()
    });
  }
}


const worker = new Worker<DeliveryJobData, void, DeliveryJobName>(
  DELIVERY_QUEUE_NAME,
  process,
  { connection: createRedisClient("delivery-worker") }
);

worker.on("failed", (job, err) => {
  console.error(`job ${job?.id} failed: ${err.message}`);
});

setInterval(() => {
  void flushDigests();
}, 60_000);

console.log(`beacon worker draining ${DELIVERY_QUEUE_NAME} (env: ${env.NODE_ENV})`);
