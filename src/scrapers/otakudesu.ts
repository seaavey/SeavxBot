/** otakudesu.blog lists, search and anime detail. Links and text only, no file download. */

import { getText } from "@/scrapers/http";

const BASE = "https://otakudesu.blog";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface OtakuCard {
  title: string;
  slug: string;
  url: string;
  poster: string | null;
  episode: number | null;
  score: number | null;
  day: string | null;
  updated: string | null;
}

export interface OtakuHome {
  ongoing: OtakuCard[];
  complete: OtakuCard[];
}

export interface OtakuList {
  page: number;
  hasNext: boolean;
  items: OtakuCard[];
}

export interface OtakuSearchItem {
  title: string;
  slug: string;
  url: string;
  poster: string | null;
  status: string | null;
  score: number | null;
}

export interface OtakuEpisode {
  title: string;
  url: string;
  released: string | null;
}

export interface OtakuDetail {
  title: string;
  slug: string;
  url: string;
  poster: string | null;
  synopsis: string;
  info: Record<string, string>;
  episodes: OtakuEpisode[];
}

/** WordPress titles carry HTML entities; the tag is stripped, the entity is not. */
function decode(value: string): string {
  return value
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

/** Text of the first match, decoded; "" when the pattern is absent. */
function text(fragment: string, re: RegExp): string {
  return decode(fragment.match(re)?.[1] ?? "");
}

/** One segment per marker, each running to the next marker or the end. */
function segments(html: string, marker: string): string[] {
  return html.split(marker).slice(1);
}

function slugOf(url: string): string {
  return url.replace(/\/+$/, "").split("/").at(-1) ?? "";
}

function intOf(value: string): number | null {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function card(segment: string): OtakuCard | null {
  const url = segment.match(
    /href="(https:\/\/otakudesu\.blog\/anime\/[^"]+)"/,
  )?.[1];
  const title = text(segment, /class="jdlflm">([^<]*)</);
  if (!url || !title) return null;

  const slot = text(segment, /class='epztipe'>[\s\S]*?<\/i>([^<]*)</);
  const score = /^\d+(?:\.\d+)?$/.test(slot) ? Number(slot) : null;

  return {
    title,
    slug: slugOf(url),
    url,
    poster: segment.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null,
    episode: intOf(text(segment, /class='epz'>[\s\S]*?<\/span>([^<]*)</)),
    score,
    day: score === null && slot ? slot : null,
    updated: text(segment, /class="newnime">([^<]*)</) || null,
  };
}

export function parseOtakuHome(html: string): OtakuHome | null {
  let ongoing: OtakuCard[] = [];
  let complete: OtakuCard[] = [];

  for (const block of segments(html, 'class="rapi"')) {
    const heading = text(block, /<h1>([^<]*)</)
      .toLowerCase()
      .replace(/-/g, "");
    const cards = segments(block, "detpost")
      .map(card)
      .filter((item): item is OtakuCard => item !== null);
    if (heading.includes("ongoing")) ongoing = cards;
    else if (heading.includes("complete")) complete = cards;
  }

  return ongoing.length || complete.length ? { ongoing, complete } : null;
}

export function parseOtakuList(html: string, page: number): OtakuList | null {
  const items = segments(html, "detpost")
    .map(card)
    .filter((item): item is OtakuCard => item !== null);
  if (!items.length) return null;
  return { page, hasNext: /class="next page-numbers"/.test(html), items };
}

export function parseOtakuSearch(html: string): OtakuSearchItem[] | null {
  const list = segments(html, 'class="chivsrc"')[0];
  if (!list) return null;

  const items = segments(list, "<li")
    .map((segment): OtakuSearchItem | null => {
      const url = segment.match(
        /href="(https:\/\/otakudesu\.blog\/anime\/[^"]+)"/,
      )?.[1];
      const title = text(segment, /<h2>\s*<a[^>]*>([^<]*)</);
      if (!url || !title) return null;

      const fields: Record<string, string> = {};
      for (const match of segment.matchAll(
        /<b>([^<]*)<\/b>\s*:\s*([\s\S]*?)<\/div>/g,
      )) {
        const value = decode(match[2] ?? "");
        if (value) fields[(match[1] ?? "").trim().toLowerCase()] = value;
      }

      const rating = fields.rating;
      return {
        title,
        slug: slugOf(url),
        url,
        poster: segment.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null,
        status: fields.status ?? null,
        score: rating ? Number.parseFloat(rating) : null,
      };
    })
    .filter((item): item is OtakuSearchItem => item !== null);

  return items.length ? items : null;
}

export function parseOtakuAnime(html: string, url: string): OtakuDetail | null {
  // The h1 ends in an icon <span>; the title text sits before it.
  const title = text(html, /class='jdlrx'>\s*<h1>([^<]*)</);
  if (!title) return null;

  const infoBlock = segments(html, 'class="infozingle"')[0] ?? "";
  const info: Record<string, string> = {};
  for (const match of infoBlock.matchAll(
    /<b>([^<]*)<\/b>:\s*([\s\S]*?)<\/span>/g,
  )) {
    const name = (match[1] ?? "").trim();
    const value = decode(match[2] ?? "");
    if (name && value) info[name] = value;
  }

  const episodeBlock =
    segments(html, 'class="episodelist"').find((block) =>
      text(block, /class="monktit">([\s\S]*?)<\/span>/).includes(
        "Episode List",
      ),
    ) ?? "";

  const episodes = segments(episodeBlock, "<li")
    .map((segment): OtakuEpisode | null => {
      const href = segment.match(
        /href="(https:\/\/otakudesu\.blog\/episode\/[^"]+)"/,
      )?.[1];
      const name = text(segment, /<a[^>]*>([^<]*)</);
      if (!href || !name) return null;
      return {
        title: name,
        url: href,
        released: text(segment, /class='zeebr'[^>]*>([^<]*)</) || null,
      };
    })
    .filter((item): item is OtakuEpisode => item !== null);

  const synopsis = text(
    segments(html, "class='sinopc'>")[0] ?? "",
    /^([\s\S]*?)<\/div>/,
  );

  const poster =
    html.match(/class='fotoanime'[^>]*>\s*<img[^>]*src="([^"]+)"/)?.[1] ?? null;

  return {
    title,
    slug: slugOf(url),
    url,
    poster,
    synopsis,
    info,
    episodes,
  };
}

export async function otakuHome(): Promise<OtakuHome | null> {
  const html = await getText(`${BASE}/`);
  return html ? parseOtakuHome(html) : null;
}

export async function otakuOngoing(page = 1): Promise<OtakuList | null> {
  return listPage("ongoing-anime", page);
}

export async function otakuComplete(page = 1): Promise<OtakuList | null> {
  return listPage("complete-anime", page);
}

export async function otakuSearch(
  query: string,
): Promise<OtakuSearchItem[] | null> {
  const q = query.trim();
  if (!q) return null;
  const html = await getText(
    `${BASE}/?s=${encodeURIComponent(q)}&post_type=anime`,
  );
  return html ? parseOtakuSearch(html) : null;
}

export async function otakuAnime(target: string): Promise<OtakuDetail | null> {
  const slug = target.match(/\/anime\/([a-z0-9-]+)/)?.[1] ?? target.trim();
  if (!SLUG.test(slug)) return null;
  const url = `${BASE}/anime/${slug}/`;
  const html = await getText(url);
  return html ? parseOtakuAnime(html, url) : null;
}

/** Page 1 has no segment: the site answers 301 to the bare archive. */
async function listPage(path: string, page: number): Promise<OtakuList | null> {
  const url = page > 1 ? `${BASE}/${path}/page/${page}/` : `${BASE}/${path}/`;
  const html = await getText(url);
  return html ? parseOtakuList(html, page) : null;
}
