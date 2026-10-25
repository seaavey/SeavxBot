/** sticker.ly share pages: one pack of up to nine stickers, plus the landing
 *  page's six featured packs. Keyword search exists in the app only. */

import { getText } from "@/scrapers/http";

const BASE = "https://sticker.ly";
const CODE = /^[A-Za-z0-9]{6}$/;

export const stickerlyPattern =
  /https?:\/\/(?:www\.)?sticker\.ly\/s\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/i;

export interface StickerlyCard {
  code: string;
  title: string;
  author: string | null;
  cover: string;
}

export interface StickerlyPack extends StickerlyCard {
  stickers: string[];
  related: StickerlyCard[];
}

/** Titles carry emoji and the odd entity; strip tags, collapse, decode. */
function decode(value: string): string {
  return value
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function text(fragment: string, re: RegExp): string {
  return decode(fragment.match(re)?.[1] ?? "");
}

/** The pack code sits in the CDN path: /sticker_pack/<owner>/<CODE>/<ver>/. */
function codeOf(fragment: string): string | null {
  return fragment.match(/sticker_pack\/[^/]+\/([A-Za-z0-9]{6})\//)?.[1] ?? null;
}

/** One card from a related-pack block or the landing page. */
function card(segment: string, code: string | null): StickerlyCard | null {
  const title = text(segment, /class="(?:this_name_pack|name)">([^<]*)</);
  const cover = segment.match(/<img[^>]*src="([^"]+)"/)?.[1];
  if (!title || !cover || !code) return null;
  return {
    code,
    title,
    author:
      text(segment, /class="(?:this_name_maker|author)">([^<]*)</) || null,
    cover,
  };
}

export function parseStickerlyPack(html: string): StickerlyPack | null {
  const title = text(html, /class="sticker_name">[\s\S]*?<span>([^<]*)</);
  const block = html.split('id="content_images"')[1]?.split("</ul>")[0] ?? "";

  // The primary src is .webp and 404s on packs whose CDN kept only png; the
  // onerror value is the URL the page itself falls back to.
  const stickers = [
    ...block.matchAll(/onerror="[^"]*?this\.src=(?:&#39;|')([^'"&]+)/g),
  ]
    .map((match) => decode(match[1] ?? ""))
    .filter(Boolean);

  if (!title || !stickers.length) return null;

  const relatedBlock = html.split('class="section_top_stickers"')[1] ?? "";
  const related = relatedBlock
    .split('<li class="card">')
    .slice(1)
    .map((segment) => {
      const code =
        segment.match(/pack\/([A-Za-z0-9]{6})/)?.[1] ?? codeOf(segment);
      return card(segment, code ?? null);
    })
    .filter((item): item is StickerlyCard => item !== null);

  return {
    code: codeOf(block) ?? "",
    title,
    author: text(html, /class="sticker_author">([^<]*)</) || null,
    cover: stickers[0] ?? "",
    stickers,
    related,
  };
}

export function parseStickerlyFeatured(html: string): StickerlyCard[] | null {
  const cards = html
    .split('class="sticker_pack"')
    .slice(1)
    .map((segment) => card(segment, codeOf(segment)))
    .filter((item): item is StickerlyCard => item !== null);
  return cards.length ? cards : null;
}

export async function stickerlyPack(
  target: string,
): Promise<StickerlyPack | null> {
  const code = (
    target.match(/\/s\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/)?.[1] ?? target.trim()
  ).toUpperCase();
  if (!CODE.test(code)) return null;
  const html = await getText(`${BASE}/s/${code}`);
  const pack = html ? parseStickerlyPack(html) : null;
  return pack ? { ...pack, code } : null;
}

export async function stickerlyFeatured(): Promise<StickerlyCard[] | null> {
  const html = await getText(`${BASE}/`);
  return html ? parseStickerlyFeatured(html) : null;
}
