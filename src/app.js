import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { makeAuthRouter } from "./routes/auth.routes.js";
import { bookingRouter } from "./routes/booking.routes.js";
import { makeChatRouter } from "./routes/chat.routes.js";
import { makePasswordRouter } from "./routes/password.routes.js";
import { makeGoogleRouter } from "./routes/google.routes.js"; // ✅ NEW

dotenv.config();

export function createApp(intents) {
  const app = express();

  // -------------------------
  // CORS (allow localhost + 127 so dev never randomly breaks)
  // -------------------------
  const allowedOrigins = [
    process.env.CLIENT_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked for origin: ${origin}`));
      },
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true
    })
  );

  app.options("*", cors());

  // -------------------------
  // Body / cookies
  // -------------------------
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // -------------------------
  // Static files (QR uploads)
  // -------------------------
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  // -------------------------
  // Health route
  // -------------------------
  app.get("/", (req, res) => res.json({ ok: true, name: "Travel Buddy API" }));

  // -------------------------
  // Routes
  // -------------------------
  app.use("/api/auth", makeAuthRouter());
  app.use("/api/auth", makePasswordRouter());
  app.use("/api/chat", makeChatRouter(intents));
  app.use("/api/bookings", bookingRouter);

  // ✅ NEW: Google Calendar connect + callback + status
  app.use("/api/google", makeGoogleRouter());

  // -------------------------
  // Fallback 404 (nice for debugging)
  // -------------------------
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}