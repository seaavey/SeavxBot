import { describe, expect, test } from "bun:test";
import type { Command } from "@/lib/core/types";
import {
  buildMenuMessage,
  formatUptime,
  greeting,
  jakartaTime,
  renderMenu,
} from "@/lib/core/menu";

const cmd = (name: string, over: Partial<Command> = {}): Command => ({
  name,
  run: () => {},
  ...over,
});

const info = [
  "Good evening, *Seaavey*",
  "Role: Owner",
  "Total Your Message: 57 Messages",
  "Total Command: 46",
  "Total User: 3",
  "Uptime: 1h 1m",
  "Time: 2026-10-25 19:34 (Asia/Jakarta)",
];

const options = {
  title: "Bot Menu",
  prefix: ".",
  info,
};

interface Params {
  title: string;
  sections: {
    title: string;
    rows: { title: string; description: string; id: string }[];
  }[];
}

const paramsOf = (message: ReturnType<typeof buildMenuMessage>): Params => {
  const json =
    message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
      ?.buttonParamsJson;

  return JSON.parse(json ?? "{}") as Params;
};

describe("formatUptime", () => {
  test("drops the unit that is zero and stops at two units", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(90)).toBe("1m");
    expect(formatUptime(3661)).toBe("1h 1m");
    expect(formatUptime(90000)).toBe("1d 1h");
  });
});

describe("greeting", () => {
  test("follows Jakarta time, not the server zone", () => {
    // 17:00Z is 00:00 WIB, 23:00Z is 06:00 WIB, 05:00Z is 12:00 WIB.
    expect(greeting(new Date("2026-10-24T17:00:00Z"))).toBe("Good evening");
    expect(greeting(new Date("2026-10-24T23:00:00Z"))).toBe("Good morning");
    expect(greeting(new Date("2026-10-25T05:00:00Z"))).toBe("Good afternoon");
    expect(greeting(new Date("2026-10-25T14:00:00Z"))).toBe("Good evening");
  });
});

describe("jakartaTime", () => {
  test("renders the Jakarta wall clock as a sortable stamp", () => {
    expect(jakartaTime(new Date("2026-10-25T12:34:00Z"))).toBe(
      "2026-10-25 19:34",
    );
  });
});

describe("renderMenu", () => {
  test("orders known categories first and appends unknown ones", () => {
    const text = renderMenu(
      [
        cmd("menu", { category: "general" }),
        cmd("warn", { category: "group" }),
        cmd("x", { category: "misc" }),
      ],
      options,
    );

    expect(text.indexOf("GENERAL")).toBeLessThan(text.indexOf("GROUP"));
    expect(text.indexOf("GROUP")).toBeLessThan(text.indexOf("MISC"));
  });

  test("shows aliases and descriptions", () => {
    const text = renderMenu(
      [
        cmd("menu", {
          category: "general",
          aliases: ["help"],
          description: "List commands",
        }),
      ],
      options,
    );

    expect(text).toContain("*.menu* _(help)_ · List commands");
    expect(text).toContain("❖ *GENERAL* (1)");
  });

  test("keeps a command without a description free of a dangling separator", () => {
    const text = renderMenu([cmd("ping", { category: "general" })], options);

    expect(text).toContain("│ ▸ *.ping*");
    expect(text).not.toContain("· \n");
  });

  test("renders every caller info line inside the header", () => {
    const text = renderMenu([cmd("ping", { category: "general" })], options);

    for (const line of info) expect(text).toContain(`│ ✧ ${line}`);
  });

  test("shows no prefixes line", () => {
    const text = renderMenu([cmd("ping", { category: "general" })], options);

    expect(text).not.toContain("prefixes");
  });

  test("keeps the whole menu free of emoji and em dashes", () => {
    const text = renderMenu(
      [
        cmd("ping", { category: "general" }),
        cmd("kick", { category: "group" }),
        cmd("x", { category: "misc" }),
      ],
      options,
    );

    expect(text).not.toContain("—");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("buildMenuMessage", () => {
  test("offers one single_select sheet whose row id is the command", () => {
    const message = buildMenuMessage(
      [cmd("menu", { category: "general", description: "List commands" })],
      options,
    );

    const button = message.interactiveMessage?.nativeFlowMessage?.buttons?.[0];
    const params = paramsOf(message);

    expect(button?.name).toBe("single_select");
    expect(params.sections[0]?.title).toBe("GENERAL");
    expect(params.sections[0]?.rows[0]).toEqual({
      title: ".menu",
      description: "List commands",
      id: ".menu",
    });
  });

  test("puts the info block above the command list", () => {
    const message = buildMenuMessage(
      [
        cmd("ping", { category: "general" }),
        cmd("warn", { category: "group" }),
      ],
      options,
    );

    expect(message.interactiveMessage?.body?.text).toBe(
      `${info.join("\n")}\n\n❖ *GENERAL* (1)\n▸ *.ping*\n\n❖ *GROUP* (1)\n▸ *.warn*`,
    );
  });

  test("lists every command one per line in the body", () => {
    const message = buildMenuMessage(
      [
        cmd("ping", { category: "general" }),
        cmd("menu", { category: "general" }),
      ],
      options,
    );

    expect(message.interactiveMessage?.body?.text).toContain(
      "❖ *GENERAL* (2)\n▸ *.menu*\n▸ *.ping*",
    );
  });

  test("signs the card in the footer", () => {
    const message = buildMenuMessage([cmd("ping", { category: "general" })], {
      ...options,
    });

    expect(message.interactiveMessage?.footer?.text).toBe("Powered By Seaavey");
  });

  test("wires an uploaded image into the card header when one is given", () => {
    const image = { url: "https://mmg.whatsapp.net/x.enc" };
    const message = buildMenuMessage(
      [cmd("ping", { category: "general" })],
      options,
      image,
    );

    expect(message.interactiveMessage?.header?.hasMediaAttachment).toBe(true);
    expect(message.interactiveMessage?.header?.imageMessage).toEqual(image);
    expect(
      buildMenuMessage([cmd("ping", { category: "general" })], options)
        .interactiveMessage?.header?.hasMediaAttachment,
    ).toBe(false);
  });

  test("splits a category past ten rows into numbered sections", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cmd(`cmd${i}`, { category: "group" }),
    );

    const titles = paramsOf(buildMenuMessage(many, options)).sections.map(
      (section) => section.title,
    );

    expect(titles).toEqual(["GROUP", "GROUP 2"]);
    expect(
      paramsOf(buildMenuMessage(many, options)).sections[1]?.rows,
    ).toHaveLength(2);
  });

  test("puts an alias in the sheet row title", () => {
    const message = buildMenuMessage(
      [cmd("ping", { category: "general", aliases: ["p"] })],
      options,
    );

    expect(paramsOf(message).sections[0]?.rows[0]?.title).toBe(".ping (p)");
    expect(paramsOf(message).sections[0]?.rows[0]?.id).toBe(".ping");
  });

  test("keeps the card body inside the 1024-character WhatsApp budget", () => {
    const names = [
      "groupinfo",
      "setexif",
      "undercover",
      "werewolf",
      "instagram",
      "pinterest",
      "confess",
    ];
    const list = Array.from({ length: 42 }, (_, i) =>
      cmd(`${names[i % names.length]}${i}`, {
        category: names[i % names.length],
      }),
    );

    const body =
      buildMenuMessage(list, options).interactiveMessage?.body?.text ?? "";

    expect(body.length).toBeLessThanOrEqual(1024);
  });

  test("keeps the card body, footer and sheet free of emoji", () => {
    const message = buildMenuMessage(
      [
        cmd("ping", { category: "general" }),
        cmd("kick", { category: "group" }),
      ],
      options,
    );
    const text = [
      message.interactiveMessage?.body?.text,
      message.interactiveMessage?.footer?.text,
      message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
        ?.buttonParamsJson,
    ].join("\n");

    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
