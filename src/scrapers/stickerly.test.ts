import { describe, expect, test } from "bun:test";
import {
  parseStickerlyFeatured,
  parseStickerlyPack,
  stickerlyPack,
  stickerlyPattern,
} from "@/scrapers/stickerly";

const CDN = "https://stickerly.pstatic.net/sticker_pack";

/** Trimmed from `https://sticker.ly/s/759AUB`: two stickers whose primary src
 *  is `.webp`, and one related card whose maker is empty. */
const PACK = `<div class="sticker_area_info">
  <div class="sticker_name"><strong class="this_text"><span>3D Emoji</span></strong></div>
  <span class="sticker_author">chocolate</span>
</div>
<ul id="content_images" class="sticker_area">
  <li><img src="${CDN}/13279e882d3a25af/759AUB/2/aaa-001.webp" alt="" class="sticker_img" onerror="this.onerror=null;this.src=&#39;${CDN}/13279e882d3a25af/759AUB/2/aaa-001.png&#39;;"/></li>
  <li><img src="${CDN}/13279e882d3a25af/759AUB/2/aaa-002.webp" alt="" class="sticker_img" onerror="this.onerror=null;this.src=&#39;${CDN}/13279e882d3a25af/759AUB/2/aaa-002.png&#39;;"/></li>
</ul>
<div class="section_top_stickers">
  <ul class="area_stickers_list">
    <li class="card">
      <a href="https://ahx4.adj.st/pack/8SANSX?adj_t=1jftcnhe" class="card_inner">
        <dl class="area_box_text">
          <dt class="blind">pack name</dt>
          <dd class="this_name_pack">reaction tiktok meme</dd>
          <dt class="blind">maker name</dt>
          <dd class="this_name_maker"></dd>
        </dl>
        <ul class="area_box_image">
          <li><img src="${CDN}/Wr7jVgeK23fpOpLlf33IA/8SANSX/23/1780893567745.webp" alt="" class="sticker_img" onerror="this.onerror=null;this.src=&#39;${CDN}/Wr7jVgeK23fpOpLlf33IA/8SANSX/23/1780893567745.png&#39;;"/></li>
        </ul>
      </a>
    </li>
  </ul>
</div>`;

/** Trimmed from `https://sticker.ly/`: the pack code comes from the CDN path. */
const LANDING = `<div class="rolling_unit"><div class="sticker_pack">
  <strong class="name">Animals</strong>
  <span class="author">meoow</span>
  <ul class="sticker_list">
    <li class="item"><img src="${CDN}/13279e882d3a25af/WTKUQD/2/211edb15.png" alt="Animals"></li>
  </ul>
</div></div>
<div class="rolling_unit"><div class="sticker_pack">
  <strong class="name">Muah💋</strong>
  <span class="author">Vanessa Kim</span>
  <ul class="sticker_list">
    <li class="item"><img src="${CDN}/owner/1MO5C7/3/y.png" alt=""></li>
  </ul>
</div></div>`;

describe("parseStickerlyPack", () => {
  test("reads the title, author and stickers from the share page", () => {
    const pack = parseStickerlyPack(PACK);

    expect(pack?.code).toBe("759AUB");
    expect(pack?.title).toBe("3D Emoji");
    expect(pack?.author).toBe("chocolate");
    expect(pack?.stickers).toEqual([
      `${CDN}/13279e882d3a25af/759AUB/2/aaa-001.png`,
      `${CDN}/13279e882d3a25af/759AUB/2/aaa-002.png`,
    ]);
    expect(pack?.cover).toBe(pack?.stickers[0]);
  });

  test("related cards keep the code and drop an empty maker", () => {
    const pack = parseStickerlyPack(PACK);

    expect(pack?.related).toHaveLength(1);
    expect(pack?.related[0]?.code).toBe("8SANSX");
    expect(pack?.related[0]?.title).toBe("reaction tiktok meme");
    expect(pack?.related[0]?.author).toBeNull();
  });

  test("a body without pack markers is null", () => {
    expect(parseStickerlyPack("")).toBeNull();
    // An unknown code 302s to the landing page, which carries no pack block.
    expect(parseStickerlyPack(LANDING)).toBeNull();
  });
});

describe("parseStickerlyFeatured", () => {
  test("reads the featured cards with the code from the CDN path", () => {
    const cards = parseStickerlyFeatured(LANDING);

    expect(cards).toHaveLength(2);
    expect(cards?.[0]).toEqual({
      code: "WTKUQD",
      title: "Animals",
      author: "meoow",
      cover: `${CDN}/13279e882d3a25af/WTKUQD/2/211edb15.png`,
    });
    expect(cards?.[1]?.title).toBe("Muah💋");
    expect(cards?.[1]?.code).toBe("1MO5C7");
  });

  test("a body without a featured card is null", () => {
    expect(parseStickerlyFeatured("")).toBeNull();
    expect(parseStickerlyFeatured(PACK)).toBeNull();
  });
});

describe("stickerlyPattern", () => {
  test("matches a share link on any host form and captures the code", () => {
    expect("https://sticker.ly/s/759aub".match(stickerlyPattern)?.[1]).toBe(
      "759aub",
    );
    expect("https://www.sticker.ly/s/8SANSX".match(stickerlyPattern)?.[1]).toBe(
      "8SANSX",
    );
  });

  test("ignores a non-share path", () => {
    expect(stickerlyPattern.test("https://sticker.ly/short")).toBe(false);
    expect(stickerlyPattern.test("https://sticker.ly/s/ABCDEFG")).toBe(false);
  });
});

describe("stickerlyPack", () => {
  test("rejects a malformed target without a request", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;

    try {
      expect(await stickerlyPack("not a code!")).toBeNull();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
