import type { Database } from "bun:sqlite";

export interface StickerPack {
  pack: string;
  author: string;
}

export const BOT_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS bot_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
`;

export function createStickerPackStore(
  db: Database,
  defaults: StickerPack,
): { get(): StickerPack; set(key: keyof StickerPack, value: string): void } {
  const base = { ...defaults };
  const select = db.query<{ key: string; value: string }, []>(
    "SELECT key, value FROM bot_settings",
  );
  const upsert = db.query<unknown, [string, string]>(
    `INSERT INTO bot_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  function get(): StickerPack {
    const pack = { ...base };
    for (const row of select.all()) {
      if (row.key === "pack" || row.key === "author") {
        pack[row.key] = row.value;
      }
    }
    return pack;
  }

  function set(key: keyof StickerPack, value: string): void {
    upsert.run(key, value);
  }

  return { get, set };
}

/** The store the factory returns; no separate interface to keep in sync. */
export type StickerPackStore = ReturnType<typeof createStickerPackStore>;

export function injectStickerExif(webp: Buffer, pack: StickerPack): Buffer {
  if (
    webp.toString("ascii", 0, 4) !== "RIFF" ||
    webp.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Expected a RIFF WebP buffer");
  }

  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": "seaaveybot",
      "sticker-pack-name": pack.pack,
      "sticker-pack-publisher": pack.author,
      emojis: ["✨"],
    }),
    "utf8",
  );
  const tiff = Buffer.alloc(22);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x5741, 10);
  tiff.writeUInt16LE(7, 12);
  tiff.writeUInt32LE(json.length, 14);
  tiff.writeUInt32LE(22, 18);

  const payload = Buffer.concat([tiff, json]);
  const chunk = Buffer.alloc(8 + payload.length + (payload.length & 1));
  chunk.write("EXIF", 0, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);

  let insertAt = 12;
  for (let offset = 12; offset + 8 <= webp.length;) {
    const length = webp.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length & 1);
    if (end > webp.length) throw new Error("Invalid WebP chunk length");
    if (webp.toString("ascii", offset, offset + 4) === "VP8X") {
      insertAt = end;
      break;
    }
    offset = end;
  }

  const result = Buffer.concat([
    webp.subarray(0, insertAt),
    chunk,
    webp.subarray(insertAt),
  ]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
