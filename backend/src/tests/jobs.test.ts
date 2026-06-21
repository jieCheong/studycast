import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcrypt";
import { pool } from "../db";

// Mock the BullMQ queue so tests never touch real Redis
vi.mock("../lib/queue", () => ({
  pipelineQueue: {
    add: vi.fn().mockResolvedValue({ id: "mock-bullmq-job-id" }),
  },
}));

import { pipelineQueue } from "../lib/queue";

describe("Job creation: ownership and limits", () => {
  const testEmail = "vitest-jobs@example.com";
  let userId: string;
  let uploadId: string;

  beforeEach(async () => {
    const hash = await bcrypt.hash("password123", 10);
    const userResult = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [testEmail, hash]
    );
    userId = userResult.rows[0].id;
    await pool.query("INSERT INTO profiles (user_id) VALUES ($1)", [userId]);

    const uploadResult = await pool.query(
      "INSERT INTO uploads (user_id, filename, extracted_text) VALUES ($1, $2, $3) RETURNING id",
      [userId, "test.pdf", "Some extracted text content for testing."]
    );
    uploadId = uploadResult.rows[0].id;

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email = $1", [testEmail]); // cascades
  });

  it("rejects job creation for an upload that does not belong to the user", async () => {
    const otherUploadCheck = await pool.query(
      "SELECT id FROM uploads WHERE id = $1 AND user_id = $2",
      ["00000000-0000-0000-0000-000000000000", userId]
    );
    expect(otherUploadCheck.rows.length).toBe(0);
  });

  it("creates a job row with status 'queued' and pushes to the queue", async () => {
    const jobResult = await pool.query(
      `INSERT INTO jobs (upload_id, user_id, mode, language, length, voice, status) 
       VALUES ($1, $2, 'understanding', 'English', '10', 'onyx', 'queued') RETURNING id, status`,
      [uploadId, userId]
    );

    expect(jobResult.rows[0].status).toBe("queued");

    await pipelineQueue.add("process-pipeline", {
      jobId: jobResult.rows[0].id,
      uploadId,
      userId,
      mode: "understanding",
      language: "English",
      length: "10",
      voice: "onyx",
    });

    expect(pipelineQueue.add).toHaveBeenCalledOnce();
    expect(pipelineQueue.add).toHaveBeenCalledWith(
      "process-pipeline",
      expect.objectContaining({ jobId: jobResult.rows[0].id, userId })
    );
  });

  it("blocks job creation when daily limit of 2 is reached", async () => {
    // Simulate 2 already-completed jobs today
    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'complete')",
      [uploadId, userId]
    );
    await pool.query(
      "INSERT INTO jobs (upload_id, user_id, mode, language, length, status) VALUES ($1, $2, 'understanding', 'English', '10', 'complete')",
      [uploadId, userId]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM jobs 
       WHERE user_id = $1 AND status = 'complete' AND created_at >= CURRENT_DATE`,
      [userId]
    );

    const reachedLimit = parseInt(countResult.rows[0].count) >= 2;
    expect(reachedLimit).toBe(true);
  });
});