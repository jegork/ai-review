import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

let _storage: LibSQLStore | null = null;
let _mastra: Mastra | null = null;

export function getStorage(): LibSQLStore {
  if (!_storage) {
    const dbUrl = process.env.RUSTY_DB_URL ?? "file:./rusty.db";
    _storage = new LibSQLStore({
      id: "rusty-bot-storage",
      url: dbUrl,
    });
  }
  return _storage;
}

export function getMastra(): Mastra {
  if (!_mastra) {
    _mastra = new Mastra({
      storage: getStorage(),
    });
  }
  return _mastra;
}
