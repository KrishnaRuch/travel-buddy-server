// server/api/index.js
import { createApp } from "../src/app.js";
import { loadIntents } from "../src/utils/intents.js";

const intents = loadIntents();
const app = createApp(intents);

export default app;