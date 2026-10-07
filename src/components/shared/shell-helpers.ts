/** Shared shell helpers: locale list/metadata + XP curve (client mirror of content.ts) */
import { Locale } from '@/lib/i18n';

export const LOCALES: Locale[] = ['fa', 'en', 'ar', 'tr'];

export const LOCALE_META: Record<Locale, { label: string; dir: 'rtl' | 'ltr'; flag: string }> = {
  fa: { label: 'فارسی', dir: 'rtl', flag: '🇮🇷' },
  en: { label: 'English', dir: 'ltr', flag: '🇬🇧' },
  ar: { label: 'العربية', dir: 'rtl', flag: '🇸🇦' },
  tr: { label: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
};

export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 60;
}

export function levelFromXpT(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level) && level < 99) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, into: remaining, need: xpForLevel(level) };
}
