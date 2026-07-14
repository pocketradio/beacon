import type { Redis } from "ioredis";

import type { Urgency } from "./queue.js";

export const PUSH_CHANNEL = "beacon:push";

export interface PushMessage {
  tenantId: string;
  userId: string;
  category: string;
  urgency: Urgency;
  title: string;
  body: string;
}

export async function publishPush(redis: Redis, message: PushMessage): Promise<void> {
  await redis.publish(PUSH_CHANNEL, JSON.stringify(message));
}
