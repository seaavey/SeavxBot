# seavxbot

[![CI](https://github.com/seaavey/SeavxBot/actions/workflows/ci.yml/badge.svg)](https://github.com/seaavey/SeavxBot/actions/workflows/ci.yml)
![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Baileys](https://img.shields.io/badge/engine-Baileys-25D366?logo=whatsapp&logoColor=white)

A lean WhatsApp bot powered by Bun, TypeScript, and `@whiskeysockets/baileys`.

- Multi-device login: pairing code or terminal QR
- Config via `config.toml`, no parser dependency
- Commands pre-loaded into memory, O(1) lookup per message
- Built-in guards: owner, admin, group-only, bot-admin

## Setup

```bash
bun install
cp config.example.toml config.toml   # then set your owner numbers
bun start
```

`config.toml` and `auth_info/` are gitignored: the first holds phone numbers,
the second holds WhatsApp session credentials that grant full access to the
paired account. Never commit either.

## Scripts

```bash
bun start        # run the bot
bun dev          # run with watch mode
bun run test     # run the test suite
bun run typecheck
bun run format        # prettier --write .
bun run format:check  # prettier --check . (what CI enforces)
```

## Running under PM2

```bash
bun add -g pm2          # pm2 is not a project dependency
bun start               # pair once first: the QR/pairing prompt needs a TTY
pm2 start ecosystem.config.cjs
pm2 logs seavxbot
```

`ecosystem.config.cjs` pins the working directory to the repo, so `auth_info/`,
`data/` and `config.toml` resolve however pm2 was launched, and it waits 3 s
before a restart because a new instance that authenticates while the old socket
is still registered gets a 440 close, which the bot does not retry. `bun` must be
on `PATH` for the pm2 daemon, including after `pm2 startup` on boot.

This project was created using `bun init` in bun v1.4.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
