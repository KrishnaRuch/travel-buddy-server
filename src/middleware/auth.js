import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

export function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, email }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}