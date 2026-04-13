import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

const dbUrl = process.env.RUSTY_DB_URL ?? "file:./rusty.db";

export const storage = new LibSQLStore({
  id: "rusty-bot-storage",
  url: dbUrl,
});

export const mastra = new Mastra({
  storage,
});
