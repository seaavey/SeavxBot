/** Config shape and validation, kept free of file/env access so it is testable. */
const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface BotConfig {
  bot_name: string;
  prefixes: string[];
  owners: string[];
  auth: {
    dir: string;
    default_method?: string;
    phone_number?: string;
  };
  logging: {
    level: LogLevel;
  };
  storage?: {
    path?: string;
  };
  features?: {
    read_message?: boolean;
  };
  sticker?: {
    pack?: string;
    author?: string;
  };
  messages?: {
    owner_only?: string;
    admin_only?: string;
    group_only?: string;
    bot_admin_only?: string;
    error?: string;
    welcome_text?: string;
    goodbye_text?: string;
  };
}

let raw: unknown;
try {
  raw = (await import("../../../config.toml")).default;
} catch {
  throw new Error(
    "Missing config.toml — copy config.example.toml to config.toml and set your owner numbers.",
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Validates the user-edited TOML before anything reads it, so a missing
 * section names the key instead of throwing `undefined is not an object`
 * from a module the user never touched.
 */
export function parseConfig(value: unknown): BotConfig {
  if (!isRecord(value)) {
    throw new Error("config.toml: the file is empty or not a TOML object.");
  }

  const problems: string[] = [];
  const section = (key: string): Record<string, unknown> => {
    const part = value[key];
    if (part === undefined) return {};
    if (!isRecord(part)) {
      problems.push(`${key} must be a table ([${key}])`);
      return {};
    }
    return part;
  };

  if (!nonEmptyString(value.bot_name)) {
    problems.push("bot_name must be a non-empty string");
  }

  const prefixes = value.prefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    problems.push(
      'prefixes must be a non-empty array, e.g. prefixes = ["!", "."]',
    );
  } else if (!prefixes.every(nonEmptyString)) {
    problems.push("every entry in prefixes must be a non-empty string");
  }

  const owners = value.owners;
  if (!Array.isArray(owners) || owners.length === 0) {
    problems.push(
      'owners must list at least one phone number, e.g. owners = ["628123456789"]',
    );
  } else if (
    !owners.every(
      (owner) =>
        typeof owner === "string" && owner.replace(/\D/g, "").length >= 8,
    )
  ) {
    problems.push(
      "every owner must be a phone number string with country code",
    );
  }

  const auth = section("auth");
  if (auth.dir !== undefined && !nonEmptyString(auth.dir)) {
    problems.push("auth.dir must be a non-empty string");
  }
  for (const key of ["default_method", "phone_number"] as const) {
    if (auth[key] !== undefined && typeof auth[key] !== "string") {
      problems.push(`auth.${key} must be a string`);
    }
  }

  const logging = section("logging");
  if (
    logging.level !== undefined &&
    !LOG_LEVELS.includes(logging.level as LogLevel)
  ) {
    problems.push(`logging.level must be one of ${LOG_LEVELS.join(" | ")}`);
  }

  const storage = section("storage");
  if (storage.path !== undefined && !nonEmptyString(storage.path)) {
    problems.push("storage.path must be a non-empty string");
  }

  const features = section("features");
  if (
    features.read_message !== undefined &&
    typeof features.read_message !== "boolean"
  ) {
    problems.push("features.read_message must be true or false");
  }

  const sticker = section("sticker");
  for (const key of ["pack", "author"] as const) {
    if (sticker[key] !== undefined && typeof sticker[key] !== "string") {
      problems.push(`sticker.${key} must be a string`);
    }
  }

  const messages = section("messages");
  for (const [key, text] of Object.entries(messages)) {
    if (typeof text !== "string") {
      problems.push(`messages.${key} must be a string`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `config.toml: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`,
    );
  }

  return {
    bot_name: value.bot_name as string,
    prefixes: prefixes as string[],
    owners: owners as string[],
    auth: {
      dir: (auth.dir as string | undefined) || "auth_info",
      default_method: auth.default_method as string | undefined,
      phone_number: auth.phone_number as string | undefined,
    },
    logging: { level: (logging.level as LogLevel | undefined) || "warn" },
    storage: { path: storage.path as string | undefined },
    features: { read_message: features.read_message === true },
    sticker: {
      pack: (sticker.pack as string | undefined) || "",
      author: (sticker.author as string | undefined) || "",
    },
    messages: messages as BotConfig["messages"],
  };
}
