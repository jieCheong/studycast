import { Pool } from "pg";
import dotenv from "dotenv";
import { logger } from "./lib/logger";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ?{
        rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
    logger.error({ err }, "Unexpected error on idle Postgres client");
});