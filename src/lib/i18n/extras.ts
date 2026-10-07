/**
 * Locale-extras registry — merged over the base dictionaries in ./index.ts.
 *
 * HOW IT WORKS: each feature area owns ONE file (extra-*.ts) that default-
 * exports a partial dictionary for all four locales. Add keys to your own
 * file only — never edit this registry, and never edit the base index.ts.
 * Unknown keys resolve with a fa fallback inside t().
 */
import extraCore from './extra-core';
import extraTinktank from './extra-tinktank';
import extraGarage from './extra-garage';
import extraCelebrate from './extra-celebrate';
import extraSms from './extra-sms';
import extraBoards from './extra-boards';
import extraChat from './extra-chat';
import extraMazemind from './extra-mazemind';
import extraBulldozer from './extra-bulldozer';
import extraStore from './extra-store';
import extraCheese from './extra-cheese';

export type ExtraDict = Record<'fa' | 'en' | 'ar' | 'tr', Record<string, string>>;

export const EXTRAS: ExtraDict[] = [
  extraCore as ExtraDict,
  extraTinktank as ExtraDict,
  extraGarage as ExtraDict,
  extraCelebrate as ExtraDict,
  extraSms as ExtraDict,
  extraBoards as ExtraDict,
  extraChat as ExtraDict,
  extraMazemind as ExtraDict,
  extraBulldozer as ExtraDict,
  extraStore as ExtraDict,
  extraCheese as ExtraDict,
];
