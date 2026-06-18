/* Using bcrypt.hash instead of plain sha-256 bc it is intentionally
slow and includes a random "salt: baked into the hash itself, which
makes brute-force and rainbow-table attacks impractical. Generic
hash functions are built for speed, which is the opposite of what I want for passwords - for security" */

import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const router = Router();

router.post("/signup", async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({error: "Email and password are required"});
    }
    if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({error: "Invalid input"});
    }
    if (password.length < 8) {
        return res.status(400).json({error: "Password must be at least 8 characters"});
    }
    const normalizedEmail = email.trim().toLowerCase();

    try {
        const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
        if (existing.rows.length > 0) {
            return res.status(409).json({error: "An account with this email already exists"});
        }

        // hash the password - 10 salt rounds is the standard default
        const passwordHash = await bcrypt.hash(password, 10);

        // insert the user
        const userResult = await pool.query(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
            [normalizedEmail, passwordHash]
        );
        const newUser = userResult.rows[0];

        // auto-create the matching profile row
        await pool.query("INSERT INTO profiles (user_id) VALUES ($1)", [newUser.id]);

        return res.status(201).json({
            id: newUser.id,
            email: newUser.email,
            createdAt: newUser.created_at,
        });
    } catch (err) {
        console.error("Signup error: ", err);
        return res.status(500).json({error: "Something went wrong creating your account"});
    }
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Something went wrong logging in" });
  }
});
router.post("/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

    // Always respond the same way, whether or not the email exists —
    // prevents attackers from using this endpoint to discover registered emails
    if (userResult.rows.length === 0) {
      return res.json({ message: "If that email is registered, a reset link has been sent." });
    }

    const userId = userResult.rows[0].id;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    await pool.query(
      "INSERT INTO reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [userId, token, expiresAt]
    );

    // No email service yet — log the link so you can test the flow manually
    console.log(`Password reset link for ${normalizedEmail}: http://localhost:5173/reset-password?token=${token}`);

    return res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot-password error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const tokenResult = await pool.query(
      "SELECT user_id, expires_at FROM reset_tokens WHERE token = $1",
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const { user_id, expires_at } = tokenResult.rows[0];

    if (new Date(expires_at) < new Date()) {
      // Clean up the expired token while we're here
      await pool.query("DELETE FROM reset_tokens WHERE token = $1", [token]);
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, user_id]);

    // Token is single-use — delete it after successful reset
    await pool.query("DELETE FROM reset_tokens WHERE token = $1", [token]);

    return res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("Reset-password error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});
export default router;