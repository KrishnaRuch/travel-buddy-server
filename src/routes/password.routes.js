import express from "express";
import bcrypt from "bcryptjs";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";

export function makePasswordRouter() {
  const router = express.Router();

  // User must be logged in to set a new password
  router.post("/change-password", auth, async (req, res) => {
    const userId = req.user.userId;
    const { newPassword } = req.body || {};

    if (!newPassword) return res.status(400).json({ error: "New password is required" });
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await q(
      "UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2",
      [hash, userId]
    );

    return res.json({ ok: true });
  });

  return router;
}