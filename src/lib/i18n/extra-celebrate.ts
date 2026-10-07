/**
 * extra-celebrate — strings for the CELEBRATION pack category (Task C1).
 * Owner: task C1. Add keys freely; all four locales required per key.
 * fa is formal with ZWNJ (نیم‌فاصله).
 */
const dict = {
  fa: {
    cat_CELEBRATION: 'پک‌های جشن',
    cat_CELEBRATE: 'پک‌های جشن',
    celebrate_hint: 'بعد از هر پیروزی، شخصیت پک فعال شما روی صفحه می‌رقصد؛ هرچه پک کمیاب‌تر باشد، صحنه‌ی رقص باشکوه‌تر می‌شود. برای تماشای رقص، روی کارتک بزنید.',
  } as Record<string, string>,
  en: {
    cat_CELEBRATION: 'Celebration Packs',
    cat_CELEBRATE: 'Celebration Packs',
    celebrate_hint: 'After every victory your equipped character dances on screen — the rarer the pack, the grander the show. Tap a card to watch the dance.',
  } as Record<string, string>,
  ar: {
    cat_CELEBRATION: 'حزم الاحتفال',
    cat_CELEBRATE: 'حزم الاحتفال',
    celebrate_hint: 'بعد كل انتصار يرقص شخصية حزمتك المفعّلة على الشاشة؛ كلما كانت الحزمة أندر كان العرض أبهى. انقر على البطاقة لمشاهدة الرقصة.',
  } as Record<string, string>,
  tr: {
    cat_CELEBRATION: 'Kutlama Paketleri',
    cat_CELEBRATE: 'Kutlama Paketleri',
    celebrate_hint: 'Her zaferden sonra kuşandığınız karakter ekranda dans eder; paket ne kadar nadirse gösteri o kadar görkemli olur. Dansı izlemek için karta dokunun.',
  } as Record<string, string>,
};
export default dict;
