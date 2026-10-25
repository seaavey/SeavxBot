import fs from "node:fs";
import path from "node:path";
import type { Command } from "@/lib/core/types";

export const commands = new Map<string, Command>();
export const aliases = new Map<string, string>();

const COMMANDS_DIR = path.resolve(import.meta.dir, "../../commands");

export async function loadCommands(dir = COMMANDS_DIR): Promise<void> {
  commands.clear();
  aliases.clear();

  await walk(dir);

  console.log(`Loaded ${commands.size} commands (${aliases.size} aliases)`);
}

/** The folder a file sits in is its menu category. */
async function walk(dir: string, category?: string): Promise<void> {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Outermost folder wins, so a nested folder cannot invent a section.
      await walk(fullPath, category ?? entry.name);
      continue;
    }

    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec."))
      continue;

    const { default: cmd } = (await import(fullPath)) as { default?: Command };

    if (!cmd?.name || typeof cmd.run !== "function") {
      // Silent skips hide a broken export until someone notices the command
      // missing from the menu.
      console.warn(`Skipping ${fullPath}: no default export with name + run`);
      continue;
    }

    if (category) cmd.category ??= category;
    else console.warn(`No category folder for ${fullPath}`);

    commands.set(cmd.name.toLowerCase(), cmd);

    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) {
        aliases.set(alias.toLowerCase(), cmd.name.toLowerCase());
      }
    }
  }
}

export function getCommand(name: string): Command | undefined {
  const normalized = name.toLowerCase();
  const direct = commands.get(normalized);
  if (direct) return direct;

  const mapped = aliases.get(normalized);
  return mapped ? commands.get(mapped) : undefined;
}
