/**
 * cheese-data — pure data + deterministic generation for "CHEESY PURSUIT"
 * (فار و پنیر), the 30-level labyrinth cat-and-mouse chase (task R12-a).
 *
 * Everything here is framework-free and side-effect free except the explicit
 * save/load helpers (localStorage `doi_cheese_v1`). No imports at all so the
 * one-off verification script (tool-results/cheese-verify.mjs) can run under
 * plain bun without path-alias resolution.
 *
 * MAZE CONTRACT
 *  - generateMaze() runs a recursive backtracker on odd-dimension grids → the
 *    floor is guaranteed fully connected (every floor cell reachable).
 *  - afterwards extra interior walls are knocked out with `loopChance` so the
 *    maze gains LOOPS — required for tactical flanking (a FLANKER cat takes
 *    the alternate route while a CHASER cuts straight through).
 *
 * COLLECTIVE AI (the heart of the game)
 *  Five tiers gate which behaviors the cat pack runs (see TIER_TABLE):
 *    T1 Wander      — independent patrol, chase on direct sight only
 *    T2 Pursuit     — shared last-seen position broadcast (blackboard)
 *    T3 Interception— A* pathing to the mouse's PREDICTED position, separation
 *                     steering, one cat permanently cuts off the burrow
 *    T4 Pack Tactics— role assignment every 2s: 1-2 CHASERs follow, others
 *                     INTERCEPT chokepoints (BFS-betweenness near uncollected
 *                     cheese/burrow), a FLANKER takes the loop route
 *    T5 Hunting Net — T4 + escape-route denial (cats prefer moves that shrink
 *                     the mouse's reachable region) + staggered burst speeds
 *                     so one cat is always angling ahead
 *  Difficulty also scales reaction delay (300ms → 80ms) and prediction horizon.
 */

/* ============================== seeded RNG ============================== */

/** mulberry32 — tiny, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ================================ maze ================================== */

export interface Maze {
  cols: number;
  rows: number;
  /** grid[r * cols + c] — 1 = wall, 0 = floor */
  grid: Uint8Array;
}

export const isWall = (m: Maze, c: number, r: number): boolean =>
  c < 0 || r < 0 || c >= m.cols || r >= m.rows || m.grid[r * m.cols + c] === 1;
export const isFloor = (m: Maze, c: number, r: number): boolean => !isWall(m, c, r);

/**
 * Recursive-backtracker maze on an odd grid, then loop-carving.
 * `loopChance` = probability per removable wall (between two floor cells) to
 * be knocked out. loopChance 0 → perfect maze (single-solution tree).
 */
export function generateMaze(cols: number, rows: number, rng: () => number, loopChance: number): Maze {
  // force odd dimensions
  const C = cols % 2 === 0 ? cols + 1 : cols;
  const R = rows % 2 === 0 ? rows + 1 : rows;
  const grid = new Uint8Array(C * R).fill(1) as Uint8Array;
  const idx = (c: number, r: number) => r * C + c;

  /* ---- carve with iterative recursive backtracker ---- */
  const stack: [number, number][] = [[1, 1]];
  grid[idx(1, 1)] = 0;
  const DIRS: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  while (stack.length > 0) {
    const [c, r] = stack[stack.length - 1];
    const options: [number, number][] = [];
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc > 0 && nr > 0 && nc < C - 1 && nr < R - 1 && grid[idx(nc, nr)] === 1) options.push([nc, nr]);
    }
    if (options.length === 0) { stack.pop(); continue; }
    const [nc, nr] = options[Math.floor(rng() * options.length)];
    grid[idx(c + (nc - c) / 2, r + (nr - r) / 2)] = 0; // open the wall between
    grid[idx(nc, nr)] = 0;
    stack.push([nc, nr]);
  }

  /* ---- knock out extra walls for loops (tactical flanking) ---- */
  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      if (grid[idx(c, r)] !== 1) continue;
      // removable wall = wall cell whose opposite neighbours are both floor
      const h = grid[idx(c - 1, r)] === 0 && grid[idx(c + 1, r)] === 0;
      const v = grid[idx(c, r - 1)] === 0 && grid[idx(c, r + 1)] === 0;
      if ((h || v) && rng() < loopChance) grid[idx(c, r)] = 0;
    }
  }

  return { cols: C, rows: R, grid };
}

/** BFS distance map from (sc, sr); unreachable = -1. */
export function bfsDist(m: Maze, sc: number, sr: number): Int32Array {
  const { cols: C, rows: R } = m;
  const dist = new Int32Array(C * R).fill(-1) as Int32Array;
  const q = new Int32Array(C * R);
  let qh = 0;
  let qt = 0;
  const s = sr * C + sc;
  dist[s] = 0;
  q[qt++] = s;
  while (qh < qt) {
    const cur = q[qh++];
    const c = cur % C;
    const r = (cur - c) / C;
    const d = dist[cur];
    if (c > 0 && m.grid[cur - 1] === 0 && dist[cur - 1] === -1) { dist[cur - 1] = d + 1; q[qt++] = cur - 1; }
    if (c < C - 1 && m.grid[cur + 1] === 0 && dist[cur + 1] === -1) { dist[cur + 1] = d + 1; q[qt++] = cur + 1; }
    if (r > 0 && m.grid[cur - C] === 0 && dist[cur - C] === -1) { dist[cur - C] = d + 1; q[qt++] = cur - C; }
    if (r < R - 1 && m.grid[cur + C] === 0 && dist[cur + C] === -1) { dist[cur + C] = d + 1; q[qt++] = cur + C; }
  }
  return dist;
}

/** A* shortest path on the cell grid (uniform cost, Manhattan heuristic). */
export function astarPath(m: Maze, sc: number, sr: number, tc: number, tr: number): { c: number; r: number }[] {
  const { cols: C, rows: R } = m;
  if (isWall(m, sc, sr) || isWall(m, tc, tr)) return [];
  const N = C * R;
  const start = sr * C + sc;
  const goal = tr * C + tc;
  if (start === goal) return [{ c: sc, r: sr }];
  const g = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const open: number[] = [start];
  const inOpen = new Uint8Array(N);
  const closed = new Uint8Array(N);
  const h = (i: number) => Math.abs((i % C) - tc) + Math.abs(((i - (i % C)) / C) - tr);
  g[start] = 0;
  f[start] = h(start);
  inOpen[start] = 1;
  while (open.length > 0) {
    // linear min-pop (grids are ≤ 25×19 = 475 cells — fine, and allocation-free)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    inOpen[cur] = 0;
    if (cur === goal) {
      const path: { c: number; r: number }[] = [];
      let n: number = goal;
      while (n !== -1 && n !== start) {
        const c = n % C;
        path.push({ c, r: (n - c) / C });
        n = from[n];
      }
      path.reverse();
      return path;
    }
    closed[cur] = 1;
    const c = cur % C;
    const r = (cur - c) / C;
    const nb = [cur - 1, cur + 1, cur - C, cur + C];
    const ok = [c > 0 && m.grid[cur - 1] === 0, c < C - 1 && m.grid[cur + 1] === 0, r > 0 && m.grid[cur - C] === 0, r < R - 1 && m.grid[cur + C] === 0];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const n = nb[k];
      if (closed[n]) continue;
      const ng = g[cur] + 1;
      if (ng < g[n]) {
        g[n] = ng;
        f[n] = ng + h(n);
        from[n] = cur;
        if (!inOpen[n]) { open.push(n); inOpen[n] = 1; }
      }
    }
  }
  return [];
}

/**
 * BFS-betweenness approximation: flood shortest paths from every "interest"
 * cell (cheese, burrow, last-seen) and count how often each cell lies ON a
 * shortest path between interest pairs. High-score cells = chokepoints the
 * INTERCEPTOR cats should guard. Returns cells sorted by score desc.
 */
export function chokepoints(m: Maze, interest: { c: number; r: number }[]): { c: number; r: number; score: number }[] {
  const { cols: C, rows: R } = m;
  const score = new Float32Array(C * R);
  const nextCount = new Uint16Array(C * R); // distinct shortest-path successors
  for (const src of interest) {
    if (isWall(m, src.c, src.r)) continue;
    const dist = bfsDist(m, src.c, src.r);
    // count shortest-path DAG edges: cell → neighbor with dist = dist-1
    nextCount.fill(0);
    for (let i = 0; i < C * R; i++) {
      if (dist[i] <= 0) continue;
      const c = i % C;
      const r = (i - c) / C;
      const d = dist[i];
      let n = 0;
      if (c > 0 && m.grid[i - 1] === 0 && dist[i - 1] === d - 1) n++;
      if (c < C - 1 && m.grid[i + 1] === 0 && dist[i + 1] === d - 1) n++;
      if (r > 0 && m.grid[i - C] === 0 && dist[i - C] === d - 1) n++;
      if (r < R - 1 && m.grid[i + C] === 0 && dist[i + C] === d - 1) n++;
      nextCount[i] = n;
      if (n > 0) score[i] += 1 / n; // on some shortest path → contribute
    }
  }
  const out: { c: number; r: number; score: number }[] = [];
  for (let i = 0; i < C * R; i++) {
    if (m.grid[i] === 1 || score[i] <= 0) continue;
    const c = i % C;
    out.push({ c, r: (i - c) / C, score: score[i] });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* =============================== levels ================================= */

export type MazeTheme = 0 | 1 | 2 | 3; // 0 kitchen · 1 attic · 2 garden · 3 cellar

export interface LevelDef {
  level: number;          // 1-based
  cols: number;           // odd
  rows: number;           // odd
  cheese: number;
  cats: number;           // total cats over the run (initial + timed spawns)
  catTier: 1 | 2 | 3 | 4 | 5;
  spawnEvery: number;     // ms between timed cat spawns (0 = all at start)
  initialCats: number;    // cats present at t=0 (rest arrive on schedule)
  dogMode: boolean;       // garden levels default to the DOG patrol
  theme: MazeTheme;
  loopChance: number;
  parMs: number;          // 2★ under 75% · 3★ under 50%
  mouseSpeed: number;     // cells / second
  catSpeed: number;       // cells / second (pack baseline)
  seed: number;
}

export const LEVEL_COUNT = 30;

/** Deterministic level curve: L1 = 11×9 / 3 🧀 / 1 cat T1 … L30 = 25×19 / 12 🧀 / 6 cats T5 + spawns. */
export function buildLevel(level: number): LevelDef {
  const L = clamp(Math.round(level), 1, LEVEL_COUNT);
  const cols = 11 + 2 * Math.min(7, Math.floor((L - 1) / 4));           // 11…25 (odd)
  const rows = 9 + 2 * Math.min(5, Math.floor((L - 1) / 5));            // 9…19  (odd)
  const cheese = Math.min(12, 3 + Math.floor((L - 1) / 3));             // 3…12
  const cats = Math.min(6, 1 + Math.floor(L / 5));                      // 1…6
  const catTier = Math.min(5, 1 + Math.floor((L - 1) / 6)) as LevelDef['catTier'];
  const timed = L >= 20;
  const initialCats = timed ? Math.max(1, cats - 2) : cats;
  const spawnEvery = timed ? Math.max(11, 19 - (L - 20)) * 1000 : 0;    // 19s → 11s
  const dogMode = Math.floor((L - 1) / 7) % 4 === 2;                    // garden band defaults to dogs
  const theme = (Math.floor((L - 1) / 7) % 4) as MazeTheme;
  const loopChance = Math.min(0.28, 0.1 + L * 0.0045);
  const cells = cols * rows;
  const parMs = Math.round((26 + cheese * 11 + cells / 28) * 1000);
  const mouseSpeed = 3.35 + Math.min(0.9, L * 0.03);
  const catSpeed = mouseSpeed * (0.72 + Math.min(0.3, L * 0.009)) + (catTier >= 4 ? 0.18 : 0);
  return { level: L, cols, rows, cheese, cats, catTier, spawnEvery, initialCats, dogMode, theme, loopChance, parMs, mouseSpeed, catSpeed, seed: L * 9001 + 37 };
}

/* ============================ layout solve ============================== */

export interface LevelLayout {
  maze: Maze;
  mouseSpawn: { c: number; r: number };
  burrow: { c: number; r: number };
  cheeseCells: { c: number; r: number }[];
  catSpawns: { c: number; r: number }[];
  distFromMouse: Int32Array;
}

/**
 * Deterministic layout for a level: mouse starts top-left area, burrow is the
 * farthest cell by BFS, cheese is spread out (min pairwise distance), cat
 * spawns are ≥ 6 BFS steps from the mouse and ≥ 3 from each other.
 */
export function solveLayout(def: LevelDef): LevelLayout {
  const maze = generateMaze(def.cols, def.rows, mulberry32(def.seed), def.loopChance);
  const { cols: C, rows: R } = maze;
  const rng = mulberry32(def.seed * 31 + 7);
  const mouseSpawn = { c: 1, r: 1 };
  const distFromMouse = bfsDist(maze, mouseSpawn.c, mouseSpawn.r);

  // burrow = farthest floor cell (ties → first found scanning bottom-up)
  let burrow = { c: C - 2, r: R - 2 };
  let best = -1;
  for (let r = R - 2; r >= 1; r--) {
    for (let c = C - 2; c >= 1; c--) {
      const d = distFromMouse[r * C + c];
      if (d > best) { best = d; burrow = { c, r }; }
    }
  }

  // cheese: far-apart floor cells, biased away from mouse spawn
  const cheeseCells: { c: number; r: number }[] = [];
  const candidates: { c: number; r: number; d: number }[] = [];
  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      const d = distFromMouse[r * C + c];
      if (d >= 4 && !(c === burrow.c && r === burrow.r)) candidates.push({ c, r, d });
    }
  }
  candidates.sort((a, b) => b.d - a.d);
  const pool = candidates.slice(0, Math.max(def.cheese * 6, candidates.length / 2));
  const minPair = Math.max(3, Math.floor(Math.sqrt(def.cheese) * 1.4));
  let guard = 4000;
  while (cheeseCells.length < def.cheese && guard-- > 0) {
    const pick = pool[Math.floor(rng() * pool.length)];
    if (cheeseCells.some((q) => Math.abs(q.c - pick.c) + Math.abs(q.r - pick.r) < minPair)) continue;
    cheeseCells.push({ c: pick.c, r: pick.r });
  }
  // top-up (tiny mazes / bad luck) with any unclaimed floor cell
  for (const cand of candidates) {
    if (cheeseCells.length >= def.cheese) break;
    if (cheeseCells.some((q) => q.c === cand.c && q.r === cand.r)) continue;
    cheeseCells.push({ c: cand.c, r: cand.r });
  }

  // cat spawns: ≥6 BFS from mouse, ≥3 Manhattan apart, not on cheese/burrow
  const catSpawns: { c: number; r: number }[] = [];
  const far: { c: number; r: number }[] = [];
  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      const d = distFromMouse[r * C + c];
      if (d >= 6 && !(c === burrow.c && r === burrow.r) && !cheeseCells.some((q) => q.c === c && q.r === r)) far.push({ c, r });
    }
  }
  // shuffle deterministically then take spread picks
  for (let i = far.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [far[i], far[j]] = [far[j], far[i]];
  }
  for (const cell of far) {
    if (catSpawns.length >= def.cats) break;
    if (catSpawns.some((q) => Math.abs(q.c - cell.c) + Math.abs(q.r - cell.r) < 3)) continue;
    catSpawns.push(cell);
  }
  // relax spacing if a tiny maze cannot satisfy it
  for (const cell of far) {
    if (catSpawns.length >= def.cats) break;
    if (catSpawns.some((q) => q.c === cell.c && q.r === cell.r)) continue;
    catSpawns.push(cell);
  }

  return { maze, mouseSpawn, burrow, cheeseCells, catSpawns, distFromMouse };
}

/* ========================== collective AI spec ========================== */

export interface TierSpec {
  tier: 1 | 2 | 3 | 4 | 5;
  nameEn: string;
  nameFa: string;
  reactionMs: number;      // blackboard age cats act on (300 → 80)
  predictS: number;        // prediction horizon in seconds (0 = none)
  assignMs: number;        // role re-assignment cadence
  sightCells: number;      // line-of-sight chase radius in cells
}

export const TIER_TABLE: Record<1 | 2 | 3 | 4 | 5, TierSpec> = {
  1: { tier: 1, nameEn: 'Wander', nameFa: 'پرسه', reactionMs: 300, predictS: 0, assignMs: 2600, sightCells: 4 },
  2: { tier: 2, nameEn: 'Pursuit', nameFa: 'تعقیب', reactionMs: 240, predictS: 0, assignMs: 2400, sightCells: 5.5 },
  3: { tier: 3, nameEn: 'Interception', nameFa: 'ردیابی', reactionMs: 180, predictS: 1.2, assignMs: 2200, sightCells: 7 },
  4: { tier: 4, nameEn: 'Pack Tactics', nameFa: 'تاکتیک گله', reactionMs: 120, predictS: 1.5, assignMs: 2000, sightCells: 8.5 },
  5: { tier: 5, nameEn: 'Hunting Net', nameFa: 'تور شکار', reactionMs: 80, predictS: 1.9, assignMs: 2000, sightCells: 10 },
};

/* ============================= characters =============================== */

export type Species = 'mouse' | 'cat' | 'dog';
export type Rarity4 = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export interface Perk {
  speedPct?: number;    // movement speed bonus (≤ 8)
  staminaPct?: number;  // stamina pool + regen bonus (≤ 8)
  sensePct?: number;    // hazard sense radius bonus (≤ 8)
}

export type HatKind =
  | 'none' | 'goggles' | 'glasses' | 'band' | 'bow' | 'tricorn'
  | 'scarf' | 'hood' | 'tiara' | 'antenna' | 'collar' | 'badge' | 'cap';

export interface CharPalette { fur: string; belly: string; accent: string }

export interface CharDef {
  code: string;
  species: Species;
  price: number;
  rarity: Rarity4;
  reqLevel: number;
  names: Record<'fa' | 'en' | 'ar' | 'tr', string>;
  perk: Perk;
  palette: CharPalette;
  hat: HatKind;
  hatColor: string;
}

/** requiredLevel mirrors the platform rule: LEGENDARY 6 · EPIC 3 · RARE 1. */
const reqFor = (r: Rarity4): number => (r === 'LEGENDARY' ? 6 : r === 'EPIC' ? 3 : 1);

/**
 * 14 ORIGINAL cartoon archetypes (big personality, zero copyrighted text):
 * 6 mice (player role) · 5 cats (hunter role) · 3 dogs (dog mode).
 */
export const CHARACTERS: CharDef[] = [
  /* ---------------- mice (player character in MOUSE role) ---------------- */
  {
    code: 'char_m_rusty', species: 'mouse', price: 0, rarity: 'COMMON', reqLevel: 1,
    names: { fa: 'راستی', en: 'Rusty', ar: 'راستي', tr: 'Rusty' },
    perk: {}, palette: { fur: '#a5683f', belly: '#f3e2c7', accent: '#7c4a26' }, hat: 'none', hatColor: '#e2b53f',
  },
  {
    code: 'char_m_ace', species: 'mouse', price: 900, rarity: 'RARE', reqLevel: reqFor('RARE'),
    names: { fa: 'ایس خلبان', en: 'Ace Whiskers', ar: 'آيس السعفات', tr: 'Bıyık Ace' },
    perk: { speedPct: 6 }, palette: { fur: '#8d99ae', belly: '#f0f4f8', accent: '#d94f4f' }, hat: 'goggles', hatColor: '#c98a2d',
  },
  {
    code: 'char_m_prof', species: 'mouse', price: 1800, rarity: 'RARE', reqLevel: reqFor('RARE'),
    names: { fa: 'پروفسور پنیر', en: 'Professor Gouda', ar: 'بروفيسور غودة', tr: 'Profesör Gouda' },
    perk: { sensePct: 8 }, palette: { fur: '#cfc3ae', belly: '#f8f4ea', accent: '#5b6770' }, hat: 'glasses', hatColor: '#3b4252',
  },
  {
    code: 'char_m_ninja', species: 'mouse', price: 2600, rarity: 'EPIC', reqLevel: reqFor('EPIC'),
    names: { fa: 'نینجای شب', en: 'Shadow Foot', ar: 'نينجا الليل', tr: 'Gölge Ayak' },
    perk: { speedPct: 5, staminaPct: 3 }, palette: { fur: '#4b5563', belly: '#9aa5b1', accent: '#e5484d' }, hat: 'band', hatColor: '#e5484d',
  },
  {
    code: 'char_m_ballerina', species: 'mouse', price: 3200, rarity: 'EPIC', reqLevel: reqFor('EPIC'),
    names: { fa: 'بالرین پنیری', en: 'Tutu Tail', ar: 'باليرينا الجبن', tr: 'Tutu Kuyruk' },
    perk: { staminaPct: 8 }, palette: { fur: '#e8b4c8', belly: '#fdeef4', accent: '#c084fc' }, hat: 'bow', hatColor: '#f472b6',
  },
  {
    code: 'char_m_captain', species: 'mouse', price: 4200, rarity: 'LEGENDARY', reqLevel: reqFor('LEGENDARY'),
    names: { fa: 'ناخدا سبیل', en: 'Captain Whiskerbeard', ar: 'الكابتن السعفات', tr: 'Kaptan Bıyık' },
    perk: { speedPct: 4, sensePct: 4 }, palette: { fur: '#8b5e34', belly: '#f1e3cf', accent: '#b91c1c' }, hat: 'tricorn', hatColor: '#27303f',
  },

  /* ---------------- cats (pack when CAT role / CATS mode) ---------------- */
  {
    code: 'char_c_duke', species: 'cat', price: 0, rarity: 'COMMON', reqLevel: 1,
    names: { fa: 'دوک چاق', en: 'Duke Pounce', ar: 'دوق الوثبة', tr: 'Dük Pounce' },
    perk: {}, palette: { fur: '#5b6770', belly: '#c8d0d8', accent: '#39434c' }, hat: 'none', hatColor: '#9aa5b1',
  },
  {
    code: 'char_c_marmalade', species: 'cat', price: 1200, rarity: 'RARE', reqLevel: reqFor('RARE'),
    names: { fa: 'نارنجی', en: 'Marmalade', ar: 'مرمريت', tr: 'Marmelat' },
    perk: { speedPct: 5 }, palette: { fur: '#e8933a', belly: '#fde8cd', accent: '#c96f1e' }, hat: 'scarf', hatColor: '#2f9e77',
  },
  {
    code: 'char_c_shadow', species: 'cat', price: 2400, rarity: 'EPIC', reqLevel: reqFor('EPIC'),
    names: { fa: 'شب‌پره', en: 'Night Pelt', ar: 'فراء الليل', tr: 'Gece Postu' },
    perk: { sensePct: 8 }, palette: { fur: '#2d333f', belly: '#5b6770', accent: '#8f7ff0' }, hat: 'hood', hatColor: '#1d222b',
  },
  {
    code: 'char_c_princess', species: 'cat', price: 3400, rarity: 'EPIC', reqLevel: reqFor('EPIC'),
    names: { fa: 'پرنسس لوکس', en: 'Duchess Fluff', ar: 'دوقيسة الفلوفي', tr: 'Düşes Tüy' },
    perk: { staminaPct: 7 }, palette: { fur: '#f3e2c7', belly: '#fffaf0', accent: '#e5989b' }, hat: 'tiara', hatColor: '#f2c14e',
  },
  {
    code: 'char_c_robo', species: 'cat', price: 5200, rarity: 'LEGENDARY', reqLevel: reqFor('LEGENDARY'),
    names: { fa: 'ربوگتو', en: 'Robo Purr', ar: 'روبو المئوى', tr: 'Robo Miyav' },
    perk: { speedPct: 7 }, palette: { fur: '#94a3b8', belly: '#e2e8f0', accent: '#22d3ee' }, hat: 'antenna', hatColor: '#22d3ee',
  },

  /* ------------- dogs (patrol in DOG mode, both roles) ------------------- */
  {
    code: 'char_d_bulldog', species: 'dog', price: 2000, rarity: 'RARE', reqLevel: reqFor('RARE'),
    names: { fa: 'بولداگ بمب', en: 'Bomber Bulldog', ar: 'البلدوج القنبلة', tr: 'Bomba Bulldog' },
    perk: { speedPct: 4 }, palette: { fur: '#b08166', belly: '#ecd9c8', accent: '#7a4f35' }, hat: 'collar', hatColor: '#d94f4f',
  },
  {
    code: 'char_d_shepherd', species: 'dog', price: 3000, rarity: 'EPIC', reqLevel: reqFor('EPIC'),
    names: { fa: 'چوپان وفادار', en: 'Loyal Shepherd', ar: 'الراعي الوفي', tr: 'Sadık Çoban' },
    perk: { staminaPct: 5, sensePct: 3 }, palette: { fur: '#8a7f66', belly: '#d9cfa8', accent: '#3f3a2e' }, hat: 'badge', hatColor: '#f2c14e',
  },
  {
    code: 'char_d_beagle', species: 'dog', price: 1500, rarity: 'RARE', reqLevel: reqFor('RARE'),
    names: { fa: 'بیگل بو', en: 'Sniffer Beagle', ar: 'البيجل الشم', tr: 'Koku Beagle' },
    perk: { sensePct: 6 }, palette: { fur: '#e9dcc3', belly: '#fffaf0', accent: '#4a3f35' }, hat: 'cap', hatColor: '#2f9e77',
  },
];

export const CHAR_BY_CODE: Record<string, CharDef> = Object.fromEntries(CHARACTERS.map((c) => [c.code, c]));
export const FREE_MOUSE = 'char_m_rusty';
export const FREE_CAT = 'char_c_duke';

/** Theme palettes for the maze (hand-drawn hatching colors). */
export const THEME_PALETTES: Record<MazeTheme, { wall: string; wallEdge: string; hatch: string; floor: string; floorDot: string; accent: string; label: string }> = {
  0: { wall: '#efdcb4', wallEdge: '#c9a86a', hatch: 'rgba(160,120,60,0.5)', floor: '#faf3e3', floorDot: 'rgba(170,140,90,0.25)', accent: '#e2604f', label: 'kitchen' },
  1: { wall: '#c99b66', wallEdge: '#9a6b3c', hatch: 'rgba(120,80,40,0.5)', floor: '#f0e0c0', floorDot: 'rgba(140,100,60,0.22)', accent: '#8a5a34', label: 'attic' },
  2: { wall: '#93b06a', wallEdge: '#6b8a45', hatch: 'rgba(80,110,50,0.45)', floor: '#e4eecb', floorDot: 'rgba(110,140,70,0.25)', accent: '#4f7a3a', label: 'garden' },
  3: { wall: '#9c98ab', wallEdge: '#6f6b80', hatch: 'rgba(70,66,90,0.5)', floor: '#d6d4de', floorDot: 'rgba(100,96,120,0.25)', accent: '#5f5c73', label: 'cellar' },
};

/* ============================ save (localStorage) ======================== */

export type CRole = 'mouse' | 'cat';
export type CMode = 'cats' | 'dogs';

export interface CPLevelRec { stars: number; cleared: boolean; best: number }

export interface CPSave {
  v: 1;
  levels: Record<string, CPLevelRec>;
  selMouse: string;
  selCat: string;   // cat leader skin
  selDog: string;   // dog skin (dog mode)
  role: CRole;
  mode: CMode;
  stats: { runs: number; wins: number; cheese: number; catches: number; best: number };
}

export const CP_SAVE_KEY = 'doi_cheese_v1';

export function defaultCPSave(): CPSave {
  return {
    v: 1,
    levels: {},
    selMouse: FREE_MOUSE,
    selCat: FREE_CAT,
    selDog: 'char_d_beagle',
    role: 'mouse',
    mode: 'cats',
    stats: { runs: 0, wins: 0, cheese: 0, catches: 0, best: 0 },
  };
}

export function loadCPSave(): CPSave {
  try {
    const raw = localStorage.getItem(CP_SAVE_KEY);
    if (!raw) return defaultCPSave();
    const p = JSON.parse(raw) as Partial<CPSave>;
    const d = defaultCPSave();
    const sel = (code: string | undefined, species: Species, fb: string): string => {
      const c = code ? CHAR_BY_CODE[code] : undefined;
      return c && c.species === species && c.price === 0 ? code! : (c && c.species === species ? code! : fb);
    };
    return {
      v: 1,
      levels: p.levels ?? {},
      selMouse: sel(p.selMouse, 'mouse', d.selMouse),
      selCat: sel(p.selCat, 'cat', d.selCat),
      selDog: sel(p.selDog, 'dog', d.selDog),
      role: p.role === 'cat' ? 'cat' : 'mouse',
      mode: p.mode === 'dogs' ? 'dogs' : 'cats',
      stats: { ...d.stats, ...(p.stats ?? {}) },
    };
  } catch {
    return defaultCPSave();
  }
}

export function saveCPSave(s: CPSave): void {
  try { localStorage.setItem(CP_SAVE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** Level N unlocks when N−1 is cleared. */
export function isLevelUnlocked(save: CPSave, level: number): boolean {
  if (level <= 1) return true;
  return !!save.levels[String(level - 1)]?.cleared;
}

export function starsTotal(save: CPSave): number {
  let n = 0;
  for (const rec of Object.values(save.levels)) n += rec.stars;
  return n;
}

/* ============================ display names ============================= */

export function charName(c: CharDef, locale: 'fa' | 'en' | 'ar' | 'tr'): string {
  return c.names[locale] ?? c.names.fa;
}
