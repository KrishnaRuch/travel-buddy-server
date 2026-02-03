import express from "express";
import jwt from "jsonwebtoken";
import { q } from "../db.js";
import { auth } from "../middleware/auth.js";
import { buildAuthUrl, makeOAuthClient, insertEvent } from "../utils/googleCalendar.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

function signState(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

function verifyState(state) {
  return jwt.verify(state, JWT_SECRET);
}

function getClientBaseUrl() {
  return (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
}

function chatRedirectUrl(flag) {
  // ✅ Your ChatPage reads the query params, so redirect to /chat
  return `${getClientBaseUrl()}/chat?google=${flag}`;
}

export function makeGoogleRouter() {
  const router = express.Router();

  // ✅ Start OAuth: returns URL to redirect user
  // GET /api/google/auth/start
  router.get("/auth/start", auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const state = signState({ userId });
      const url = buildAuthUrl({ state });

      return res.json({ ok: true, url });
    } catch (e) {
      console.error("Google auth start failed:", e?.message || e);
      return res.status(500).json({ error: "Failed to start Google auth" });
    }
  });

  // ✅ OAuth callback from Google
  // GET /api/google/auth/callback?code=...&state=...
  router.get("/auth/callback", async (req, res) => {
    try {
      const { code, state } = req.query || {};
      if (!code || !state) {
        return res.redirect(chatRedirectUrl("error_missing_params"));
      }

      let decoded;
      try {
        decoded = verifyState(String(state));
      } catch {
        return res.redirect(chatRedirectUrl("error_bad_state"));
      }

      const userId = decoded?.userId;
      if (!userId) {
        return res.redirect(chatRedirectUrl("error_bad_state"));
      }

      const oAuth2Client = makeOAuthClient();
      const { tokens } = await oAuth2Client.getToken(String(code));

      // Save tokens (keep refresh token if Google doesn't re-send it)
      await q(
        `
        INSERT INTO user_google_tokens(user_id, access_token, refresh_token, scope, token_type, expiry_date)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id)
        DO UPDATE SET
          access_token=EXCLUDED.access_token,
          refresh_token=COALESCE(EXCLUDED.refresh_token, user_google_tokens.refresh_token),
          scope=EXCLUDED.scope,
          token_type=EXCLUDED.token_type,
          expiry_date=EXCLUDED.expiry_date
        `,
        [
          userId,
          tokens.access_token || null,
          tokens.refresh_token || null,
          tokens.scope || null,
          tokens.token_type || null,
          tokens.expiry_date || null
        ]
      );

      return res.redirect(chatRedirectUrl("connected"));
    } catch (e) {
      console.error("Google callback failed:", e?.message || e);
      return res.redirect(chatRedirectUrl("error_callback"));
    }
  });

  // ✅ Status
  // GET /api/google/status
  router.get("/status", auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const r = await q(
        "SELECT user_id, refresh_token FROM user_google_tokens WHERE user_id=$1",
        [userId]
      );

      const connected = r.rows.length > 0;
      const hasRefresh = !!r.rows[0]?.refresh_token;

      return res.json({ ok: true, connected, hasRefreshToken: hasRefresh });
    } catch (e) {
      return res.status(500).json({ error: "Failed to read Google status" });
    }
  });

  // ✅ Disconnect
  // POST /api/google/disconnect
  router.post("/disconnect", auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      await q("DELETE FROM user_google_tokens WHERE user_id=$1", [userId]);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Failed to disconnect Google" });
    }
  });

  // ✅ Sync booking -> Google Calendar
  // POST /api/google/calendar/sync
  router.post("/calendar/sync", auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const { type, details, externalLink } = req.body || {};
      if (!type || !details) {
        return res.status(400).json({ error: "Missing type/details" });
      }

      const tok = await q("SELECT * FROM user_google_tokens WHERE user_id=$1", [userId]);
      if (tok.rows.length === 0) {
        return res.status(400).json({ error: "Google Calendar not connected" });
      }

      const tokens = tok.rows[0];

      if (!tokens.refresh_token) {
        return res.status(400).json({
          error: "Missing refresh token. Please disconnect and connect Google Calendar again."
        });
      }

      const { eventId, htmlLink } = await insertEvent({
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date
        },
        type,
        details,
        externalLink
      });

      return res.json({ ok: true, eventId, htmlLink });
    } catch (e) {
      console.error("Calendar sync failed:", e?.message || e);
      return res.status(500).json({ error: "Failed to sync calendar event" });
    }
  });

  return router;
}