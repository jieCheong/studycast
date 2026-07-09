import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL as string;
const needsTls = redisUrl?.startsWith("rediss://") || redisUrl?.includes("upstash.io");

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: needsTls ? {} : undefined,
  connectTimeout: 10000,
  keepAlive: 30000,
  retryStrategy(times) {
    // exponential backoff, capped at 10s — prevents rapid-fire reconnect storms
    return Math.min(times * 500, 10000);
  },
});