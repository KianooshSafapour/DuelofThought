/**
 * extra-store — strings for the unique store products expansion (T9-f).
 * Owner: task T9-f. Add keys freely; all four locales required per key.
 */
const dict = {
  fa: {
    cat_EMOTE: 'پک‌های اموجی',
    emote_pack_hint: 'پک فعال، نوار اموجی شما در نبردهای آنلاین را عوض می‌کند.',
    emote_pack_equipped: 'اموجی‌های این پک در گفت‌وگوی نبرد دیده می‌شوند.',
  } as Record<string, string>,
  en: {
    cat_EMOTE: 'Emote Packs',
    emote_pack_hint: 'The equipped pack swaps your emote bar in online duels.',
    emote_pack_equipped: 'This pack’s emotes appear in duel chat.',
  } as Record<string, string>,
  ar: {
    cat_EMOTE: 'حزم الرموز',
    emote_pack_hint: 'الحزمة المفعّلة تغيّر شريط الرموز في المباريات.',
    emote_pack_equipped: 'تظهر رموز هذه الحزمة في محادثة النزال.',
  } as Record<string, string>,
  tr: {
    cat_EMOTE: 'Emote Paketleri',
    emote_pack_hint: 'Kuşandığınız paket çevrimiçi düellolarda emote çubuğunuzu değiştirir.',
    emote_pack_equipped: 'Bu paketin emote’leri düello sohbetinde görünür.',
  } as Record<string, string>,
};
export default dict;
