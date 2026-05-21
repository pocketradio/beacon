import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  CLASSIFIER_PORT: z.coerce.number().int().positive().default(3002),
  WS_PORT: z.coerce.number().int().positive().default(3003),
  JWT_SECRET: z.string().min(1),
  REDIS_URL: z.url(),
  DATABASE_URL: z.url()
});

export type AppEnv = z.infer<typeof envSchema>; // infer will extract static ts type from a zod schema defn

let cachedEnv: AppEnv | null = null;


export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  } 

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}
