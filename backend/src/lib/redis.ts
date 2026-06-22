import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL as string;
const needsTls = redisUrl?.startsWith("rediss://") || redisUrl?.includes("upstash.io");

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: needsTls ? {} : undefined,
});
