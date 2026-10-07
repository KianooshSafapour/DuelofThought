/**
 * Content moderation: banned-word filter with severity levels.
 * 1 = mask text, 2 = mask + flag for review, 3 = mask + auto-punish escalation.
 * Normalizes Arabic/Persian character variants so filters can't be bypassed
 * with lookalike characters (ي/ی, ك/ک, zero-width joins, repeated letters...).
 */
import { db } from '@/lib/db';

let cache: { words: { word: string; severity: number }[]; at: number } | null = null;
const CACHE_TTL = 30_000;

const EXTRA_HARD = [
  // absolute no-goes regardless of admin list (kept minimal & non-lexical: patterns of abuse)
  'kill yourself', 'kys',
];

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

async function loadWords() {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.words;
  const rows = await db.bannedWord.findMany();
  cache = { words: rows.map((r) => ({ word: r.word, severity: r.severity })), at: Date.now() };
  return cache.words;
}

export interface FilterResult {
  masked: string;
  flagged: boolean;
  words: string[];
  maxSeverity: number; // 0 none, 1..3
}

export async function filterText(input: string): Promise<FilterResult> {
  const words = await loadWords();
  const norm = normalizeText(input);
  const found = new Map<string, number>();
  let masked = input;
  let maxSeverity = 0;

  for (const { word, severity } of words) {
    const w = normalizeText(word);
    if (!w) continue;
    // word-boundary-ish match on normalized text
    const re = new RegExp(`(^|\\s)${escapeRe(w)}($|\\s)`, 'i');
    const contained = re.test(norm) || norm.includes(w);
    if (contained) {
      found.set(word, severity);
      maxSeverity = Math.max(maxSeverity, severity);
      // mask in original text (per character, keep first letter)
      const reAll = new RegExp(escapeRe(word), 'gi');
      masked = masked.replace(reAll, (m) => m[0] + '*'.repeat(Math.max(m.length - 1, 1)));
    }
  }
  const hardHit = EXTRA_HARD.some((h) => norm.includes(h));
  if (hardHit) maxSeverity = 3;

  return { masked, flagged: found.size > 0 || hardHit, words: [...found.keys()], maxSeverity };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function invalidateWordCache() {
  cache = null;
}

/** Validate display inputs (bio, chat names...) — reject control chars & length abuse */
export function sanitizeBio(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 140);
}
