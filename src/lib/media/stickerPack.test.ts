import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS_TABLE_SQL,
  createStickerPackStore,
  injectStickerExif,
  type StickerPack,
} from "@/lib/media/stickerPack";

function chunk(name: string, payload: Buffer): Buffer {
  const result = Buffer.alloc(8 + payload.length + (payload.length & 1));
  result.write(name, 0, "ascii");
  result.writeUInt32LE(payload.length, 4);
  payload.copy(result, 8);
  return result;
}

function webp(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const result = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), body]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

function chunkNames(buffer: Buffer): string[] {
  const names: string[] = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    names.push(buffer.toString("ascii", offset, offset + 4));
    const length = buffer.readUInt32LE(offset + 4);
    offset += 8 + length + (length & 1);
  }
  return names;
}

function stickerExif(buffer: Buffer): { chunk: Buffer; json: unknown } {
  const offset = buffer.indexOf("EXIF", 12, "ascii");
  const length = buffer.readUInt32LE(offset + 4);
  const payload = buffer.subarray(offset + 8, offset + 8 + length);
  return {
    chunk: payload,
    json: JSON.parse(payload.toString("utf8", 22)),
  };
}

describe("sticker pack store", () => {
  test("uses defaults, persists overrides, and returns copies", () => {
    const db = new Database(":memory:");
    db.exec(BOT_SETTINGS_TABLE_SQL);
    const defaults: StickerPack = { pack: "Default", author: "Bot" };
    const store = createStickerPackStore(db, defaults);

    expect(store.get()).toEqual(defaults);
    store.set("pack", "Custom");
    expect(store.get()).toEqual({ pack: "Custom", author: "Bot" });

    const result = store.get();
    result.author = "Changed outside";
    expect(store.get().author).toBe("Bot");
    db.close();
  });
});

describe("injectStickerExif", () => {
  const pack = { pack: "Pack name", author: "Publisher" };
  const vp8x = chunk("VP8X", Buffer.alloc(10));
  const alph = chunk("ALPH", Buffer.from([1, 2, 3]));
  const vp8 = chunk("VP8 ", Buffer.from([4, 5]));

  test("inserts EXIF after VP8X and updates RIFF size", () => {
    const result = injectStickerExif(webp(vp8x, alph, vp8), pack);
    const exif = stickerExif(result);

    expect(chunkNames(result)).toEqual(["VP8X", "EXIF", "ALPH", "VP8 "]);
    expect(result.readUInt32LE(4)).toBe(result.length - 8);
    expect(exif.chunk.readUInt16LE(10)).toBe(0x5741);
    expect(exif.chunk.readUInt16LE(12)).toBe(7);
    expect(exif.chunk.readUInt32LE(14)).toBe(exif.chunk.length - 22);
    expect(exif.chunk.readUInt32LE(18)).toBe(22);
    expect(exif.json).toEqual({
      "sticker-pack-id": "seaaveybot",
      "sticker-pack-name": "Pack name",
      "sticker-pack-publisher": "Publisher",
      emojis: ["✨"],
    });
  });

  test("inserts at offset 12 when VP8X is absent", () => {
    const result = injectStickerExif(webp(alph, vp8), pack);
    expect(chunkNames(result)).toEqual(["EXIF", "ALPH", "VP8 "]);
    expect(result.readUInt32LE(4)).toBe(result.length - 8);
  });

  test("rejects buffers without a RIFF WebP signature", () => {
    expect(() => injectStickerExif(Buffer.from("not a webp"), pack)).toThrow(
      "Expected a RIFF WebP buffer",
    );
  });
});
