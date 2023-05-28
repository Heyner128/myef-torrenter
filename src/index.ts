import * as dotenv from "dotenv";
import TorrentBot from "./TorrentBot.js";

import logger from "./logger.js";

dotenv.config();

const bot = new TorrentBot();

try {
  bot.addEvents();
  await bot.listen();
} catch (error) {
  logger.error(`Bot start error ${error}`);
  process.exit(1);
}

logger.info("Bot started");
