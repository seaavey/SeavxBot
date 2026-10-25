import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commands, getCommand, loadCommands } from "@/lib/core/commandLoader";

const source = (name: string) =>
  `export default { name: "${name}", description: "${name}", run() {} };\n`;

function fixture(layout: Record<string, string[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commands-"));
  for (const [folder, names] of Object.entries(layout)) {
    const dir = folder ? path.join(root, folder) : root;
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) {
      fs.writeFileSync(path.join(dir, `${name}.ts`), source(name));
    }
  }
  return root;
}

test("loads a command from every category folder", async () => {
  await loadCommands(fixture({ alpha: ["one"], beta: ["two"] }));

  expect(commands.size).toBe(2);
  expect(getCommand("one")?.category).toBe("alpha");
  expect(getCommand("two")?.category).toBe("beta");
});

test("loads a file outside a category folder without a category", async () => {
  await loadCommands(fixture({ "": ["loose"], alpha: ["one"] }));

  expect(getCommand("loose")?.category).toBeUndefined();
  expect(getCommand("one")?.category).toBe("alpha");
});

test("a second load replaces the previous set", async () => {
  await loadCommands(fixture({ alpha: ["one"] }));
  await loadCommands(fixture({ beta: ["two"] }));

  expect(commands.size).toBe(1);
  expect(getCommand("one")).toBeUndefined();
  expect(getCommand("two")?.name).toBe("two");
});

test("a nested folder keeps the outer category", async () => {
  const root = fixture({ group: [] });
  fs.mkdirSync(path.join(root, "group/sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "group/sub/deep.ts"), source("deep"));

  await loadCommands(root);

  expect(getCommand("deep")?.category).toBe("group");
});
