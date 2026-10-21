import fs from "node:fs";
import path from "node:path";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "session.log");

// Append across runs: a log deleted at import (or at exit) can never be read
// after the crash it was meant to explain, and deleting it also wipes the log
// of a second instance sharing the directory.
fs.mkdirSync(LOGS_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

/** Writes one labelled block. Callers own what they put in it. */
export function logToFile(prefix: string, message: unknown): void {
  const timestamp = new Date().toISOString();
  const content =
    typeof message === "string"
      ? message
      : JSON.stringify(
          message,
          (_key, val) => (typeof val === "bigint" ? val.toString() : val),
          2,
        );

  logStream.write(`[${timestamp}] [${prefix}]\n${content}\n\n`);
}
