import pino from "pino";

const pretty = process.env.LOG_PRETTY === "true" || process.env.NODE_ENV === "development";

export const logger = pino({
  name: "rusty-bot",
  level: process.env.LOG_LEVEL ?? "info",
  ...(pretty && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

/** Flush buffered log entries, then invoke the callback. Use before process.exit. */
export function flushLogger(cb?: (err?: Error) => void): void {
  logger.flush(cb);
}
