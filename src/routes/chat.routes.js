import express from "express";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";
import { matchIntent } from "../utils/intents.js";
import { geminiReply } from "../utils/gemini.js";

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  return s === "fr" || s.startsWith("fr") ? "fr" : "en";
}

function clean(s) {
  return String(s || "").trim().toLowerCase();
}

function tokenize(text) {
  return clean(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// -------------------------
// Recommendation + handover heuristics
// -------------------------
function looksLikeRecommendation(msg) {
  const m = clean(msg);
  return (
    m.includes("recommend") ||
    m.includes("suggest") ||
    m.includes("recommendation") ||
    m.includes("hotels") ||
    m.includes("hotel") ||
    m.includes("activities") ||
    m.includes("activity") ||
    m.includes("things to do") ||
    m.includes("places to visit") ||
    m.includes("what can i do") ||
    m.includes("recommande") || // FR-ish
    m.includes("suggere") ||
    m.includes("activité") ||
    m.includes("activite") ||
    m.includes("hôtel") ||
    m.includes("hotel")
  );
}

function inferRecType(msg) {
  const m = clean(msg);
  if (
    m.includes("activity") ||
    m.includes("activities") ||
    m.includes("things to do") ||
    m.includes("places to visit") ||
    m.includes("activité") ||
    m.includes("activite") ||
    m.includes("activités") ||
    m.includes("activites")
  ) {
    return "activity";
  }
  return "hotel";
}

function wantsHuman(msg) {
  const m = clean(msg);
  return (
    m.includes("human") ||
    m.includes("agent") ||
    m.includes("representative") ||
    m.includes("support") ||
    m.includes("help desk") ||
    m.includes("contact") ||
    m.includes("talk to someone") ||
    m.includes("someone real") ||
    m.includes("humain") ||
    m.includes("assistance") ||
    m.includes("contactez")
  );
}

function isComplex(msg) {
  const s = String(msg || "");
  return (
    s.length > 220 ||
    /refund|complaint|legal|payment|urgent|problem|not working|error|chargeback|bug|fail/i.test(s)
  );
}

function scoreContentBased({ item, userPrefs, queryTokens }) {
  const tags = (item.tags || []).map((t) => clean(t));
  const area = clean(item.area);
  let score = 0;

  for (const t of tags) {
    if (userPrefs.has(t)) score += 3;
    if (queryTokens.has(t)) score += 2;
  }

  if (area && queryTokens.has(area)) score += 1;

  const nameTokens = new Set(tokenize(item.name));
  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) score += 1;
  }

  return score;
}

export function makeChatRouter(intents) {
  const chatRouter = express.Router();

  chatRouter.post("/", auth, async (req, res) => {
    try {
      const { message, lang } = req.body || {};
      const userId = req.user.userId;

      const L = normalizeLang(lang);

      if (!message || !String(message).trim()) {
        return res.status(400).json({
          error: L === "fr" ? "Le message est requis" : "Message is required"
        });
      }

      // Save prompt
      await q("INSERT INTO user_prompts(user_id, prompt) VALUES($1,$2)", [
        userId,
        message
      ]);

      // Keep only last 10 prompts per user
      await q(
        `DELETE FROM user_prompts
         WHERE id IN (
           SELECT id FROM user_prompts
           WHERE user_id=$1
           ORDER BY created_at DESC
           OFFSET 10
         )`,
        [userId]
      );

      // ✅ Intent match
      const matched = matchIntent(intents, message, L);
      if (matched) {
        if (matched.intent === "book_hotel" || matched.intent === "book_taxi") {
          return res.json({
            type: "trigger",
            intent: matched.intent,
            text: matched.response
          });
        }

        return res.json({
          type: "intent",
          intent: matched.intent,
          text: matched.response
        });
      }

      // ✅ Human-agent transfer
      if (wantsHuman(message) || isComplex(message)) {
        const supportNumber = String(process.env.SUPPORT_WHATSAPP || "23057223280")
          .replace(/\D/g, "")
          .trim();

        const safeMsg = encodeURIComponent(
          L === "fr"
            ? `Bonjour, j’ai besoin d’aide pour: ${message}`
            : `Hello, I need help with: ${message}`
        );

        return res.json({
          type: "handover",
          text:
            L === "fr"
              ? "Cette demande semble plus complexe. Souhaitez-vous contacter un agent humain ?"
              : "This request seems more complex. Would you like to contact a human agent?",
          actions: [
            {
              label: "WhatsApp (Agent) →",
              url: `https://wa.me/${supportNumber}?text=${safeMsg}`
            },
            {
              label: L === "fr" ? "Créer un ticket support" : "Create support ticket",
              action: "create_ticket"
            }
          ]
        });
      }

      // ✅ Recommendations
      if (looksLikeRecommendation(message)) {
        const recType = inferRecType(message);

        const prefRows = await q(
          "SELECT preference FROM user_preferences WHERE user_id=$1",
          [userId]
        );
        const userPrefs = new Set(prefRows.rows.map((r) => clean(r.preference)));

        const itemsRes = await q(
          "SELECT id, type, name, area, description, tags, price_range, external_url FROM catalog_items WHERE type=$1 LIMIT 200",
          [recType]
        );

        const queryTokens = new Set(tokenize(message));

        const ranked = itemsRes.rows
          .map((it) => ({
            ...it,
            score: scoreContentBased({ item: it, userPrefs, queryTokens })
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        if (!ranked.length) {
          return res.json({
            type: "recommendations",
            recType,
            text:
              L === "fr"
                ? "Je n’ai pas encore assez d’éléments dans le catalogue pour recommander des options. Veuillez réessayer plus tard."
                : "I don’t have enough catalog items yet to recommend options. Please try again later.",
            items: []
          });
        }

        const lines = ranked.map((x, i) => {
          const tagText = (x.tags || []).slice(0, 4).join(", ");
          const price = x.price_range ? ` (${x.price_range})` : "";
          return `${i + 1}) ${x.name} — ${x.area}${price}\n   Tags: ${tagText}\n   ${x.description}`;
        });

        return res.json({
          type: "recommendations",
          recType,
          text:
            (L === "fr"
              ? `Voici quelques ${recType === "hotel" ? "hôtels" : "activités"} recommandés :\n\n`
              : `Here are some recommended ${
                  recType === "hotel" ? "hotels" : "activities"
                }:\n\n`) + lines.join("\n\n"),
          items: ranked
        });
      }

      // ✅ Gemini fallback
      const last = await q(
        "SELECT prompt FROM user_prompts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
        [userId]
      );
      const context = last.rows.map((r) => r.prompt).reverse();

      try {
        const reply = await geminiReply({
          prompt: message,
          userContextPrompts: context,
          lang: L
        });

        if (!reply || String(reply).toLowerCase().includes("not configured")) {
          return res.json({
            type: "fallback",
            text:
              L === "fr"
                ? "Désolé ☹️. Je ne peux pas traiter cette demande pour le moment (service IA indisponible).\n" +
                  "Essayez plus tard, ou utilisez :\n" +
                  "• réserver un hôtel\n" +
                  "• réserver un taxi"
                : "Sorry ☹️. I can’t process that request right now (AI service unavailable). " +
                  "Please try again later, or use one of these commands:\n" +
                  "• book hotel\n" +
                  "• book taxi"
          });
        }

        return res.json({
          type: "gemini",
          text: reply
        });
      } catch (e) {
        console.error("Gemini error:", e?.message || e);

        return res.json({
          type: "fallback",
          text:
            L === "fr"
              ? "Désolé 😥. J’ai du mal à répondre pour le moment (service IA indisponible).\n" +
                "Essayez plus tard, ou utilisez :\n" +
                "• réserver un hôtel\n" +
                "• réserver un taxi"
              : "Sorry 😥. I’m having trouble answering that right now (AI service unavailable). " +
                "Please try again later, or use one of these commands:\n" +
                "• book hotel\n" +
                "• book taxi"
        });
      }
    } catch (err) {
      console.error("Chat route error:", err?.message || err);
      return res.status(500).json({ error: "Chat failed" });
    }
  });

  return chatRouter;
}