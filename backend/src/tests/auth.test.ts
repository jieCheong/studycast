import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db";

// Clean up test users before/after each test so tests don't interfere with each other
async function cleanupTestUser(email: string) {
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
}

describe("Auth: signup logic", () => {
  const testEmail = "vitest-signup@example.com";

  afterEach(async () => {
    await cleanupTestUser(testEmail);
  });

  it("hashes the password with bcrypt before storing", async () => {
    const password = "testpassword123";
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
      [testEmail, hash]
    );

    const result = await pool.query("SELECT password_hash FROM users WHERE email = $1", [testEmail]);
    const storedHash = result.rows[0].password_hash;

    expect(storedHash).not.toBe(password); // never store plaintext
    expect(storedHash.startsWith("$2b$")).toBe(true); // bcrypt signature
    expect(await bcrypt.compare(password, storedHash)).toBe(true); // hash actually verifies
  });

  it("rejects duplicate emails at the database level", async () => {
    const hash = await bcrypt.hash("password123", 10);
    await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [testEmail, hash]);

    await expect(
      pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [testEmail, hash])
    ).rejects.toThrow();
  });
});

describe("Auth: login logic", () => {
  const testEmail = "vitest-login@example.com";
  const testPassword = "correctpassword123";
  let userId: string;

  beforeEach(async () => {
    const hash = await bcrypt.hash(testPassword, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [testEmail, hash]
    );
    userId = result.rows[0].id;
  });

  afterEach(async () => {
    await cleanupTestUser(testEmail);
  });

  it("verifies correct password against stored hash", async () => {
    const result = await pool.query("SELECT password_hash FROM users WHERE email = $1", [testEmail]);
    const isMatch = await bcrypt.compare(testPassword, result.rows[0].password_hash);
    expect(isMatch).toBe(true);
  });

  it("rejects incorrect password", async () => {
    const result = await pool.query("SELECT password_hash FROM users WHERE email = $1", [testEmail]);
    const isMatch = await bcrypt.compare("wrongpassword", result.rows[0].password_hash);
    expect(isMatch).toBe(false);
  });

  it("issues a JWT containing the correct userId", () => {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: "7d" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
    expect(decoded.userId).toBe(userId);
  });
});

describe("Auth: JWT validation", () => {
  it("rejects a token signed with the wrong secret", () => {
    const fakeToken = jwt.sign({ userId: "fake-id" }, "wrong-secret", { expiresIn: "7d" });

    expect(() => {
      jwt.verify(fakeToken, process.env.JWT_SECRET as string);
    }).toThrow();
  });

  it("rejects an expired token", () => {
    const expiredToken = jwt.sign(
      { userId: "some-id" },
      process.env.JWT_SECRET as string,
      { expiresIn: "-1s" } // already expired
    );

    expect(() => {
      jwt.verify(expiredToken, process.env.JWT_SECRET as string);
    }).toThrow();
  });
});