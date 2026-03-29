import express from "express";
import { auth } from "../middleware/auth.js";
import { q } from "../db.js";

function clean(s) {
  return String(s || "").trim().toLowerCase();
}

function tokenize(text) {
  return clean(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreContentBased({ item, userPrefs, queryTokens }) {
  // simple explainable scoring:
  // +3 if tag matches a user preference
  // +2 if tag matches query token
  // +1 if area matches query token
  const tags = (item.tags || []).map((t) => clean(t));
  const area = clean(item.area);
  let score = 0;

  for (const t of tags) {
    if (userPrefs.has(t)) score += 3;
    if (queryTokens.has(t)) score += 2;
  }

  if (queryTokens.has(area)) score += 1;

  // small boost if name contains query token
  const nameTokens = new Set(tokenize(item.name));
  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) score += 1;
  }

  return score;
}

export function makeRecommendationsRouter() {
  const router = express.Router();

  // GET /api/recommendations?type=hotel|activity&area=...&q=...&algo=content|popular&limit=5
  router.get("/", auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const type = clean(req.query.type);
      const area = String(req.query.area || "").trim();
      const qText = String(req.query.q || "").trim();
      const algo = clean(req.query.algo) || "content";
      const limit = Math.min(Number(req.query.limit || 5), 10);

      if (type !== "hotel" && type !== "activity") {
        return res.status(400).json({ error: "type must be hotel or activity" });
      }

      // user preferences (for personalization)
      const prefRows = await q(
        "SELECT preference FROM user_preferences WHERE user_id=$1",
        [userId]
      );
      const userPrefs = new Set(prefRows.rows.map((r) => clean(r.preference)));

      // fetch candidate items
      const params = [type];
      let sql = "SELECT id, type, name, area, description, tags, price_range, external_url FROM catalog_items WHERE type=$1";

      if (area) {
        params.push(area);
        sql += ` AND area ILIKE $${params.length}`;
      }

      const items = await q(sql, params);

      const queryTokens = new Set(tokenize(`${qText} ${area}`));

      let ranked = [];

      if (algo === "popular") {
        // popularity = click/book count (fallback to 0)
        const pop = await q(
          `
          SELECT item_id,
                 SUM(CASE WHEN action='click' THEN 2 ELSE 1 END) as score
          FROM item_interactions
          GROUP BY item_id
          `
        );
        const popMap = new Map(pop.rows.map((r) => [Number(r.item_id), Number(r.score)]));

        ranked = items.rows
          .map((it) => ({ ...it, score: popMap.get(it.id) || 0 }))
          .sort((a, b) => b.score - a.score);
      } else {
        // content-based personalized ranking
        ranked = items.rows
          .map((it) => ({
            ...it,
            score: scoreContentBased({ item: it, userPrefs, queryTokens })
          }))
          .sort((a, b) => b.score - a.score);
      }

      const top = ranked.slice(0, limit);

      return res.json({
        ok: true,
        algo,
        type,
        area: area || null,
        items: top
      });
    } catch (e) {
      console.error("Recommendations error:", e?.message || e);
      return res.status(500).json({ error: "Failed to generate recommendations" });
    }
  });

  // POST /api/recommendations/track  { itemId, action }
  router.post("/track", auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { itemId, action } = req.body || {};

      const id = Number(itemId);
      const act = clean(action);

      if (!id || (act !== "view" && act !== "click" && act !== "book")) {
        return res.status(400).json({ error: "Invalid itemId/action" });
      }

      await q(
        "INSERT INTO item_interactions(user_id, item_id, action) VALUES($1,$2,$3)",
        [userId, id, act]
      );

      return res.json({ ok: true });
    } catch (e) {
      console.error("Track error:", e?.message || e);
      return res.status(500).json({ error: "Failed to track interaction" });
    }
  });

  return router;
}