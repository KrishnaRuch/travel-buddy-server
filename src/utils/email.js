import nodemailer from "nodemailer";

const BRAND = {
  name: "Travel Buddy",
  accent: "#4F46E5",
  accent2: "#10B981"
};

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

function makeTransporter() {
  const provider = (process.env.EMAIL_PROVIDER || "gmail").toLowerCase();
  const tlsInsecure =
    String(process.env.EMAIL_TLS_INSECURE || "").toLowerCase() === "true";

  const user = required("EMAIL_USER");
  const pass = required("EMAIL_PASS");

  if (provider === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      ...(tlsInsecure ? { tls: { rejectUnauthorized: false } } : {})
    });
  }

  // Generic SMTP option (if you ever switch later)
  const host = required("EMAIL_HOST");
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = String(process.env.EMAIL_SECURE || "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(tlsInsecure ? { tls: { rejectUnauthorized: false } } : {})
  });
}

// ✅ Lazy init / auto-recover transporter
let transporter = null;
let lastVerifyAt = 0;

async function getTransporter() {
  if (!transporter) {
    transporter = makeTransporter();
    await transporter.verify();
    lastVerifyAt = Date.now();
    return transporter;
  }

  const now = Date.now();
  if (now - lastVerifyAt > 5 * 60 * 1000) {
    try {
      await transporter.verify();
      lastVerifyAt = now;
    } catch (e) {
      transporter = makeTransporter();
      await transporter.verify();
      lastVerifyAt = now;
    }
  }

  return transporter;
}

/**
 * Send email with optional attachments
 */
export async function sendEmail({ to, subject, html, attachments = [] }) {
  const t = await getTransporter();

  return t.sendMail({
    from: `"${BRAND.name}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    attachments
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function keyLabel(k) {
  const map = {
    hotelNameOrArea: "Hotel area / name",
    checkIn: "Check-in",
    checkOut: "Check-out",
    rooms: "Rooms",
    adults: "Adults",
    children: "Children",
    budgetMUR: "Budget (MUR)",
    specialRequests: "Special requests",

    pickupLocation: "Pickup",
    dropoffLocation: "Dropoff",
    pickupDate: "Date",
    pickupTime: "Time",
    passengers: "Passengers",
    luggage: "Luggage",
    notes: "Notes",

    externalLink: "Booking link",
    taxiWhatsAppLink: "WhatsApp link"
  };
  return map[k] || k;
}

function emailShell({ title, subtitle, contentHtml }) {
  return `
  <div style="background:#f3f4f6;padding:24px 12px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="padding:18px 20px;background:linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent2});color:#fff;">
        <div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:0.2px;">
          ${BRAND.name}
        </div>
        <div style="font-family:Arial,sans-serif;font-size:13px;opacity:0.92;margin-top:3px;">
          ${escapeHtml(subtitle || "")}
        </div>
      </div>

      <div style="padding:22px 20px;font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
        <h2 style="margin:0 0 10px 0;font-size:18px;">${escapeHtml(title)}</h2>
        ${contentHtml}
      </div>

      <div style="padding:14px 20px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">
        © ${new Date().getFullYear()} ${BRAND.name}
      </div>
    </div>
  </div>
  `;
}

export function welcomeEmailTemplate({ username, preferences = [] }) {
  const prefs = Array.isArray(preferences) && preferences.length
    ? `<ul style="margin:10px 0 0 18px;padding:0;">${preferences
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join("")}</ul>`
    : `<p style="margin:8px 0 0 0;color:#374151;">Preferences: <b>Not specified</b></p>`;

  const contentHtml = `
    <p style="margin:0 0 10px 0;">Hello <b>${escapeHtml(username)}</b>,</p>
    <p style="margin:0;color:#374151;">Welcome to Travel Buddy. Your account is ready.</p>
    ${prefs}
  `;

  return emailShell({
    title: "Welcome aboard",
    subtitle: "Mauritius bookings made simple",
    contentHtml
  });
}

/**
 * bookingEmailTemplate
 * - For taxi: externalLink should be Google Maps route
 * - taxiWhatsAppLink is optional (clean CTA button)
 */
export function bookingEmailTemplate({
  username,
  bookingType,
  details,
  externalLink = null,
  taxiWhatsAppLink = null,
  qrUrl = null
}) {
  const niceType = bookingType === "hotel" ? "Hotel booking" : "Taxi booking";

  // Don’t show links inside the details table (they look ugly there)
  const HIDE_KEYS = new Set(["type", "externalLink", "taxiWhatsAppLink", "qrUrl"]);

  const rows = Object.entries(details || {})
    .filter(([k]) => !HIDE_KEYS.has(k))
    .map(([k, v]) => {
      const label = keyLabel(k);
      const value = escapeHtml(v);
      return `
        <tr>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:700;width:40%;">
            ${escapeHtml(label)}
          </td>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;">
            ${value}
          </td>
        </tr>`;
    })
    .join("");

  // ✅ CTA blocks
  const isTaxi = bookingType === "taxi";

  const primaryTitle = isTaxi ? "Open your route" : "Continue on booking partner";
  const primaryLabel = isTaxi ? "Open Google Maps route →" : "Open booking link →";

  const linkBlock = externalLink
    ? `
      <div style="margin-top:14px;padding:12px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb;">
        <div style="font-weight:700;margin-bottom:10px;">${escapeHtml(primaryTitle)}</div>

        <a href="${escapeHtml(externalLink)}"
           style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;font-weight:700;padding:10px 14px;border-radius:12px;">
          ${escapeHtml(primaryLabel)}
        </a>

        ${
          isTaxi && taxiWhatsAppLink
            ? `
              <a href="${escapeHtml(taxiWhatsAppLink)}"
                 style="display:inline-block;margin-left:10px;background:${BRAND.accent2};color:#fff;text-decoration:none;font-weight:700;padding:10px 14px;border-radius:12px;">
                Message on WhatsApp →
              </a>
            `
            : ""
        }
      </div>
    `
    : "";

  const qrBlock = qrUrl
    ? `
      <div style="margin-top:14px;">
        <div style="font-weight:700;margin-bottom:8px;">
          ${isTaxi ? "Scan QR to open the route" : "Scan QR to open link"}
        </div>
        <img src="${escapeHtml(qrUrl)}"
             alt="Booking QR code"
             style="width:180px;height:180px;border-radius:14px;border:1px solid #e5e7eb;" />
      </div>
    `
    : "";

  const contentHtml = `
    <p style="margin:0 0 10px 0;">Hello <b>${escapeHtml(username)}</b>,</p>
    <p style="margin:0 0 14px 0;color:#374151;">
      Your <b>${escapeHtml(niceType)}</b> request has been received.
    </p>

    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tbody>${rows}</tbody>
    </table>

    ${linkBlock}
    ${qrBlock}
  `;

  return emailShell({
    title: "Booking confirmation",
    subtitle: niceType,
    contentHtml
  });
}