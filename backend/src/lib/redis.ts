import dotenv from "dotenv";

dotenv.config();

const url = new URL(process.env.REDIS_URL as string);

export const redisConnection = {
  host: url.hostname,
  port: parseInt(url.port) || 6379,
  password: url.password || undefined,
  tls: url.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null as null, // required by BullMQ
};