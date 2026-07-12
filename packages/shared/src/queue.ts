import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { createRedisClient } from "./redis.js";

export const DELIVERY_QUEUE_NAME = "beacon:delivery";

export type DeliveryJobName = "deliver-immediate" | "deliver-digest";

export type Urgency = "critical" | "high" | "normal" | "low";

export interface DeliveryJobData {
  tenantId: string;
  externalUserId: string;
  category: string;
  urgency: Urgency;
  title: string;
  body: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

export function createDeliveryQueue(connection?: Redis): Queue<DeliveryJobData> {
  return new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
    connection: connection ?? createRedisClient("delivery-queue")
  });
}
