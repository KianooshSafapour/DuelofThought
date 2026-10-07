/**
 * stellar-data.ts — "Stellar Forge" (کورهٔ ستارگان) game data + pure engine.
 *
 * Real stellar nucleosynthesis as game verbs (Burbidge, Burbidge, Fowler & Hoyle 1957):
 * fusion chain H → He → C → O → Ne → Si → Fe stored as levels 1..7.
 * Gravity-slide moves (2048 rules), merge score = (new level)² × 2,
 * forging iron triggers a SUPERNOVA (grid clears, +250, next star spawns more H).
 *
 * All text is bilingual fa/en (ar/tr locales fall back to en in the component).
 */

/* ------------------------------ constants ------------------------------ */

export const COLS = 5;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

/** Hydrogen nuclei spawned per move (before the first supernova). */
export const BASE_SPAWN = 2;
/** Hydrogen spawned per move once the first star has gone supernova. */
export const NOVA_SPAWN = 3;
/** Bonus mass awarded each time iron is forged (supernova). */
export const SUPERNOVA_BONUS = 250;
/** Minimum ms between moves (swipe/keyboard spam throttle). */
export const MOVE_THROTTLE_MS = 150;

/** Merge score: forging an element of `level` grants (level)² × 2 mass (He=8 … Fe=98). */
export function mergeScore(level: number): number {
  return level * level * 2;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface StellarTile {
  id: number;
  level: number; // 1..7 → index into ELEMENTS
}
export type Cell = StellarTile | null;

/* ------------------------------ elements ------------------------------ */

export interface ElementDef {
  level: number;
  /** Latin chemical symbol (rendered dir=ltr inside tiles). */
  symbol: string;
  fa: string;
  en: string;
  blurbFa: string;
  blurbEn: string;
  /** palette: radial-gradient inner highlight → main → rim, text ink, outer glow */
  light: string;
  mid: string;
  deep: string;
  ink: string;
  glow: string;
}

export const ELEMENTS: ElementDef[] = [
  {
    level: 1, symbol: 'H', fa: 'هیدروژن', en: 'Hydrogen',
    blurbFa: 'در مه‌بانگ پدید آمد و فراوان‌ترین عنصر کیهان است. ستاره‌ها بیشترِ عمر خود را صرف همجوشی هیدروژن به هلیم در هسته می‌کنند.',
    blurbEn: 'Forged in the Big Bang; the most abundant element in the universe. Stars spend most of their lives fusing hydrogen into helium in their cores.',
    light: '#f0f9ff', mid: '#7dd3fc', deep: '#0ea5e9', ink: '#075985', glow: 'rgba(125,211,252,0.5)',
  },
  {
    level: 2, symbol: 'He', fa: 'هلیم', en: 'Helium',
    blurbFa: 'هم در مه‌بانگ و هم در هستهٔ ستاره‌ها از راه زنجیرهٔ پروتون–پروتون ساخته می‌شود. نخستین‌بار در طیف خورشید (۱۸۶۸) کشف شد، پیش از آن‌که روی زمین پیدا شود.',
    blurbEn: 'Made in the Big Bang and in stellar cores via the proton–proton chain. It was discovered in the Sun\'s spectrum (1868) before it was ever found on Earth.',
    light: '#fefce8', mid: '#fde68a', deep: '#f59e0b', ink: '#854d0e', glow: 'rgba(253,230,138,0.55)',
  },
  {
    level: 3, symbol: 'C', fa: 'کربن', en: 'Carbon',
    blurbFa: 'با فرایند سه‌آلفا ساخته می‌شود: سه هستهٔ هلیم در دل غول‌های سرخ به هم جوش می‌خورند. کربن ستون فقرات همهٔ جانداران شناخته‌شده است.',
    blurbEn: 'Forged by the triple-alpha process: three helium nuclei fuse inside red giants. Carbon is the backbone of all known life.',
    light: '#eef2ff', mid: '#a5b4fc', deep: '#818cf8', ink: '#312e81', glow: 'rgba(165,180,252,0.5)',
  },
  {
    level: 4, symbol: 'O', fa: 'اکسیژن', en: 'Oxygen',
    blurbFa: 'وقتی کربن هستهٔ هلیمی به دام می‌اندازد، در ستاره‌های پرجرم پدید می‌آید. پس از هیدروژن و هلیم، فراوان‌ترین عنصر کیهان است.',
    blurbEn: 'Created when carbon captures a helium nucleus in massive stars. It is the most abundant element in the cosmos after hydrogen and helium.',
    light: '#ecfdf5', mid: '#6ee7b7', deep: '#34d399', ink: '#065f46', glow: 'rgba(110,231,183,0.5)',
  },
  {
    level: 5, symbol: 'Ne', fa: 'نئون', en: 'Neon',
    blurbFa: 'در پوسته‌های سوزان ستاره‌های پرجرم، از گیراندازی هسته‌های هلیم به‌وسیلهٔ اکسیژن ساخته می‌شود. همین گاز است که در تابلوهای نئونی سرخ‌ونارنجی می‌درخشد.',
    blurbEn: 'Formed in the burning shells of massive stars as oxygen captures more helium nuclei. The same gas glows red-orange in shop signs.',
    light: '#fdf4ff', mid: '#f0abfc', deep: '#e879f9', ink: '#86198f', glow: 'rgba(240,171,252,0.5)',
  },
  {
    level: 6, symbol: 'Si', fa: 'سیلیسیم', en: 'Silicon',
    blurbFa: 'در جریان سوزش اکسیژن و نئون در ژرفای ستارگان غول پدید می‌آید. خطِ درخشانش در طیف، اثر انگشت کشف ابَرنواخترهای دوردست است.',
    blurbEn: 'Produced during oxygen and neon burning deep inside giant stars. Its glowing spectral line is the fingerprint astronomers use to spot distant supernovae.',
    light: '#fff7ed', mid: '#fdba74', deep: '#fb923c', ink: '#7c2d12', glow: 'rgba(253,186,116,0.55)',
  },
  {
    level: 7, symbol: 'Fe', fa: 'آهن', en: 'Iron',
    blurbFa: 'پایانِ راه ستاره: سوزش سیلیسیم آهن می‌سازد و آهن از همجوشی دیگر انرژی نمی‌دهد. هستهٔ آهنی در چند ثانیه فرو می‌ریزد — ابَرنواختر زاده می‌شود.',
    blurbEn: 'The end of the stellar road: silicon burning makes iron, which cannot release energy by fusing. An iron core collapses in seconds — a supernova is born.',
    light: '#fef2f2', mid: '#f87171', deep: '#ef4444', ink: '#7f1d1d', glow: 'rgba(248,113,113,0.7)',
  },
];

/* ------------------------------- epochs ------------------------------- */

export interface EpochDef {
  id: 'protostar' | 'main_sequence' | 'red_giant' | 'supergiant';
  min: number;
  fa: string;
  en: string;
  color: string;
}

export const EPOCHS: EpochDef[] = [
  { id: 'protostar', min: 0, fa: 'نوستاره', en: 'Protostar', color: '#fbbf24' },
  { id: 'main_sequence', min: 500, fa: 'رشتهٔ اصلی', en: 'Main Sequence', color: '#fde047' },
  { id: 'red_giant', min: 1200, fa: 'غول سرخ', en: 'Red Giant', color: '#fb7185' },
  { id: 'supergiant', min: 2000, fa: 'ابَرغول', en: 'Supergiant', color: '#fde68a' },
];

export function epochForScore(score: number): EpochDef {
  let out = EPOCHS[0];
  for (const e of EPOCHS) if (score >= e.min) out = e;
  return out;
}

/* --------------------------- codex: stages ---------------------------- */

export interface StageDef {
  id: string;
  fa: string;
  en: string;
  blurbFa: string;
  blurbEn: string;
  /** game epoch this stage corresponds to (for a colored chip) */
  epoch: EpochDef['id'];
}

export const STAGES: StageDef[] = [
  {
    id: 'h_burn', fa: 'سوزش هیدروژن', en: 'Hydrogen burning', epoch: 'main_sequence',
    blurbFa: 'هیدروژن هسته به هلیم جوشیده می‌شود (زنجیرهٔ پروتون–پروتون). ستاره روی رشتهٔ اصلی می‌نشیند و میلیون‌ها تا میلیاردها سال آرام می‌درخشد.',
    blurbEn: 'Core hydrogen fuses into helium (the proton–proton chain). The star settles onto the main sequence and shines steadily for millions to billions of years.',
  },
  {
    id: 'he_burn', fa: 'سوزش هلیم', en: 'Helium burning', epoch: 'red_giant',
    blurbFa: 'پس از پایان هیدروژن، هسته منقبض و داغ می‌شود تا سه هستهٔ هلیم به کربن بجوشد (فرایند سه‌آلفا) و کربن و اکسیژن ساخته شوند.',
    blurbEn: 'When hydrogen runs out, the core contracts and heats until three helium nuclei fuse into carbon — the triple-alpha process — building carbon and oxygen.',
  },
  {
    id: 'co_burn', fa: 'سوزش کربن و اکسیژن', en: 'Carbon & oxygen burning', epoch: 'supergiant',
    blurbFa: 'در ستاره‌های سنگین، کربن و اکسیژن به نئون، منیزیم و سیلیسیم جوش می‌خورند — مرحله‌هایی که هر بار داغ‌تر و کوتاه‌ترند.',
    blurbEn: 'In heavy stars, carbon and oxygen fuse into neon, magnesium and silicon — stages that grow ever hotter and ever shorter.',
  },
  {
    id: 'si_burn', fa: 'سوزش سیلیسیم', en: 'Silicon burning', epoch: 'supergiant',
    blurbFa: 'کورهٔ واپسین: سیلیسیم به نیکل-۵۶ و سپس آهن جوشیده می‌شود. این مرحله تنها چند روز پیش از بی‌سوخت‌شدن هسته طول می‌کشد.',
    blurbEn: 'The final furnace: silicon fuses into nickel-56, which decays into iron. This stage lasts only days before the core runs out of fuel.',
  },
  {
    id: 'collapse', fa: 'فروپاشی هستهٔ آهن ← ابَرنواختر', en: 'Iron core collapse → supernova', epoch: 'supergiant',
    blurbFa: 'آهن همجوشی نمی‌شود؛ هسته در چند ثانیه فرو می‌ریزد، بازمی‌جهدها و ستاره را منفجر می‌کند — کربن، اکسیژن، آهن و طلا را به فضا می‌پاشد.',
    blurbEn: 'Iron cannot fuse, so the core collapses in seconds, rebounds, and blasts the star apart — seeding space with carbon, oxygen, iron and gold.',
  },
];

/* --------------------------- codex: strings --------------------------- */

export const CODEX_CREDIT = 'Burbidge, Burbidge, Fowler & Hoyle — Rev. Mod. Phys. 1957';

export const SF_TEXT = {
  intro: {
    fa: 'زندگی هر ستاره زنجیره‌ای از همجوشی‌هاست: هیدروژن به هلیم، هلیم به کربن… تا آهن — جایی که فروپاشی آغاز می‌شود.',
    en: "A star's life is a chain of fusions: hydrogen into helium, helium into carbon … up to iron — where collapse begins.",
  },
  elementsHdr: { fa: 'عناصر همجوشی', en: 'Fusion elements' },
  stagesHdr: { fa: 'مراحل زندگی ستاره', en: 'Life stages of a star' },
  dirLabels: {
    up: { fa: 'بالا', en: 'Up' },
    down: { fa: 'پایین', en: 'Down' },
    left: { fa: 'چپ', en: 'Left' },
    right: { fa: 'راست', en: 'Right' },
  } as Record<Dir, { fa: string; en: string }>,
  spawnRate: { fa: 'نرخ زایش', en: 'Spawn rate' },
  hint: { fa: 'کلیدهای جهت‌نما یا کشیدن انگشت', en: 'Arrow keys or swipe' },
} as const;

/* --------------------------- engine: slide ---------------------------- */

export interface SlideResult {
  /** new board (absorbed tiles removed) */
  board: Cell[];
  /** mass gained from merges */
  gained: number;
  /** per-cell flag: cell holds a freshly merged tile */
  merged: boolean[];
  /** per-level count of merge products created this move (index 1..7) */
  forged: number[];
  /** number of Fe tiles created this move (each one = one supernova) */
  feForged: number;
  /** highest level produced by a merge this move */
  maxMergedLevel: number;
  /** tiles absorbed by merges, with the survivor's final cell index */
  absorbed: { level: number; index: number }[];
}

/**
 * Slide all tiles toward `dir` (2048 rules): tiles compact against the wall,
 * equal-level neighbours merge into level+1 (one merge per tile per move).
 * Returns null when nothing would move — the move is then invalid.
 */
export function slide(board: Cell[], dir: Dir): SlideResult | null {
  const result: Cell[] = board.slice();
  const mergedFlags: boolean[] = Array<boolean>(CELLS).fill(false);
  const forged = [0, 0, 0, 0, 0, 0, 0, 0];
  const absorbed: { level: number; index: number }[] = [];
  let gained = 0;
  let moved = false;
  let maxMergedLevel = 0;
  let feForged = 0;

  const perLine = dir === 'left' || dir === 'right' ? ROWS : COLS;
  const lineCount = dir === 'left' || dir === 'right' ? COLS : ROWS;

  for (let line = 0; line < perLine; line++) {
    const idx: number[] = [];
    for (let k = 0; k < lineCount; k++) {
      if (dir === 'left') idx.push(line * COLS + k);
      else if (dir === 'right') idx.push(line * COLS + (COLS - 1 - k));
      else if (dir === 'up') idx.push(k * COLS + line);
      else idx.push((ROWS - 1 - k) * COLS + line);
    }

    const tiles = idx.map((i) => board[i]).filter((t): t is StellarTile => t !== null);
    const out: StellarTile[] = [];
    const outMerged: boolean[] = [];

    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (i + 1 < tiles.length && tiles[i + 1].level === t.level) {
        const level = t.level + 1;
        out.push({ id: t.id, level });
        outMerged.push(true);
        forged[level] += 1;
        gained += mergeScore(level);
        if (level === 7) feForged += 1;
        if (level > maxMergedLevel) maxMergedLevel = level;
        absorbed.push({ level: tiles[i + 1].level, index: idx[out.length - 1] });
        i++; // the neighbour is consumed — one merge per tile per move
      } else {
        out.push(t);
        outMerged.push(false);
      }
    }

    for (let k = 0; k < idx.length; k++) {
      const prev = board[idx[k]];
      const cur = out[k] ?? null;
      if ((prev?.id ?? -1) !== (cur?.id ?? -1) || (prev?.level ?? -1) !== (cur?.level ?? -1)) moved = true;
      result[idx[k]] = cur;
      mergedFlags[idx[k]] = outMerged[k] ?? false;
    }
  }

  if (!moved) return null;
  return { board: result, gained, merged: mergedFlags, forged, feForged, maxMergedLevel, absorbed };
}

/** A move is possible when any cell is empty or any two equal-level tiles touch. */
export function hasMoves(board: Cell[]): boolean {
  for (let i = 0; i < CELLS; i++) {
    const t = board[i];
    if (!t) return true;
    const col = i % COLS;
    if (col + 1 < COLS && board[i + 1]?.level === t.level) return true;
    if (i + COLS < CELLS && board[i + COLS]?.level === t.level) return true;
  }
  return false;
}

/**
 * Spawn up to `n` hydrogen tiles in random empty cells.
 * Uses Math.random by design (game randomness — not for reproducible contexts).
 */
export function spawnRandom(
  board: Cell[],
  n: number,
  nextId: () => number,
): { board: Cell[]; spawned: { id: number; index: number }[] } {
  const b = board.slice();
  const empties: number[] = [];
  for (let i = 0; i < CELLS; i++) if (!b[i]) empties.push(i);
  const spawned: { id: number; index: number }[] = [];
  for (let k = 0; k < n && empties.length > 0; k++) {
    const j = Math.floor(Math.random() * empties.length);
    const index = empties.splice(j, 1)[0];
    const id = nextId();
    b[index] = { id, level: 1 };
    spawned.push({ id, index });
  }
  return { board: b, spawned };
}

/** Deterministic opening layout (hydration-safe): two hydrogen nuclei. */
export function initialBoard(): Cell[] {
  const b: Cell[] = Array<Cell>(CELLS).fill(null);
  b[7] = { id: 1, level: 1 };
  b[16] = { id: 2, level: 1 };
  return b;
}
