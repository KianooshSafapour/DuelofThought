/**
 * Local chat moderation for the duel-socket service.
 *
 * Mirrors the normalization of src/lib/moderation.ts so Arabic/Persian
 * lookalike characters can't bypass the filter. The word list is fetched
 * from Next (`GET /api/mp/words` with the internal key) at startup and
 * every 60s; a small built-in English/Persian fallback list is ALWAYS
 * active (merged with the fetched list, max severity wins) so the service
 * works even when the Next server is down.
 */

export interface WordEntry {
  word: string;
  severity: number; // 1 = mask, 2 = mask+flag, 3 = block+auto-punish
}

/** Always-on basics (includes moderation.ts's EXTRA_HARD items). */
const BUILTIN_WORDS: WordEntry[] = [
  { word: 'fuck', severity: 3 },
  { word: 'bitch', severity: 3 },
  { word: 'asshole', severity: 3 },
  { word: 'cunt', severity: 3 },
  { word: 'bastard', severity: 2 },
  { word: 'shit', severity: 2 },
  { word: 'dick', severity: 2 },
  { word: 'kys', severity: 3 },
  { word: 'kill yourself', severity: 3 },
  { word: 'idiot', severity: 1 },
  { word: 'stupid', severity: 1 },
  { word: 'noob', severity: 1 },
  // Persian basics
  { word: 'کیر', severity: 3 },
  { word: 'کون', severity: 3 },
  { word: 'کص', severity: 3 },
  { word: 'جنده', severity: 3 },
  { word: 'کسکش', severity: 3 },
  { word: 'حرومزاده', severity: 2 },
  { word: 'بی‌شعور', severity: 2 },
  { word: 'احمق', severity: 1 },
  { word: 'خنگ', severity: 1 },
  { word: 'عوضی', severity: 1 },
];

let fetched: WordEntry[] = [];
let merged: { word: string; norm: string; severity: number }[] | null = null;

/** Same normalization as src/lib/moderation.ts. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '') // zero-width & bidi controls
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ۀ|ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[\u064b-\u065f\u0670]/g, '') // arabic diacritics
    .replace(/(.)\1{2,}/g, '$1$1') // collapse 3+ repeats to 2
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** char -> character class covering its Arabic/Persian lookalikes */
const VARIANT_OF: Record<string, string> = {
  'ك': '[كک]', 'ک': '[كک]',
  'ي': '[يیى]', 'ی': '[يیى]', 'ى': '[يیى]',
  'أ': '[أإآٱا]', 'إ': '[أإآٱا]', 'آ': '[أإآٱا]', 'ٱ': '[أإآٱا]', 'ا': '[أإآٱا]',
  'ۀ': '[ۀةه]', 'ة': '[ۀةه]', 'ه': '[ۀةه]',
  'ؤ': '[ؤو]', 'و': '[ؤو]',
};

function variantPattern(word: string): string {
  let p = '';
  for (const ch of word) p += VARIANT_OF[ch] ?? escapeRe(ch);
  return p;
}

function rebuild() {
  const map = new Map<string, { word: string; norm: string; severity: number }>();
  const add = (w: WordEntry) => {
    if (!w || typeof w.word !== 'string') return;
    const norm = normalizeText(w.word);
    if (!norm) return;
    const sev = Math.max(0, Math.min(3, Math.floor(Number(w.severity) || 0)));
    const prev = map.get(norm);
    if (!prev || (sev || 1) > prev.severity) map.set(norm, { word: w.word, norm, severity: sev || 1 });
  };
  for (const w of BUILTIN_WORDS) add(w);
  for (const w of fetched) add(w);
  merged = [...map.values()];
}

export function getWordList(): { word: string; norm: string; severity: number }[] {
  if (!merged) rebuild();
  return merged!;
}

export interface FilterResult {
  masked: string;
  flaggedWords: string[];
  severity: number; // 0 = clean, 1..3
}

/** Synchronous filter over the cached word list. A word matches when the
 *  normalized text contains the normalized word. Masked occurrences keep
 *  their first character followed by asterisks. */
export function filterText(input: string): FilterResult {
  const norm = normalizeText(input);
  let masked = input;
  let severity = 0;
  const flaggedWords: string[] = [];
  for (const w of getWordList()) {
    if (!norm.includes(w.norm)) continue;
    flaggedWords.push(w.word);
    severity = Math.max(severity, w.severity);
    try {
      const re = new RegExp(variantPattern(w.word), 'gi');
      masked = masked.replace(re, (m) => m[0] + '*'.repeat(Math.max(m.length - 1, 1)));
    } catch {
      /* defensive: never let a bad pattern break chat */
    }
  }
  return { masked, flaggedWords, severity };
}

/** Pull the admin-managed word list from Next. Safe to call when Next is down. */
export async function refreshWords(nextBase: string, internalKey: string): Promise<void> {
  try {
    const res = await fetch(`${nextBase}/api/mp/words`, {
      headers: { 'x-internal-key': internalKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: unknown = await res.json().catch(() => null);
    const words = (j as { words?: unknown } | null)?.words;
    if (Array.isArray(words)) {
      fetched = words
        .map((w) => w as { word?: unknown; severity?: unknown })
        .filter((w) => typeof w.word === 'string' && (w.word as string).length > 0)
        .map((w) => ({ word: String(w.word), severity: Number(w.severity) || 1 }));
      rebuild();
      console.log(`[moderation] word list refreshed (${fetched.length} from Next + ${BUILTIN_WORDS.length} builtin)`);
    }
  } catch (e) {
    console.warn(`[moderation] word refresh failed (${(e as Error).message}) — built-in list still active`);
  }
}
