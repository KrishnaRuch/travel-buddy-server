import { google } from "googleapis";

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}

export function makeOAuthClient() {
  const clientId = required("GOOGLE_CLIENT_ID");
  const clientSecret = required("GOOGLE_CLIENT_SECRET");
  const redirectUri = required("GOOGLE_REDIRECT_URI");

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildAuthUrl({ state }) {
  const oAuth2Client = makeOAuthClient();

  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly"
  ];

  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state
  });
}

export function calendarEventFromBooking({ type, details, externalLink, qrUrl }) {
  const now = new Date();

  const linkLine = externalLink ? `\nBooking link: ${externalLink}` : "";
  const qrLine = qrUrl ? `\nQR code: ${qrUrl}` : "";
  const metaLines = `${linkLine}${qrLine}`;

  if (type === "hotel") {
    const checkIn = details.checkIn;
    const checkOut = details.checkOut;

    const title = `🏨 Hotel stay — ${details.hotelNameOrArea || "Mauritius"}`;
    const description =
      `Rooms: ${details.rooms}\nAdults: ${details.adults}\nChildren: ${details.children}\nBudget (MUR): ${details.budgetMUR}\n` +
      (details.specialRequests ? `Special requests: ${details.specialRequests}\n` : "") +
      metaLines;

    return {
      summary: title,
      description,
      start: { date: checkIn },
      end: { date: checkOut }
    };
  }

  // Taxi: timed event
  const title = `🚕 Taxi — ${details.pickupLocation || "Pickup"} → ${details.dropoffLocation || "Dropoff"}`;
  const description =
    `Passengers: ${details.passengers}\n` +
    (details.luggage ? `Luggage: ${details.luggage}\n` : "") +
    (details.notes ? `Notes: ${details.notes}\n` : "") +
    metaLines;

  const startDateTime = new Date(`${details.pickupDate}T${details.pickupTime}:00`);
  if (Number.isNaN(startDateTime.getTime())) {
    startDateTime.setTime(now.getTime());
  }

  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  return {
    summary: title,
    description,
    start: { dateTime: startDateTime.toISOString() },
    end: { dateTime: endDateTime.toISOString() }
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