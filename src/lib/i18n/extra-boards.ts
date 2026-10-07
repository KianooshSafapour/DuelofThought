/**
 * extra-boards — strings for the developer Board Designer (T9-b).
 * Owner: task T9-b agent. Add keys freely; all four locales required per key.
 * User-facing keys (play lobby strip + GameScreen fallback notice).
 * Admin-tab strings are bilingual inline (fa · en) inside BoardsTab.tsx,
 * following the established admin-tab convention.
 */
const dict = {
  fa: {
    boards_team: 'طرح‌های تیم',
    boards_team_sub: 'جدول‌های طراحی‌شده توسط تیم دوئل اندیشه — برای نبردهای مقابل هوش مصنوعی و دونفره',
    board_custom_missing: 'این جدول تیمی پیدا نشد؛ صفحهٔ کلاسیک جایگزین شد',
  },
  en: {
    boards_team: 'Team designs',
    boards_team_sub: 'Boards crafted by the Duel of Thought team — for AI and local 2-player duels',
    board_custom_missing: 'This team board could not be found; the classic board was used instead',
  },
  ar: {
    boards_team: 'تصاميم الفريق',
    boards_team_sub: 'لوحات صمّها فريق التطوير — لمباريات الذكاء الاصطناعي ولاعبين على جهاز واحد',
    board_custom_missing: 'لم يتم العثور على هذه اللوحة؛ استُخدمت اللوحة الكلاسيكية بدلاً منها',
  },
  tr: {
    boards_team: 'Takım tasarımları',
    boards_team_sub: 'Duel of Thought ekibinin tasarladığı tablolar — yapay zekâ ve yerel iki kişilik düellolar için',
    board_custom_missing: 'Bu takım tablosu bulunamadı; yerine klasik tablo kullanıldı',
  },
} as const;

export default dict;
