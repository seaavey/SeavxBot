import { describe, expect, test } from "bun:test";
import { parsePinterestHtml, pinterestPattern } from "@/scrapers/pinterest";

const ORIGINALS =
  "https://i.pinimg.com/originals/71/99/19/71991933976381fe74b6a438947b4fc8.jpg";
const HASH = "93eac58ec388976dc1843ba486d333d8";
const OWN_MP4 = `https://v1.pinimg.com/videos/iht/expMp4/93/ea/c5/${HASH}_720w.mp4`;
const FOREIGN_MP4 = "https://v1.pinimg.com/videos/iht/other/related.mp4";

/** Fixtures go through JSON.stringify so the parser reads the bytes a page
 *  serves, not a hand-written approximation. */
const page = (...scripts: string[]) => `<html><head>${scripts.join("")}</head>`;

const ld = (block: object) =>
  `<script type="application/ld+json">${JSON.stringify(block)}</script>`;

const post = (overrides: object = {}) => ({
  "@type": "SocialMediaPosting",
  headline: "senja",
  image: ORIGINALS,
  author: { name: "mrs. k", alternateName: "krstwhy" },
  ...overrides,
});

describe("parsePinterestHtml", () => {
  test("image pin yields the originals image", () => {
    const media = parsePinterestHtml(page(ld(post())));

    expect(media?.items).toEqual([
      { url: ORIGINALS, kind: "image", mimetype: "image/jpeg" },
    ]);
    expect(media?.caption).toBe("@krstwhy — senja");
  });

  test("video pin picks the mp4 carrying the thumbnail hash", () => {
    const media = parsePinterestHtml(
      page(
        ld(post()),
        ld({
          "@type": "VideoObject",
          thumbnailUrl: `https://i.pinimg.com/videos/thumbnails/originals/93/ea/c5/${HASH}.0000000.jpg`,
        }),
        // A related pin's file is listed first, so a hash-blind match fails.
        `<script>var related = "${FOREIGN_MP4}"; var own = "${OWN_MP4}";</script>`,
      ),
    );

    expect(media?.items).toEqual([
      { url: OWN_MP4, kind: "video", mimetype: "video/mp4" },
    ]);
  });

  test("a page without ld+json yields null", () => {
    expect(parsePinterestHtml("<html></html>")).toBeNull();
  });
});

describe("pinterestPattern", () => {
  test("matches a locale host and ignores other sites", () => {
    expect(
      pinterestPattern.test("https://id.pinterest.com/pin/123/"),
    ).toBeTrue();
    expect(pinterestPattern.test("https://example.com/pin/123/")).toBeFalse();
  });
});
