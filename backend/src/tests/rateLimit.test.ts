import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";
import { pool } from "../db";

describe("Daily generation limit query", () => {
  const testEmail = "vitest-ratelimit@example.com";
  let userId: string;

  beforeEach(async () => {
    const hash = await bcrypt.hash("password123", 10);
    const userResult = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [testEmail, hash]
    );
    userId = userResult.rows[0].id;
    await pool.query("INSERT INTO profiles (user_id) VALUES ($1)", [userId]);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email = $1", [testEmail]); // cascades to jobs/profiles
  });

  it("counts zero completed jobs for a brand new user", async () => {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM jobs 
       WHERE user_id = $1 AND status = 'complete' AND created_at >= CURRENT_DATE`,
      [userId]
    );
    expect(parseInt(result.rows[0].count)).toBe(0);
  });

  it("counts only today's completed jobs, ignoring other statuses", async () => {
    // Insert a fake upload + 3 jobs: 2 complete, 1 still queued
    const uploadResult = await pool.query(
      "INSERT INTO uploads (user_id, filename) VALUES ($1, $2) RETURNING id",
      [userId, "test.pdf"]
    );
    const uploadId = uploadResult.rows[0].id;

    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'complete')",
      [uploadId, userId]
    );
    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'complete')",
      [uploadId, userId]
    );
    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'queued')",
      [uploadId, userId]
    );

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM jobs 
       WHERE user_id = $1 AND status = 'complete' AND created_at >= CURRENT_DATE`,
      [userId]
    );

    expect(parseInt(result.rows[0].count)).toBe(2); // only the 2 complete ones count
  });

  it("does not count another user's completed jobs", async () => {
    const otherHash = await bcrypt.hash("password123", 10);
    const otherUserResult = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      ["vitest-otheruser@example.com", otherHash]
    );
    const otherUserId = otherUserResult.rows[0].id;

    const uploadResult = await pool.query(
      "INSERT INTO uploads (user_id, filename) VALUES ($1, $2) RETURNING id",
      [otherUserId, "other.pdf"]
    );
    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'complete')",
      [uploadResult.rows[0].id, otherUserId]
    );

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM jobs 
       WHERE user_id = $1 AND status = 'complete' AND created_at >= CURRENT_DATE`,
      [userId]
    );

    expect(parseInt(result.rows[0].count)).toBe(0); // other user's job shouldn't count

    await pool.query("DELETE FROM users WHERE id = $1", [otherUserId]); // cleanup
  });
});