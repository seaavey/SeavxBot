/** Canonical form and clue rules for the Undercover word bank. */

/** A leading or trailing run of punctuation and whitespace, Unicode-wide. */
export const EDGE_PUNCTUATION =
  /^[\p{P}\p{White_Space}]+|[\p{P}\p{White_Space}]+$/gu;

const WHITESPACE = /\p{White_Space}+/gu;

const MIN_WORD_CODE_POINTS = 1;
const MAX_WORD_CODE_POINTS = 40;

export interface WordPair {
  id: string;
  civilian: string;
  undercover: string;
}

/**
 * The one comparison form. NFKC first so compatibility forms fold, lowercase
 * second so case never matters, then the edge punctuation the reference
 * algorithm strips; internal punctuation and symbols stay, so `ice-cream` and
 * `$kopi$` remain distinct words.
 *
 * This is `toLowerCase()`: Unicode-aware and locale-independent, but not full
 * case folding — `Straße` and `STRASSE` do not meet here.
 */
export function normalizeSecretWord(input: string): string {
  if (typeof input !== "string") return "";

  let value = input.normalize("NFKC").toLowerCase().normalize("NFKC");
  value = value.replace(WHITESPACE, " ").trim();
  value = value.replace(EDGE_PUNCTUATION, "");
  value = value.normalize("NFKC").replace(WHITESPACE, " ").trim();

  return value;
}

/**
 * The clue's words: whitespace-split, each normalized, punctuation-only pieces
 * dropped. The 3-word limit and the leak check both count these, so `kopi !!!`
 * is one word, not two.
 */
export function clueTokens(text: string): string[] {
  if (typeof text !== "string") return [];

  return text
    .replace(WHITESPACE, " ")
    .trim()
    .split(" ")
    .map(normalizeSecretWord)
    .filter((token) => token.length > 0);
}

export function clueWordCount(text: string): number {
  return clueTokens(text).length;
}

/**
 * True when the clue holds the secret as a run of whole words. Substrings do
 * not count: `es-teh` is one word and does not contain `es teh`.
 */
export function containsSecret(text: string, secret: string): boolean {
  const words = clueTokens(text);
  const target = clueTokens(secret);
  if (words.length === 0 || target.length === 0) return false;
  if (target.length > words.length) return false;

  for (let start = 0; start <= words.length - target.length; start += 1) {
    const found = target.every(
      (token, offset) => words[start + offset] === token,
    );
    if (found) return true;
  }

  return false;
}

/** Word pairs that fit the game: related, short, and never identical. */
const PAIRS: readonly WordPair[] = [
  { id: "kopi-teh", civilian: "Kopi", undercover: "Teh" },
  { id: "es-teh-air-jeruk", civilian: "Es Teh", undercover: "Air Jeruk" },
  {
    id: "nasi-goreng-mie-goreng",
    civilian: "Nasi Goreng",
    undercover: "Mie Goreng",
  },
  { id: "bakso-soto", civilian: "Bakso", undercover: "Soto" },
  { id: "sepeda-motor", civilian: "Sepeda", undercover: "Motor" },
  { id: "kucing-anjing", civilian: "Kucing", undercover: "Anjing" },
  { id: "hujan-gerimis", civilian: "Hujan", undercover: "Gerimis" },
  { id: "bulan-matahari", civilian: "Bulan", undercover: "Matahari" },
  { id: "pantai-gunung", civilian: "Pantai", undercover: "Gunung" },
  { id: "buku-majalah", civilian: "Buku", undercover: "Majalah" },
  { id: "pensil-pulpen", civilian: "Pensil", undercover: "Pulpen" },
  { id: "dokter-perawat", civilian: "Dokter", undercover: "Perawat" },
  { id: "bus-kereta", civilian: "Bus", undercover: "Kereta" },
  { id: "apel-jeruk", civilian: "Apel", undercover: "Jeruk" },
  { id: "gula-madu", civilian: "Gula", undercover: "Madu" },
  { id: "garam-micin", civilian: "Garam", undercover: "Micin" },
  { id: "sate-martabak", civilian: "Sate", undercover: "Martabak" },
  { id: "kipas-angin-ac", civilian: "Kipas Angin", undercover: "AC" },
  { id: "baju-kemeja", civilian: "Baju", undercover: "Kemeja" },
  { id: "sepatu-sandal", civilian: "Sepatu", undercover: "Sandal" },
  { id: "gunting-pisau", civilian: "Gunting", undercover: "Pisau" },
  { id: "sungai-danau", civilian: "Sungai", undercover: "Danau" },
  { id: "padi-jagung", civilian: "Padi", undercover: "Jagung" },
  { id: "ayam-bebek", civilian: "Ayam", undercover: "Bebek" },
  { id: "susu-yoghurt", civilian: "Susu", undercover: "Yoghurt" },
  { id: "kue-roti", civilian: "Kue", undercover: "Roti" },
];

const codePoints = (value: string): number => [...value].length;

/** A pair survives only if both words normalize, fit the cap, and differ. */
function isValidPair(pair: WordPair): boolean {
  const civilian = normalizeSecretWord(pair.civilian);
  const undercover = normalizeSecretWord(pair.undercover);
  const fits = (word: string): boolean =>
    codePoints(word) >= MIN_WORD_CODE_POINTS &&
    codePoints(word) <= MAX_WORD_CODE_POINTS;

  return fits(civilian) && fits(undercover) && civilian !== undercover;
}

export const WORD_PAIRS: readonly WordPair[] = PAIRS.filter(isValidPair);

/** Uniform pick; `avoidId` is skipped while another pair remains. */
export function pickFrom(
  pairs: readonly WordPair[],
  random: () => number,
  avoidId?: string | null,
): WordPair | null {
  if (pairs.length === 0) return null;

  const remaining = avoidId
    ? pairs.filter((pair) => pair.id !== avoidId)
    : pairs;
  const pool = remaining.length > 0 ? remaining : pairs;
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length)),
  );

  return pool[index] ?? null;
}

export function pickWordPair(
  random: () => number,
  avoidId?: string | null,
): WordPair | null {
  return pickFrom(WORD_PAIRS, random, avoidId);
}
