import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app.js";
import { loadIntents } from "./utils/intents.js";

const intents = loadIntents();
const app = createApp(intents);

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Travel Buddy server running on http://localhost:${port}`);
});