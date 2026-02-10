import { google } from "googleapis";

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}

/**
 * Build SERVER base URL for OAuth redirect URI.
 * Priority:
 * 1) SERVER_URL env (recommended in prod)
 * 2) x-forwarded-* headers (Render proxy)
 * 3) localhost dev fallback
 */
function getServerBaseUrl(req) {
  if (process.env.SERVER_URL) return String(process.env.SERVER_URL).replace(/\/$/, "");

  const proto = String(req?.headers?.["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim();

  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:5000")
    .split(",")[0]
    .trim();

  return `${proto}://${host}`;
}

/**
 * Compute redirect URI:
 * - If GOOGLE_REDIRECT_URI is provided, use it (backward compatible)
 * - Else compute from SERVER_URL / request headers
 */
function getRedirectUri(req) {
  const envUri = process.env.GOOGLE_REDIRECT_URI;
  if (envUri && String(envUri).trim()) return String(envUri).trim();

  const base = getServerBaseUrl(req);
  return `${base}/api/google/auth/callback`;
}

export function makeOAuthClient({ req } = {}) {
  const clientId = required("GOOGLE_CLIENT_ID");
  const clientSecret = required("GOOGLE_CLIENT_SECRET");
  const redirectUri = getRedirectUri(req);

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildAuthUrl({ state, req } = {}) {
  const oAuth2Client = makeOAuthClient({ req });

  // ✅ Keep only what you need. For inserting events, calendar.events is enough.
  const scopes = [
    "https://www.googleapis.com/auth/calendar.events"
  ];

  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures refresh_token on first connect
    scope: scopes,
    state,
    include_granted_scopes: true
  });
}

export function calendarEventFromBooking({ type, details, externalLink, qrUrl }) {
  const now = new Date();

  const linkLine = externalLink ? `\nBooking link: ${externalLink}` : "";
  const qrLine = qrUrl ? `\nQR code: ${qrUrl}` : "";
  const metaLines = `${linkLine}${qrLine}`;

  // You can set this to your actual desired timezone
  const TIME_ZONE = process.env.APP_TIMEZONE || "Indian/Mauritius";

  if (type === "hotel") {
    const checkIn = details.checkIn;
    const checkOut = details.checkOut;

    const title = `🏨 Hotel stay — ${details.hotelNameOrArea || "Mauritius"}`;
    const description =
      `Rooms: ${details.rooms}\nAdults: ${details.adults}\nChildren: ${details.children}\nBudget (MUR): ${details.budgetMUR}\n` +
      (details.specialRequests ? `Special requests: ${details.specialRequests}\n` : "") +
      metaLines;

    // All-day events: end.date is exclusive (Google Calendar behavior).
    // For a stay (check-in -> check-out), using checkOut as end is correct.
    return {
      summary: title,
      description,
      start: { date: checkIn, timeZone: TIME_ZONE },
      end: { date: checkOut, timeZone: TIME_ZONE }
    };
  }

  // Taxi: timed event
  const title = `🚕 Taxi — ${details.pickupLocation || "Pickup"} → ${details.dropoffLocation || "Dropoff"}`;
  const description =
    `Passengers: ${details.passengers}\n` +
    (details.luggage ? `Luggage: ${details.luggage}\n` : "") +
    (details.notes ? `Notes: ${details.notes}\n` : "") +
    metaLines;

  let startDateTime = new Date(`${details.pickupDate}T${details.pickupTime}:00`);
  if (Number.isNaN(startDateTime.getTime())) startDateTime = now;

  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  return {
    summary: title,
    description,
    start: { dateTime: startDateTime.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: endDateTime.toISOString(), timeZone: TIME_ZONE }
  };
}

export async function insertEvent({ tokens, type, details, externalLink, qrUrl }) {
  const oAuth2Client = makeOAuthClient();
  oAuth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const event = calendarEventFromBooking({ type, details, externalLink, qrUrl });

  const resp = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event
  });

  return {
    eventId: resp?.data?.id || null,
    htmlLink: resp?.data?.htmlLink || null
  };
}