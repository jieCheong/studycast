import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const isUpstash = process.env.REDIS_URL?.includes("upstash.io");

export const redisConnection = new IORedis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
  tls: isUpstash ? {} : undefined,
});
