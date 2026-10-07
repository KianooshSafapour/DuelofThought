/**
 * synapse-data.ts — static protocol data for Synapse (سیناپس), the dual n-back
 * working-memory trainer with the 20-day "Mind Clinic" campaign.
 *
 * Science basis (stated honestly in the UI): the dual n-back task popularized by
 * Jaeggi et al., PNAS 2008 — working-memory training with adaptive difficulty.
 *
 * Campaign narrative is bilingual (fa/en). Per platform convention ar/tr fall
 * back to en via pick(). All timing/scoring constants live here so the engine
 * in SynapseGame.tsx stays readable.
 */
import type { Locale } from '@/lib/i18n';

export interface Bi {
  fa: string;
  en: string;
}

/** Narrative picker: fa stays fa; ar/tr/en fall back to en. */
export function pick(bi: Bi, locale: Locale): string {
  return locale === 'fa' ? bi.fa : bi.en;
}

/* ------------------------------------------------------------------ */
/* Protocol constants (classic dual n-back, mobile-first pacing)       */
/* ------------------------------------------------------------------ */

/** Stimulus onset asynchrony: one trial every 2.6 s. */
export const TRIAL_MS = 2600;
/** How long a cell glows / tone plays. */
export const STIM_MS = 600;
/** Probability that each channel matches its n-back step on an eligible trial. */
export const MATCH_P = 0.3;
/** Blocks per session. */
export const SESSION_BLOCKS = 2;
/** Trials per block = BASE_TRIALS + n (warm-up trials excluded from scoring). */
export const BASE_TRIALS = 20;
export const N_MIN = 1;
export const N_MAX = 7;
/** Scoring: correct press +8×n, false alarm −5×n, miss 0; final = max(0, points). */
export const HIT_POINTS = 8;
export const FA_POINTS = 5;
/** Adaptive rule: effective accuracy ≥ 80% → n+1; < 50% → n−1 (clamped 1..7). */
export const PROMOTE_ACC = 0.8;
export const DEMOTE_ACC = 0.5;

/** The 8 acoustic stimuli (glyphs shown for accessibility). */
export const SYNAPSE_LETTERS: readonly string[] = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];

/**
 * Matching pleasant tones (sine + soft octave harmonic), 300–800 Hz band,
 * a gentle E-pentatonic ladder: E4 G4 A4 B4 C5 D5 E5 G5.
 */
export const SYNAPSE_TONES: readonly number[] = [329.63, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99];

/** Human-readable 3×3 cell names for the screen-reader live region. */
export const POS_NAMES: readonly Bi[] = [
  { fa: 'بالا-چپ', en: 'top-left' },
  { fa: 'بالا-وسط', en: 'top-center' },
  { fa: 'بالا-راست', en: 'top-right' },
  { fa: 'وسط-چپ', en: 'middle-left' },
  { fa: 'مرکز', en: 'center' },
  { fa: 'وسط-راست', en: 'middle-right' },
  { fa: 'پایین-چپ', en: 'bottom-left' },
  { fa: 'پایین-وسط', en: 'bottom-center' },
  { fa: 'پایین-راست', en: 'bottom-right' },
];

/* ------------------------------------------------------------------ */
/* Pure engine helpers                                                 */
/* ------------------------------------------------------------------ */

export interface SynapseBlockSeq {
  pos: number[];
  snd: number[];
  /** Count of n-back match opportunities per channel (scoring denominators). */
  opps: { pos: number; snd: number };
}

/**
 * Generate one block of the dual n-back stream. On eligible trials (i ≥ n) each
 * channel independently matches the n-back step with probability MATCH_P; non-match
 * draws are forced to differ from the n-back item so base rates stay clean.
 */
export function genBlock(n: number): SynapseBlockSeq {
  const len = BASE_TRIALS + n;
  const pos: number[] = [];
  const snd: number[] = [];
  let oppPos = 0;
  let oppSnd = 0;
  for (let i = 0; i < len; i++) {
    if (i >= n) {
      if (Math.random() < MATCH_P) {
        pos.push(pos[i - n]);
        oppPos++;
      } else {
        let v = Math.floor(Math.random() * 9);
        while (v === pos[i - n]) v = Math.floor(Math.random() * 9);
        pos.push(v);
      }
      if (Math.random() < MATCH_P) {
        snd.push(snd[i - n]);
        oppSnd++;
      } else {
        let v = Math.floor(Math.random() * 8);
        while (v === snd[i - n]) v = Math.floor(Math.random() * 8);
        snd.push(v);
      }
    } else {
      pos.push(Math.floor(Math.random() * 9));
      snd.push(Math.floor(Math.random() * 8));
    }
  }
  return { pos, snd, opps: { pos: oppPos, snd: oppSnd } };
}

/**
 * Block effective accuracy: (hits − falseAlarms) / match opportunities,
 * clamped to [0, 1]. Feeds the adaptive rule below.
 */
export function effectiveAcc(hits: number, fas: number, opps: number): number {
  if (opps <= 0) return 0;
  return Math.min(1, Math.max(0, (hits - fas) / opps));
}

/** Adaptive n-step for the next block. */
export function nextN(n: number, acc: number): number {
  const delta = acc >= PROMOTE_ACC ? 1 : acc < DEMOTE_ACC ? -1 : 0;
  return Math.min(N_MAX, Math.max(N_MIN, n + delta));
}

/* ------------------------------------------------------------------ */
/* Campaign — "The Mind Clinic" (کلینیک ذهن), 20 days / 3 acts         */
/* ------------------------------------------------------------------ */

export interface SynapseDay {
  day: number;
  act: 1 | 2 | 3;
  startN: number;
  title: Bi;
  note: Bi; // two gentle clinical-diary sentences
}

export const SYNAPSE_ACTS: ReadonlyArray<{ act: 1 | 2 | 3; title: Bi; range: Bi }> = [
  { act: 1, title: { fa: 'پذیرش', en: 'Intake' }, range: { fa: 'روزهای ۱–۷', en: 'Days 1–7' } },
  { act: 2, title: { fa: 'تثبیت', en: 'Consolidation' }, range: { fa: 'روزهای ۸–۱۴', en: 'Days 8–14' } },
  { act: 3, title: { fa: 'یکپارچگی', en: 'Integration' }, range: { fa: 'روزهای ۱۵–۲۰', en: 'Days 15–20' } },
];

export const SYNAPSE_DAYS: readonly SynapseDay[] = [
  {
    day: 1, act: 1, startN: 1,
    title: { fa: 'نخستین ویزیت', en: 'First Visit' },
    note: {
      fa: 'به کلینیک ذهن خوش آمدید. امروز فقط اندازه می‌گیریم — نخستین گذرِ آرام از پروتکل، در آسان‌ترین عمق.',
      en: 'Welcome to the Mind Clinic. Today we simply measure — a gentle first pass through the protocol, at its easiest depth.',
    },
  },
  {
    day: 2, act: 1, startN: 1,
    title: { fa: 'اتاق انتظار', en: 'The Waiting Room' },
    note: {
      fa: 'ذهن پیش از تن می‌رسد. بگذار آرام گیرد؛ امروز پروتکل را تکرار می‌کنیم و می‌گذاریم آشنایی خودش درمان کند.',
      en: 'The mind arrives before the body does. Let it settle; today we repeat the protocol and let familiarity do the healing.',
    },
  },
  {
    day: 3, act: 1, startN: 2,
    title: { fa: 'سیگنال‌های پایه', en: 'Baseline Signals' },
    note: {
      fa: 'عمق را به دو گام عقب می‌بریم — پایهٔ استاندارد کلینیک. نه چیزی برای بردن، نه چیزی برای باختن؛ فقط سیگنال‌هایی برای دیدن.',
      en: 'We raise the depth to two steps back — the clinic’s standard baseline. Nothing to win, nothing to lose; only signals to notice.',
    },
  },
  {
    day: 4, act: 1, startN: 2,
    title: { fa: 'آموختن پروتکل', en: 'Learning the Protocol' },
    note: {
      fa: 'مکان و صدا، دو جریانِ آرام. وظیفهٔ تو نگه‌داشتنِ همه‌چیز نیست — فقط دیدنِ لحظه‌ای است که اکنون، گذشته را تکرار می‌کند.',
      en: 'Position and sound, two quiet streams. Your task is not to hold everything — only to notice when the present repeats the past.',
    },
  },
  {
    day: 5, act: 1, startN: 2,
    title: { fa: 'پیشرفتِ بی‌صدا', en: 'Quiet Progress' },
    note: {
      fa: 'پیشرفت در اینجا به‌ندرت خودش را اعلام می‌کند. به‌شکلِ آسانیِ کوچکی می‌رسد؛ کسری از ثانیه که تطبیق، بی‌مقدمه پیدا می‌شود.',
      en: 'Progress here rarely announces itself. It arrives as a small ease — a fraction of a second where the match simply appears.',
    },
  },
  {
    day: 6, act: 1, startN: 2,
    title: { fa: 'الگوهای کوچک', en: 'Small Patterns' },
    note: {
      fa: 'شبکه کم‌کم به زبانِ الگو سخن می‌گوید. با چشم‌هایت گوش کن و با گوش‌هایت تماشا کن.',
      en: 'The grid is beginning to speak in patterns. Listen with your eyes and watch with your ears.',
    },
  },
  {
    day: 7, act: 1, startN: 2,
    title: { fa: 'مرورِ هفتهٔ اول', en: 'First Week Review' },
    note: {
      fa: 'یک هفته پذیرش کامل شد. کلینیک خطاهای کمتر و نگاهی آرام‌تر ثبت می‌کند — بر هر دو می‌سازیم.',
      en: 'One week of intake is complete. The clinic notes fewer errors and a calmer gaze — we will build on both.',
    },
  },
  {
    day: 8, act: 2, startN: 3,
    title: { fa: 'لایه‌های ژرف‌تر', en: 'Deeper Layers' },
    note: {
      fa: 'فصل دوم آغاز می‌شود: تثبیت. سه گام عقب از ذهن می‌خواهد کمی بیشتر بار کند — و آن را سبک بار کند.',
      en: 'Act two begins: consolidation. Three steps back asks the mind to carry a little more — and to carry it lightly.',
    },
  },
  {
    day: 9, act: 2, startN: 3,
    title: { fa: 'ذهن تمرین می‌کند', en: 'The Mind Rehearses' },
    note: {
      fa: 'حافظه گاوصندوق نیست؛ تمرین است. در هر کوشش، ذهن بی‌صدا سه نُتِ آخر را دوباره زمزمه می‌کند.',
      en: 'Memory is not a vault; it is a rehearsal. Each trial, the mind quietly re-sings the last three notes.',
    },
  },
  {
    day: 10, act: 2, startN: 3,
    title: { fa: 'بازتاب‌ها', en: 'Echoes' },
    note: {
      fa: 'بعضی کوشش‌ها مثل بازتاب‌هایی هستند که از روی آب برمی‌گردند. بگذار برسند؛ آن‌ها را دنبال نکن.',
      en: 'Some trials feel like echoes returning across water. Let them arrive; do not chase them.',
    },
  },
  {
    day: 11, act: 2, startN: 3,
    title: { fa: 'شکیبایی', en: 'Patience' },
    note: {
      fa: 'حافظهٔ فعال مثل باغ‌ها رشد می‌کند — بیشتر در شب، بیشتر در سکوت. شکیبایی بخشی از پروتکل است.',
      en: 'Working memory grows the way gardens do — mostly at night, mostly in silence. Patience is part of the protocol.',
    },
  },
  {
    day: 12, act: 2, startN: 4,
    title: { fa: 'بیشتر نگه‌داشتن', en: 'Holding More' },
    note: {
      fa: 'امروز چهار گام را نگه می‌داریم. شبیه آب‌بردن با دست‌های باز است — آرام حرکت کردن، شکست نیست.',
      en: 'Today we hold four steps. It feels like carrying water in open hands — moving slowly is not failing.',
    },
  },
  {
    day: 13, act: 2, startN: 4,
    title: { fa: 'غلتیدن و بازگشتن', en: 'Drift and Return' },
    note: {
      fa: 'توجه خواهد غلتید؛ کارِ توجه همین است. کلینیک تنها می‌خواهد غلتیدن را ببینی و بازگردی.',
      en: 'Attention will drift; that is what attention does. The clinic only asks that you notice the drift, and return.',
    },
  },
  {
    day: 14, act: 2, startN: 4,
    title: { fa: 'دو هفته در راه', en: 'Two Weeks In' },
    note: {
      fa: 'نیمی از برنامه پشت سرت است. تثبیت واقعی است: تلاشِ دیروز، توانِ آرامِ امروز است.',
      en: 'Half of the program is behind you. The consolidation is real: yesterday’s effort is today’s quiet capacity.',
    },
  },
  {
    day: 15, act: 3, startN: 4,
    title: { fa: 'سیگنالِ شفاف‌تر', en: 'Clearer Signal' },
    note: {
      fa: 'فصل سوم: یکپارچگی. نویز از بین نرفته، اما سیگنال بلندتر از آن شده است.',
      en: 'Act three: integration. The noise has not disappeared, but the signal has grown louder than it.',
    },
  },
  {
    day: 16, act: 3, startN: 4,
    title: { fa: 'تمرکزِ آرام', en: 'Calm Focus' },
    note: {
      fa: 'تمرکزِ بی‌فشار، یک مهارت بالینی است. امروز نرمیِ نگاه و آسودگیِ دست را هدف بگیر.',
      en: 'Focus without strain is a clinical skill. Today, aim for a soft gaze and an unhurried hand.',
    },
  },
  {
    day: 17, act: 3, startN: 5,
    title: { fa: 'پلهٔ بلند', en: 'The Long Stair' },
    note: {
      fa: 'پنج گام عقب — پلهٔ بلند. بعضی روزها پله بالا می‌رود؛ بعضی روزها فقط می‌ایستد. هر دو شمرده می‌شوند.',
      en: 'Five steps back — the long stair. Some days the stair climbs; some days it only holds. Both count.',
    },
  },
  {
    day: 18, act: 3, startN: 5,
    title: { fa: 'چیره‌دستیِ آرام', en: 'Quiet Mastery' },
    note: {
      fa: 'چیره‌دستی در این کلینیک از بیرون ساده به نظر می‌رسد: دستی درنگ‌دار، ذهنی آرام، فشاری درست.',
      en: 'Mastery, in this clinic, looks unimpressive from outside: a steady hand, a quiet mind, a correct press.',
    },
  },
  {
    day: 19, act: 3, startN: 5,
    title: { fa: 'یکپارچگی', en: 'Integration' },
    note: {
      fa: 'پروتکل دیگر یک تکلیف نیست؛ راهی برای دیدن است. دو جریان، یک لحظهٔ اکنون.',
      en: 'The protocol is no longer a task; it is a way of noticing. Two streams, one present moment.',
    },
  },
  {
    day: 20, act: 3, startN: 5,
    title: { fa: 'روز فارغ‌التحصیلی', en: 'Graduation Day' },
    note: {
      fa: 'کلینیک با سپاس ترخِیحت می‌کند. هفته‌ای یک جلسه نگه دار؛ ذهن، مربیِ خودش را به یاد می‌آورد.',
      en: 'The clinic discharges you with gratitude. Keep one session a week; the mind remembers who trained it.',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Shared narrative strings (bilingual)                                */
/* ------------------------------------------------------------------ */

export const PRACTICE_TITLE: Bi = { fa: 'تمرین آزاد', en: 'Free Practice' };

export const PRACTICE_BLURB: Bi = {
  fa: 'بی‌دفتر و بی‌تعهد؛ کلینیک هنوز برای تو باز است. از آخرین سطح ثبت‌شده شروع می‌کنی و پروتکل خودش با تو تنظیم می‌شود.',
  en: 'No diary, no commitment — the clinic stays open for you. You start from your last recorded level and the protocol adapts to you.',
};

export const SCIENCE_NOTE: Bi = {
  fa: 'تمرین حافظهٔ فعال با پروتکل «ان‌بک دوتایی» (Jaeggi و همکاران، PNAS ۲۰۰۸)؛ دشواری به‌صورت تطبیقی در مرزِ توانِ تو تنظیم می‌شود.',
  en: 'Working-memory training with the dual n-back protocol (Jaeggi et al., PNAS 2008); difficulty adapts to keep you at your edge.',
};

export const HOWTO_POS: Bi = {
  fa: 'وقتی خانهٔ روشن با خانهٔ «n گام پیش‌تر» یکی است، دکمهٔ مکان را بزن (کلید A).',
  en: 'Press POSITION (key A) when the lit cell repeats the cell from n steps back.',
};

export const HOWTO_SND: Bi = {
  fa: 'وقتی نُت با نُتِ «n گام پیش‌تر» یکی است، دکمهٔ صدا را بزن (کلید L). دو کانال مستقل‌اند.',
  en: 'Press SOUND (key L) when the tone repeats the tone from n steps back. The two channels are independent.',
};

export const GLYPH_TOGGLE: Bi = {
  fa: 'نمایش حرف برای دسترس‌پذیری',
  en: 'Show letter glyph (accessibility)',
};

export const LOCAL_SAVE_NOTE: Bi = {
  fa: 'وارد نشده‌ای؛ نتیجه به‌صورت محلی ثبت شد — پیشرفت کمپین روی همین دستگاه محفوظ است.',
  en: 'You are playing as a guest — results stay local; campaign progress is saved on this device.',
};

export const INTERLUDE_TITLE: Bi = { fa: 'پایان بلوک', en: 'Block complete' };
export const BLOCK_WORD: Bi = { fa: 'بلوک', en: 'Block' };
export const CONTINUE_BTN: Bi = { fa: 'ادامه', en: 'Continue' };
export const CONTINUE_NOTE: Bi = { fa: 'چند ثانیه دیگر خودکار ادامه می‌دهیم…', en: 'Continuing automatically in a few seconds…' };
export const MENU_BTN: Bi = { fa: 'بازگشت به کلینیک', en: 'Back to the Clinic' };
export const CHANNEL_POS: Bi = { fa: 'کانال مکان', en: 'Position channel' };
export const CHANNEL_SND: Bi = { fa: 'کانال صدا', en: 'Sound channel' };

/** Result-screen row labels (hits / misses / false alarms). */
export const STAT_WORDS: Readonly<Record<'hits' | 'misses' | 'falseAlarms', Bi>> = {
  hits: { fa: 'زد', en: 'Hits' },
  misses: { fa: 'ازدست‌رفته', en: 'Misses' },
  falseAlarms: { fa: 'هشدار کاذب', en: 'False alarms' },
};

/* ------------------------------------------------------------------ */
/* Local persistence (campaign progress + practice level)              */
/* ------------------------------------------------------------------ */

export const LS_DAY_KEY = 'doi_synapse_day';
export const LS_N_KEY = 'doi_synapse_n';

export function loadMaxDay(): number {
  try {
    const v = parseInt(window.localStorage.getItem(LS_DAY_KEY) ?? '0', 10);
    return Number.isFinite(v) && v >= 0 && v <= 20 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveMaxDay(d: number): void {
  try {
    window.localStorage.setItem(LS_DAY_KEY, String(d));
  } catch {
    /* storage unavailable — progress stays in-memory for this visit */
  }
}

export function loadLastN(): number {
  try {
    const v = parseInt(window.localStorage.getItem(LS_N_KEY) ?? '2', 10);
    return Number.isFinite(v) ? Math.min(N_MAX, Math.max(N_MIN, v)) : 2;
  } catch {
    return 2;
  }
}

export function saveLastN(n: number): void {
  try {
    window.localStorage.setItem(LS_N_KEY, String(Math.min(N_MAX, Math.max(N_MIN, n))));
  } catch {
    /* storage unavailable */
  }
}
