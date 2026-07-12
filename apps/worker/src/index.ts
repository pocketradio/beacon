// beacon worker — drains the delivery queue and actually sends notifications.
// applies per-user preferences (opt-out + cooldown), then records the outcome.
import { Worker, type Job } from "bullmq";
import { and, desc, eq, gt } from "drizzle-orm";

import {
  db,
  notificationLogs,
  notificationPreferences,
  users
} from "@beacon/db";
import {
  DELIVERY_QUEUE_NAME,
  createRedisClient,
  getEnv,
  type DeliveryJobData,
  type DeliveryJobName
} from "@beacon/shared";

const env = getEnv();

// resolve the internal user for a tenant's external id
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

// was this user already notified for this category inside the cooldown window?
async function inCooldown(userId: string, category: string, cooldownSecs: number) {
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

async function process(job: Job<DeliveryJobData, void, DeliveryJobName>): Promise<void> {
  const { tenantId, externalUserId, category, urgency, title } = job.data;

  const user = await findUser(tenantId, externalUserId);
  if (!user) {
    // nothing we can attribute a log row to — drop it
    console.warn(`no user for ${externalUserId} in tenant ${tenantId}, skipping`);
    return;
  }

  const pref = await loadPreference(tenantId, user.id, category);
  const channel = pref?.channel ?? "both";

  if (pref?.isOptedOut) {
    await db.insert(notificationLogs).values({
      tenantId,
      userId: user.id,
      category,
      jobType: job.name,
      channel,
      status: "opted_out",
      urgency
    });
    return;
  }

  const cooldown = pref?.cooldownSecs ?? 300;
  if (urgency !== "critical" && (await inCooldown(user.id, category, cooldown))) {
    await db.insert(notificationLogs).values({
      tenantId,
      userId: user.id,
      category,
      jobType: job.name,
      channel,
      status: "rate_limited",
      urgency
    });
    return;
  }

  // TODO: real email/push providers. for now we just log the send.
  console.log(`delivering "${title}" to user ${user.id} via ${channel}`);

  await db.insert(notificationLogs).values({
    tenantId,
    userId: user.id,
    category,
    jobType: job.name,
    channel,
    status: "delivered",
    urgency,
    deliveredAt: new Date()
  });
}

const worker = new Worker<DeliveryJobData, void, DeliveryJobName>(
  DELIVERY_QUEUE_NAME,
  process,
  { connection: createRedisClient("delivery-worker") }
);

worker.on("failed", (job, err) => {
  console.error(`job ${job?.id} failed: ${err.message}`);
});

console.log(`beacon worker draining ${DELIVERY_QUEUE_NAME} (env: ${env.NODE_ENV})`);
