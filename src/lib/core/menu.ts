import type { proto } from "@whiskeysockets/baileys";
import type { Command } from "@/lib/core/types";

/** Section order; an unlisted category keeps insertion order at the end. */
const CATEGORY_ORDER = [
  "general",
  "games",
  "group",
  "media",
  "image",
  "downloader",
  "owner",
];

/** The list sheet drops rows past ten per section, so a big category splits. */
const MAX_ROWS = 10;

/**
 * Pushed as `additionalNodes`: the client reads it to decide the message is a
 * native flow. Without it the payload is accepted and rendered as plain text.
 */
export const MENU_NODES = [
  {
    tag: "biz",
    attrs: {},
    content: [
      {
        tag: "interactive",
        attrs: { type: "native_flow", v: "1" },
        content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
      },
    ],
  },
];

/** `✦ ✧ ❖ ▸` are text symbols, not emoji, so the menu stays monochrome. */
const MARK = "✦";
const SPARK = "✧";
const DIAMOND = "❖";
const BULLET = "▸";

const rank = (category: string): number => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
};

/** Commands bucketed by category, in menu order, each bucket sorted by name. */
function groupByCategory(list: Command[]): [string, Command[]][] {
  const groups = new Map<string, Command[]>();

  for (const cmd of list) {
    const key = cmd.category ?? "general";
    const bucket = groups.get(key);
    if (bucket) bucket.push(cmd);
    else groups.set(key, [cmd]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, group]) => [
      category,
      [...group].sort((a, b) => a.name.localeCompare(b.name)),
    ]);
}

/** Two units at most: "3d 4h" says enough for a menu header. */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/** The owner reads Jakarta time, so neither helper follows the server zone. */
const jakartaHour = (date: Date): number =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );

export function greeting(date = new Date()): string {
  const hour = jakartaHour(date);
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** `2026-10-25 19:34`: `sv-SE` is the shape that already sorts and reads. */
export function jakartaTime(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const lineFor = (cmd: Command, prefix: string): string => {
  const alias = cmd.aliases?.length ? ` _(${cmd.aliases.join(", ")})_` : "";
  const what = cmd.description ? ` · ${cmd.description}` : "";
  return `│ ${BULLET} *${prefix}${cmd.name}*${alias}${what}`;
};

export interface MenuOptions {
  title: string;
  prefix: string;
  /** Status lines the caller owns: role, counters, uptime, clock. */
  info: string[];
}

/** Plain text, so the whole menu renders without touching the socket. */
export function renderMenu(list: Command[], options: MenuOptions): string {
  const sections = groupByCategory(list).map(([category, group]) => {
    const lines = group.map((cmd) => lineFor(cmd, options.prefix));

    return [
      `┌─ ${DIAMOND} *${category.toUpperCase()}* (${group.length})`,
      ...lines,
      "└────────────────────",
    ].join("\n");
  });

  const header = [
    `╭─「 ${MARK} *${options.title}* 」`,
    ...options.info.map((line) => `│ ${SPARK} ${line}`),
    "╰────────────────────",
  ].join("\n");

  return [header, ...sections].join("\n\n");
}

function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += size)
    chunks.push(list.slice(i, i + size));
  return chunks;
}

/**
 * The tappable menu: one `single_select` sheet with a row per command. The body
 * carries the caller's status lines and lists every command, so a client that
 * ignores the native flow still shows a usable card.
 */
export function buildMenuMessage(
  list: Command[],
  options: MenuOptions,
  headerImage?: proto.Message.IImageMessage,
): proto.IMessage {
  const grouped = groupByCategory(list);
  const at = (cmd: Command): string => `${options.prefix}${cmd.name}`;

  const categories = grouped.map(([category, group]) =>
    [
      `${DIAMOND} *${category.toUpperCase()}* (${group.length})`,
      ...group.map((cmd) => `${BULLET} *${at(cmd)}*`),
    ].join("\n"),
  );
  const body = [options.info.join("\n"), ...categories].join("\n\n");

  const sections = grouped.flatMap(([category, group]) =>
    chunk(group, MAX_ROWS).map((rows, index) => ({
      title: `${category.toUpperCase()}${index > 0 ? ` ${index + 1}` : ""}`,
      rows: rows.map((cmd) => ({
        title: `${at(cmd)}${cmd.aliases?.length ? ` (${cmd.aliases.join(", ")})` : ""}`,
        description: cmd.description ?? "",
        id: at(cmd),
      })),
    })),
  );

  return {
    interactiveMessage: {
      header: headerImage
        ? {
            title: `${MARK} ${options.title}`,
            hasMediaAttachment: true,
            imageMessage: headerImage,
          }
        : { title: `${MARK} ${options.title}`, hasMediaAttachment: false },
      body: { text: body },
      footer: { text: "Powered By Seaavey" },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: "Pilih command",
              sections,
            }),
          },
        ],
      },
    },
  };
}
