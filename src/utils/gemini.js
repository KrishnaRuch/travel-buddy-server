// server/src/utils/gemini.js
import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/**
 * Gemini model IDs differ across projects. We'll try a few.
 * You can override via .env:
 *   GEMINI_MODEL=gemini-3-flash-preview
 */
const MODEL_CANDIDATES = [
  (process.env.GEMINI_MODEL || "").trim(),
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
].filter(Boolean);

function isModelNotFoundError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("is not supported") ||
    msg.includes("models/") ||
    (msg.includes("model") && msg.includes("not") && msg.includes("supported"))
  );
}

function isHardFailure(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("api key") ||
    msg.includes("permission") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("billing") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout")
  );
}

/**
 * geminiReply({ prompt, userContextPrompts, lang })
 * - lang: "en" | "fr"
 */
export async function geminiReply({ prompt, userContextPrompts = [], lang = "en" }) {
  if (!genAI) {
    return "Gemini is not configured yet. Please set GEMINI_API_KEY in server/.env.";
  }

  const safeLang = lang === "fr" ? "fr" : "en";

  const languageRule =
    safeLang === "fr"
      ? `
IMPORTANT LANGUAGE RULE:
- Reply ONLY in French (Français).
- Do not include any English translation.
- Keep it natural for tourists visiting Mauritius.
`
      : `
IMPORTANT LANGUAGE RULE:
- Reply ONLY in English.
`;

  const contextBlock =
    Array.isArray(userContextPrompts) && userContextPrompts.length
      ? `User recent conversation prompts:\n- ${userContextPrompts.join("\n- ")}\n\n`
      : "";

  const fullPrompt = `
You are Travel Buddy, a friendly tour booking assistant for Mauritius.
Be concise, helpful, and ask a single follow-up question when needed.
If the user asks about places (e.g., Grand Baie), give practical suggestions.

${languageRule}

${contextBlock}
User: ${prompt}
Travel Buddy:
`.trim();

  let lastError = null;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await model.generateContent(fullPrompt);
      const text = result?.response?.text?.() ?? "";

      if (text && String(text).trim()) return String(text).trim();

      lastError = new Error(`Empty response from model: ${modelName}`);
    } catch (err) {
      lastError = err;

      if (isModelNotFoundError(err)) {
        console.warn(`[Gemini] Model not supported: ${modelName}`);
        continue;
      }

      if (isHardFailure(err)) {
        console.error("[Gemini] Hard failure:", err?.message || err);
        return safeLang === "fr"
          ? "Le service IA est temporairement indisponible (accès Gemini). Réessayez plus tard."
          : "AI service is temporarily unavailable (Gemini access issue). Please try again later.";
      }

      console.error("[Gemini] Unexpected error:", err?.message || err);
      return safeLang === "fr"
        ? "Le service IA est temporairement indisponible. Réessayez plus tard."
        : "AI service is temporarily unavailable. Please try again later.";
    }
  }

  console.error("Gemini model fallback failed:", lastError?.message || lastError);
  return safeLang === "fr"
    ? "Le service IA est temporairement indisponible. Réessayez plus tard, ou utilisez : réserver un hôtel / réserver un taxi."
    : "AI service is temporarily unavailable. Please try again later, or use: book hotel / book taxi.";
}