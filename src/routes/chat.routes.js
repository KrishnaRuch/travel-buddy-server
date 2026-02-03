import express from "express";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";
import { matchIntent } from "../utils/intents.js";
import { geminiReply } from "../utils/gemini.js";

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  return s === "fr" || s.startsWith("fr") ? "fr" : "en";
}

export function makeChatRouter(intents) {
  const chatRouter = express.Router();

  // Chat endpoint: only real "chat prompts" should come here
  chatRouter.post("/", auth, async (req, res) => {
    const { message, lang } = req.body || {};
    const userId = req.user.userId;

    const L = normalizeLang(lang);

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: L === "fr" ? "Le message est requis" : "Message is required" });
    }

    // Save prompt
    await q("INSERT INTO user_prompts(user_id, prompt) VALUES($1,$2)", [userId, message]);

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

    // ✅ Intent match (NOW language-aware)
    const m = matchIntent(intents, message, L);
    if (m) {
      // If booking intents, frontend will start wizard (we return a trigger)
      if (m.intent === "book_hotel" || m.intent === "book_taxi") {
        return res.json({
          type: "trigger",
          intent: m.intent,
          text: m.response
        });
      }

      return res.json({
        type: "intent",
        intent: m.intent,
        text: m.response
      });
    }

    // Get last 10 prompts for personalization
    const last = await q(
      "SELECT prompt FROM user_prompts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
      [userId]
    );
    const context = last.rows.map((r) => r.prompt).reverse();

    // ✅ Gemini fallback (NOW language-aware)
    try {
      const reply = await geminiReply({
        prompt: message,
        userContextPrompts: context,
        lang: L
      });

      // If geminiReply returns a configuration message, treat it as failure too
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
  });

  return chatRouter;
}