// server/src/app.js

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
import { makeGoogleRouter } from "./routes/google.routes.js";

import { makeRecommendationsRouter } from "./routes/recommendations.routes.js";
import { makeSupportRouter } from "./routes/support.routes.js";

dotenv.config();

export function createApp(intents) {
  const app = express();

  // -------------------------
  // CORS
  // -------------------------
  const allowedOrigins = [
    process.env.CLIENT_URL,
    "https://travel-buddy-kr134.vercel.app",
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
  app.use(express.urlencoded({ extended: true }));
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

  app.use("/api/google", makeGoogleRouter());

  // ✅ New features
  app.use("/api/recommendations", makeRecommendationsRouter());
  app.use("/api/support", makeSupportRouter());

  // -------------------------
  // Fallback 404
  // -------------------------
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}