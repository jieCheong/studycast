/* Using bcrypt.hash instead of plain sha-256 bc it is intentionally
slow and includes a random "salt: baked into the hash itself, which
makes brute-force and rainbow-table attacks impractical. Generic
hash functions are built for speed, which is the opposite of what I want for passwords - for security" */

import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db";
import jwt from "jsonwebtoken";

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
export default router;