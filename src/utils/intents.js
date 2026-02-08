// server/src/utils/intents.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function norm(s) {
  return stripAccents(String(s || "").toLowerCase().trim());
}

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  return s === "fr" || s.startsWith("fr") ? "fr" : "en";
}

/**
 * If lang is French, map common French booking commands to your existing English intents.
 * This keeps patterns stable while enabling French trigger phrases.
 */
function mapFrenchToEnglishForIntentMatching(message) {
  const m = norm(message);

  const hotelSignals = [
    "reserver un hotel",
    "reserver hotel",
    "reservation hotel",
    "hotel",
    "hôtel",
    "hebergement",
    "hébergement",
    "logement",
  ];

  const taxiSignals = [
    "reserver un taxi",
    "reserver taxi",
    "reservation taxi",
    "taxi",
    "chauffeur",
    "transport",
    "voiture",
  ];

  const hasReserveVerb =
    m.includes("reserver") ||
    m.includes("réserver") ||
    m.includes("reservation") ||
    m.includes("réservation") ||
    m.includes("book") ||
    m.includes("booking");

  const mentionsHotel = hotelSignals.some((k) => m.includes(norm(k)));
  const mentionsTaxi = taxiSignals.some((k) => m.includes(norm(k)));

  if (hasReserveVerb && mentionsHotel) return "book hotel";
  if (hasReserveVerb && mentionsTaxi) return "book taxi";

  if (m === "hotel" || m === "un hotel" || m === "hôtel" || m === "un hôtel") return "book hotel";
  if (m === "taxi" || m === "un taxi") return "book taxi";

  return message;
}

function extractPatterns(intentObj) {
  const raw = intentObj?.patterns || intentObj?.keywords || intentObj?.phrases || "";
  if (!raw) return [];

  // patterns in your CSV are pipe-separated
  if (typeof raw === "string") {
    return raw
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  return [];
}

function pickResponse(it, lang) {
  const L = normalizeLang(lang);

  // ✅ new CSV format supports response_en/response_fr
  const fr = it.response_fr || it.reponse_fr || it.fr || "";
  const en = it.response_en || it.response || it.reply || it.text || "";

  if (L === "fr" && fr && String(fr).trim()) return String(fr).trim();
  return String(en || "").trim();
}

// --- NEW: safe regex helpers for whole-word / whole-phrase matching ---

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a pattern as a whole word/phrase (not substring).
 * Works on already-normalized strings (lowercase, trimmed, accents stripped).
 *
 * Examples:
 *  - "hi" matches "hi there"
 *  - "hi" does NOT match "things"
 *  - "book hotel" matches "can you book hotel for me"
 */
function matchesWhole(mNorm, patternNorm) {
  if (!patternNorm) return false;
  // Word boundaries prevent substring matches (e.g., "things" containing "hi")
  const re = new RegExp(`\\b${escapeRegex(patternNorm)}\\b`);
  return re.test(mNorm);
}

/**
 * matchIntent(intents, message, lang?)
 * Returns { intent, response } or null
 *
 * ✅ Fixes:
 * - Case-insensitive matching (already via norm())
 * - Prevents substring collisions ("hi" matching inside "things")
 * - Prefers most specific match (longest pattern wins)
 */
export function matchIntent(intents, message, lang = "en") {
  if (!Array.isArray(intents) || !message) return null;

  const L = normalizeLang(lang);

  const msgForMatching = L === "fr" ? mapFrenchToEnglishForIntentMatching(message) : message;
  const m = norm(msgForMatching);

  let best = null;

  for (const it of intents) {
    const intentName = it.intent || it.name || it.id;
    if (!intentName) continue;

    const patterns = extractPatterns(it);
    if (!patterns.length) continue;

    for (const p of patterns) {
      const k = norm(p);
      if (!k) continue;

      if (matchesWhole(m, k)) {
        // Prefer more specific patterns
        const score = k.length;

        if (!best || score > best.score) {
          best = {
            intent: intentName,
            response: pickResponse(it, L),
            score,
          };
        }
      }
    }
  }

  if (!best) return null;
  return { intent: best.intent, response: best.response };
}

/**
 * Load intents.csv from project root (Travel Buddy/intents.csv)
 * Supports headers:
 * - intent,patterns,response
 * - intent,patterns,response_en,response_fr  ✅ recommended
 */
export function loadIntents() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const candidates = [
    // ✅ your screenshot shows intents.csv is at project root, one level above /server
    path.resolve(__dirname, "../../intents.csv"),
    path.resolve(__dirname, "../intents.csv"),
    path.resolve(__dirname, "../../server/intents.csv"),
  ];

  let csvPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      csvPath = c;
      break;
    }
  }

  if (!csvPath) {
    throw new Error(`intents.csv not found. Tried:\n- ${candidates.join("\n- ")}`);
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1);

  // Minimal CSV parser that respects quotes
  function parseCSVLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }

  const intents = rows.map((line) => {
    const cols = parseCSVLine(line);
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = cols[i] ?? "";
    }
    return obj;
  });

  // Optional: warn if old headers used
  const hasNew = header.includes("response_fr") && header.includes("response_en");
  const hasOld = header.includes("response");
  if (!hasNew && !hasOld) {
    console.warn(
      "[Intents] intents.csv expected headers: intent,patterns,response OR intent,patterns,response_en,response_fr"
    );
  }

  return intents;
}