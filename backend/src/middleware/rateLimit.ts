import rateLimit from "express-rate-limit";

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  message: { error: "Too many attempts. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});