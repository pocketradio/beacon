import { Redis } from "ioredis";

import { getEnv } from "./env.js";

export function createRedisClient(connectionName: string): Redis {
  const env = getEnv();

  return new Redis(env.REDIS_URL, {
    connectionName,
    maxRetriesPerRequest: null
  });
}
