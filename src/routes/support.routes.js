import express from "express";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";
// optional: email notify
import { sendEmail } from "../utils/email.js";

export function makeSupportRouter() {
  const router = express.Router();

  // POST /api/support/tickets  { message }
  router.post("/tickets", auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const message = String(req.body?.message || "").trim();

      if (!message || message.length < 5) {
        return res.status(400).json({ error: "Message is required" });
      }

      const inserted = await q(
        `INSERT INTO support_tickets(user_id, message, status)
         VALUES($1,$2,'open')
         RETURNING id, created_at`,
        [userId, message]
      );

      // Optional notify to your email (set SUPPORT_EMAIL in env)
      const supportEmail = process.env.SUPPORT_EMAIL;
      if (supportEmail) {
        sendEmail({
          to: supportEmail,
          subject: "Travel Buddy — New Support Ticket",
          html: `<p><b>User ID:</b> ${userId}</p><p><b>Message:</b><br/>${message}</p>`
        }).catch(() => {});
      }

      return res.json({ ok: true, ticket: inserted.rows[0] });
    } catch (e) {
      console.error("Support ticket error:", e?.message || e);
      return res.status(500).json({ error: "Failed to create ticket" });
    }
  });

  return router;
}