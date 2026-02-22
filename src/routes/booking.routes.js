import express from "express";
import { z } from "zod";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";
import { sendEmail, bookingEmailTemplate } from "../utils/email.js";
import { insertEvent } from "../utils/googleCalendar.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

export const bookingRouter = express.Router();

/**
 * Build a public base URL for links in emails.
 * - Prefer SERVER_URL from .env (recommended)
 * - Otherwise fall back to localhost dev
 */
function getServerBaseUrl(req) {
  if (process.env.SERVER_URL) return process.env.SERVER_URL.replace(/\/$/, "");

  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host =
    (req.headers["x-forwarded-host"] || req.headers.host || "travel-buddy-server-9zqk.onrender.com")
      .split(",")[0]
      .trim();

  return `${proto}://${host}`;
}

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  return s === "fr" || s.startsWith("fr") ? "fr" : "en";
}

/**
 * Hotel link: booking.com search URL with prefilled dates and pax
 */
function buildHotelLink(details) {
  const ss = encodeURIComponent(details.hotelNameOrArea || "Mauritius");
  const checkin = details.checkIn;
  const checkout = details.checkOut;
  const adults = Number(details.adults || 1);
  const children = Number(details.children || 0);
  const rooms = Number(details.rooms || 1);

  const params = new URLSearchParams({
    ss,
    checkin,
    checkout,
    group_adults: String(adults),
    group_children: String(children),
    no_rooms: String(rooms)
  });

  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/**
 * ✅ Taxi LINK (clickable): WhatsApp chat with a clean, readable message.
 * Company WhatsApp: +230 57223280
 */
function buildTaxiWhatsAppLink(details, lang = "en") {
  const whatsappNumber = "23057223280";

  const pickup = details.pickupLocation || "";
  const dropoff = details.dropoffLocation || "";
  const date = details.pickupDate || "";
  const time = details.pickupTime || "";
  const pax = details.passengers ?? "";
  const luggage = details.luggage || "";
  const notes = details.notes || "";

  const isFr = lang === "fr";

  // ✅ Build a human-readable message with real new lines, then encode ONCE.
  const lines = [
    isFr ? "Bonjour MoKabb," : "Hello MoKabb,",
    "",
    isFr
      ? "Je souhaite réserver un taxi avec les détails suivants :"
      : "I would like to book a taxi with the following details:",
    "",
    `${isFr ? "Prise en charge" : "Pickup"}: ${pickup}`,
    `${isFr ? "Destination" : "Dropoff"}: ${dropoff}`,
    `${isFr ? "Date" : "Date"}: ${date}`,
    `${isFr ? "Heure" : "Time"}: ${time}`,
    `${isFr ? "Passagers" : "Passengers"}: ${pax}`
  ];

  if (luggage) lines.push(`${isFr ? "Bagages" : "Luggage"}: ${luggage}`);
  if (notes) lines.push(`${isFr ? "Remarques" : "Notes"}: ${notes}`);

  lines.push("");
  lines.push(isFr ? "Merci." : "Thank you.");

  const message = lines.join("\n");
  const encoded = encodeURIComponent(message);

  // ✅ wa.me format
  return `https://wa.me/${whatsappNumber}?text=${encoded}`;
}

/**
 * ✅ Taxi QR target: Google Maps directions (pickup -> dropoff)
 */
function buildTaxiMapsDirectionsLink(details) {
  const origin = details.pickupLocation || "Mauritius";
  const destination = details.dropoffLocation || "Mauritius";

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving"
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Create QR image file for a given URL.
 * Saved under server/uploads/qr/booking-<id>.png
 */
async function generateQrPng({ bookingId, url }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const qrDir = path.join(__dirname, "..", "..", "uploads", "qr");
  fs.mkdirSync(qrDir, { recursive: true });

  const filename = `booking-${bookingId}.png`;
  const filePath = path.join(qrDir, filename);

  await QRCode.toFile(filePath, url, { width: 512, margin: 2 });

  return { filePath, filename };
}

// -------------------------
// Validation (Zod)
// -------------------------
const hotelSchema = z.object({
  type: z.literal("hotel"),
  hotelNameOrArea: z.string().min(2),
  checkIn: z.string().min(4),
  checkOut: z.string().min(4),
  rooms: z.coerce.number().int().min(1),
  adults: z.coerce.number().int().min(1),
  children: z.coerce.number().int().min(0),
  budgetMUR: z.coerce.number().int().min(0),
  specialRequests: z.string().optional().default("")
});

// ✅ allow optional lang from client (so WhatsApp message is EN/FR correctly)
const taxiSchema = z.object({
  type: z.literal("taxi"),
  pickupLocation: z.string().min(2),
  dropoffLocation: z.string().min(2),
  pickupDate: z.string().min(4),
  pickupTime: z.string().min(3),
  passengers: z.coerce.number().int().min(1),
  luggage: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  lang: z.string().optional().default("en")
});

// -------------------------
// POST /api/bookings
// -------------------------
bookingRouter.post("/", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const raw = req.body || {};

    const data =
      raw.type === "hotel"
        ? hotelSchema.parse(raw)
        : raw.type === "taxi"
        ? taxiSchema.parse(raw)
        : null;

    if (!data) return res.status(400).json({ error: "Invalid booking type" });

    // normalize lang (only matters for taxi WhatsApp message)
    const L = normalizeLang(data.lang);

    // Insert booking first (without external link for now)
    const inserted = await q(
      `INSERT INTO bookings(user_id, type, details, external_link)
       VALUES($1,$2,$3,$4)
       RETURNING id, type, details, external_link, created_at`,
      [userId, data.type, data, null]
    );

    const booking = inserted.rows[0];

    // ✅ Build link(s)
    // - external link (clickable) = WhatsApp (for taxi)
    // - QR link (scannable) = Google Maps directions (for taxi)
    let externalLink = "";
    let qrTargetLink = "";

    if (data.type === "hotel") {
      externalLink = buildHotelLink(data);
      qrTargetLink = externalLink; // hotel QR opens booking.com search
    } else {
      externalLink = buildTaxiWhatsAppLink(data, L);
      qrTargetLink = buildTaxiMapsDirectionsLink(data); // QR always maps directions
    }

    // Save external link to DB (this is the button link)
    const updated = await q(
      "UPDATE bookings SET external_link=$1 WHERE id=$2 RETURNING id, external_link",
      [externalLink, booking.id]
    );

    const finalExternalLink = updated.rows[0]?.external_link || externalLink;

    // ✅ Generate QR for the QR TARGET (maps for taxi)
    const { filename } = await generateQrPng({
      bookingId: booking.id,
      url: qrTargetLink
    });

    const serverBaseUrl = getServerBaseUrl(req);
    const qrUrl = `${serverBaseUrl}/uploads/qr/${filename}`;

    // Get user info for email
    const u = await q("SELECT email, username FROM users WHERE id=$1", [userId]);
    const user = u.rows[0];

    // -------------------------
    // ✅ AUTO GOOGLE CALENDAR SYNC (never blocks booking)
    // -------------------------
    let calendar = { ok: false, reason: "not_connected" };

    try {
      const tok = await q("SELECT * FROM user_google_tokens WHERE user_id=$1", [userId]);

      if (tok.rows.length === 0) {
        calendar = { ok: false, reason: "not_connected" };
      } else {
        const tokens = tok.rows[0];

        if (!tokens.refresh_token) {
          calendar = { ok: false, reason: "missing_refresh_token" };
        } else {
          const calDetails = { ...data, qrUrl, externalLink: finalExternalLink };

          const { eventId, htmlLink } = await insertEvent({
            tokens: {
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              scope: tokens.scope,
              token_type: tokens.token_type,
              expiry_date: tokens.expiry_date
            },
            type: data.type,
            details: calDetails,
            externalLink: finalExternalLink,
            qrUrl
          });

          calendar = { ok: true, eventId, htmlLink };
        }
      }
    } catch (e) {
      calendar = { ok: false, reason: "calendar_error", error: e?.message || String(e) };
      console.error("Calendar sync failed:", e?.message || e);
    }

    // -------------------------
    // Send confirmation email
    // -------------------------
    let emailOk = true;
    let emailError = null;

    try {
      await sendEmail({
        to: user.email,
        subject:
          data.type === "hotel"
            ? "Hotel booking confirmation"
            : "Taxi booking confirmation",
        html: bookingEmailTemplate({
          username: user.username,
          bookingType: data.type,
          details: { ...data, externalLink: finalExternalLink },
          externalLink: finalExternalLink, // ✅ WhatsApp for taxi
          qrUrl // ✅ maps QR for taxi
        })
      });
    } catch (e) {
      emailOk = false;
      emailError = e?.message || String(e);
      console.error("Booking email failed:", emailError);
    }

    return res.json({
      ok: true,
      booking: {
        ...booking,
        external_link: finalExternalLink
      },
      externalLink: finalExternalLink, // ✅ WhatsApp for taxi
      qrUrl, // ✅ maps QR for taxi
      email: { ok: emailOk, error: emailError },
      calendar
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: "Validation failed", issues: err.issues });
    }
    return res.status(400).json({ error: err.message || "Booking failed" });
  }
});

// -------------------------
// GET /api/bookings/mine
// -------------------------
bookingRouter.get("/mine", auth, async (req, res) => {
  const userId = req.user.userId;
  const b = await q("SELECT * FROM bookings WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
  return res.json({ bookings: b.rows });
});