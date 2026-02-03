import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { q } from "../db.js";
import { sendEmail, welcomeEmailTemplate } from "../utils/email.js";
import { auth } from "../middleware/auth.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function makeAuthRouter() {
  const authRouter = express.Router();

  // ✅ ME (required by frontend to check session)
  // GET /api/auth/me
  authRouter.get("/me", auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const found = await q(
        "SELECT id, email, username, must_change_password FROM users WHERE id=$1",
        [userId]
      );

      if (found.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const u = found.rows[0];

      return res.json({
        ok: true,
        user: { id: u.id, email: u.email, username: u.username },
        mustChangePassword: u.must_change_password
      });
    } catch (e) {
      return res.status(500).json({ error: "Failed to load user" });
    }
  });

  // SIGNUP
  authRouter.post("/signup", async (req, res) => {
    const { email, password, username, preferences } = req.body || {};

    if (!email || !password || !username) {
      return res.status(400).json({ error: "Email, password, and username are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const exists = await q("SELECT id FROM users WHERE email=$1", [email]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await q(
      `INSERT INTO users(email, password_hash, username, must_change_password)
       VALUES($1,$2,$3,FALSE)
       RETURNING id, email, username, must_change_password`,
      [email, passwordHash, username]
    );

    const user = created.rows[0];

    // Save preferences (optional)
    if (Array.isArray(preferences) && preferences.length > 0) {
      for (const p of preferences) {
        await q("INSERT INTO user_preferences(user_id, preference) VALUES($1,$2)", [user.id, p]);
      }
    }

    // Welcome email
    try {
      await sendEmail({
        to: user.email,
        subject: "Welcome to Travel Buddy",
        html: welcomeEmailTemplate({ username: user.username, preferences: preferences || [] })
      });
    } catch (e) {
      console.error("Welcome email failed:", e?.message || e);
    }

    const token = signToken(user.id);

    return res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username },
      mustChangePassword: user.must_change_password
    });
  });

  // LOGIN
  authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const found = await q(
      "SELECT id, email, username, password_hash, must_change_password FROM users WHERE email=$1",
      [email]
    );

    if (found.rows.length === 0) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const u = found.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = signToken(u.id);

    return res.json({
      token,
      user: { id: u.id, email: u.email, username: u.username },
      mustChangePassword: u.must_change_password
    });
  });

  // FORGOT PASSWORD (reset to KR134)
  authRouter.post("/forgot-password", async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Always respond ok (prevents account enumeration)
    const found = await q("SELECT id, email, username FROM users WHERE email=$1", [email]);

    if (found.rows.length === 0) {
      return res.json({ ok: true, message: "If the email exists, a reset email was sent." });
    }

    const user = found.rows[0];

    const TEMP_PASSWORD = "KR134";
    const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);

    await q(
      "UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2",
      [passwordHash, user.id]
    );

    // Reset email
    try {
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 10px 0;">Password reset</h2>
          <p style="margin:0 0 10px 0;">Hello <b>${user.username}</b>,</p>
          <p style="margin:0 0 12px 0;color:#374151;">
            Use the temporary password below to sign in. You’ll be prompted to create a new password immediately after login.
          </p>
          <div style="display:inline-block;padding:10px 14px;border-radius:12px;border:1px solid #e5e7eb;font-size:16px;font-weight:700;">
            ${TEMP_PASSWORD}
          </div>
        </div>
      `;

      await sendEmail({
        to: user.email,
        subject: "Travel Buddy — Password reset",
        html
      });
    } catch (e) {
      console.error("Forgot-password email failed:", e?.message || e);
    }

    return res.json({ ok: true, message: "If the email exists, a reset email was sent." });
  });

  return authRouter;
}