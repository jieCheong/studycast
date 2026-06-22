import * as Sentry from "@sentry/node";
import dotenv from "dotenv";

dotenv.config();

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn("SENTRY_DSN not set — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1, // capture 10% of transactions for performance monitoring (keeps free tier usage low)
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
  });
}

export { Sentry };