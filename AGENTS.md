# SeavxBot

WhatsApp bot on Bun + TypeScript + Baileys (`@whiskeysockets/baileys`). `src/index.ts` owns the socket lifecycle only; `src/lib/message/dispatch.ts` runs the per-message pipeline (parse → antilink → user tracking → guards → command). Commands are one file per command, auto-loaded from `src/commands/`; settings come from `config.toml`, per-group state from SQLite via `bun:sqlite`.

## Feature workflow

A feature follows: spec → owner verdict (approve / revise / reject) → plan → owner verdict → one subagent per task → ledger + signatures. Artifacts live in `.superpowers/` (gitignored): `specs/YYYY-MM-DD-<topic>-design.md`, `plans/YYYY-MM-DD-<feature>.md`, `sdd/<plan>/progress.md`, `ttd/<slug>/<role>/SIGNATURE.md`. Each verdict is asked with the clarify tool (`Approve` / `Revise` / `Reject`; a revise or reject must state why). No code before the spec is approved, no dispatch before the plan is approved. Full gates and the signature template: `seavxbot` skill, `references/feature-workflow.md`.

## Setup

    bun install
    cp config.example.toml config.toml   # then set owners[]
    bun start

`bun start` pairs a real WhatsApp account (QR or pairing code). Treat it as a production action, not a smoke test.

## Build & checks

    bun start             # run the bot
    bun dev               # --watch; restarts the whole socket on save
    bun run test          # bun test, 250 cases across 23 colocated *.test.ts files
    bun run typecheck     # bun check (Bun's checker, not tsc)
    bun run format        # prettier --write .
    bun run format:check  # what CI enforces

CI (`.github/workflows/ci.yml`) pins Bun 1.4.3 and runs `bun install --frozen-lockfile`, `format:check`, `typecheck` on push/PR to main. It does not run the tests.

## Layout

- `src/index.ts` — auth prompt, socket, reconnect, Baileys event wiring.
- `src/lib/message/dispatch.ts` — the inbound pipeline for one message.
- `src/lib/core/config.ts` — the only reader of `config.toml` and `SEAVXBOT_DB_PATH`; exports resolved values, so other modules never touch a raw config object.
- `src/commands/<category>-<name>.ts` — one command per file.
- `src/lib/<domain>/` — one concept per file, grouped by domain: `core/` (config, db, logger, commandLoader, types), `message/` (dispatch, parseMessage, messageContent, permissions, identity, mentions), `media/` (mediaSource, imageSource, mediaMessages, ffmpeg, webp, extractUrl), `group/` (group, groupCache, greeting, userSync, antilink, settings), `user/` (users, profile), `games/<name>/` (one folder per game, `index.ts` is the engine: `undercover/` has `index.ts`, `word.ts`, `rules.ts`, `store.ts`).
- `src/scrapers/*.ts` — one module per platform; shared `getText`/`getJson` from `scrapers/http.ts` return `null` on failure instead of throwing.

## Adding a command

`src/commands/general-ping.ts` is the template:

    export const pingCommand: Command = {
      name: "ping",
      description: "Check bot response time",
      aliases: ["p"],
      groupOnly: true,
      adminOnly: true,
      botAdminOnly: true,
      ownerOnly: true,
      run: async ({ sock, msg, reply, react }) => {
        await reply("pong!");
      },
    };

    export default pingCommand;

- The filename is irrelevant: `loadCommands()` keys on `name` (lowercased) plus `aliases`, skips `.test.`/`.spec.` files, and silently drops a module without `name` and a `run` function.
- No `*.test.ts` inside `src/commands/`: command logic that needs a test lives in `src/lib/` with the test beside it.
- Declare access with the flags and let `denyReason()` in `dispatch.ts` enforce them; do not re-check permissions inside `run`.
- `reply()` quotes the trigger message and turns phone numbers in the text into @tags; pass an `AnyMessageContent` object for media. `react()` swallows failures by design.
- A thrown error is logged, answered with `guardMessages.error`, and nothing else — a specific user-facing failure needs its own reply.
- `msg` is `ParsedMessage`: `body`, `text`, `args`, `command`, `prefix`, `isCmd`, `isGroup`, `isOwner`, `isAdmin`, `isBotAdmin`, `senderJid`, `senderLid`, `chatJid`, `key`, `raw`, `quoted`, `mentions`, `groupMetadata`, `device`, `messageTimestamp`.

## Conventions

- Import through the `@/` alias (`@/lib/types`), not deep relative paths. tsconfig has no `baseUrl` — TS7 rejects it.
- `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on: type-only imports must use `import type`.
- Prettier: double quotes, semicolons, trailing commas, 80 columns.
- Comments explain the why — which Baileys/WhatsApp behaviour forced the code — one line, never restating what the line does.
- SQL lives beside its store (`SETTINGS_TABLE_SQL` in `settings.ts`, `USERS_TABLE_SQL` in `users.ts`). Migrations bump `SCHEMA_VERSION` in `db.ts` and add `if (version < N) db.exec(...)`; never edit shipped migration steps.
- Stored settings are validated per field on read; an unparseable row falls back to the default instead of breaking the group.
- User-facing text comes from `config.toml`/`guardMessages` with a hardcoded fallback in `config.ts`.
- Commits: conventional subject (`feat:`, `refactor:`, `ci:`, `style:`, `docs:`) stating what the change does, plus a body explaining why; English.

## Pitfalls

- `src/lib/core/config.ts` imports `config.toml` in a top-level await. Without it, every entry point — including a test that transitively imports config — dies with "Missing config.toml".
- `config.toml`, `auth_info/`, `data/`, `logs/`, `.superpowers/` are gitignored. `auth_info/` is a live WhatsApp session: deleting it forces re-pairing, and it must never be committed, printed, or copied.
- Default DB is `data/seavxbot.db`, the live bot's. Set `SEAVXBOT_DB_PATH` to a scratch file for tests and one-off scripts.
- `ffmpeg` must be on `PATH` for `.tomp4`, `.tomp3`, `.toimage` and the image commands — they shell out to it with a 30 s timeout.
- Two instances fight over `auth_info/`; stop the running bot before `bun start`/`bun dev` in another terminal.
- Bun-only APIs throughout (`bun:sqlite`, `Bun.spawn`, `Bun.write`, TOML import): this does not run under Node.
