/**
 * Boulder Yard engine — pure push-puzzle logic shared by Boulder Yard 1 & 2
 * (modernized homages to Bulldozer / Bulldozer II, The Code Zone 2000 — T9-e).
 *
 * Rules:
 *  - Player moves in 4 directions; walking into a boulder pushes it one cell
 *    (classic Sokoban) when the cell beyond is free.
 *  - Only ONE boulder per push; boulders can never be pulled.
 *  - PITS (game 2): a boulder pushed into a pit vanishes and the pit becomes
 *    ordinary floor. Players cannot walk into an open pit.
 *  - GATES (game 2): one-way for the player only — passable only when moving
 *    in the arrow's direction; boulders can never pass a gate.
 *  - Solved when every remaining boulder sits on a target pad (swallowed
 *    boulders reduce both sides consistently by level design).
 *
 * Machine abilities (B1 — driver & machine progression, backward compatible):
 *  - CHAIN PUSH: step(s, dir, { power }) with power > 1 pushes a straight
 *    line of up to `power` boulders; every shifted boulder needs the same
 *    free-target-or-pit rules. Default power = 1 behaves EXACTLY as before.
 *    A whole chain counts as ONE push action (par stays meaningful).
 *  - DIG: step(s, dir, { ability: 'dig' }) fills the open pit directly ahead
 *    with dirt (pit → floor). The player stays on their cell. Consumes no
 *    engine resources — dig charges live in the UI layer.
 *  - GRAB: step(s, dir, { ability: 'grab' }) lifts the boulder directly ahead
 *    into cargo (cell becomes floor). Engine-side this just deletes the
 *    boulder; the cargo flag lives in the UI layer, which also forbids
 *    finishing a level while holding cargo (solved is forced false).
 *  - DROP: step(s, dir, { ability: 'drop' }) places a held boulder on the
 *    free cell ahead. Allowed destinations: ordinary floor / target pad, or
 *    an OPEN PIT (documented choice: dropping fills the pit, mirroring a
 *    pushed boulder). Never onto walls, gates or other boulders.
 *  - Facing: the state tracks the last moved direction so the UI can offer
 *    one-press ability buttons ("act on the cell ahead").
 *
 * Immutable-ish: every step returns a fresh state (cheap at 63-108 cells),
 * which makes undo = pop the history stack. Ability actions push snapshots
 * too, so undo restores the board (the UI keeps a parallel charge/cargo
 * stack — see boulder-shared.tsx).
 */

export type GateDir = 'U' | 'D' | 'L' | 'R';

export interface BoulderLevelDef {
  /** Solver-verified optimal push count (par == optimum). */
  par: number;
  /** Rectangular ASCII map. Legend: # wall · . floor · B boulder · T target ·
   *  P player · * boulder-on-target · O pit · > < ^ v gates · space void. */
  ascii: string[];
}

export interface ParsedLevel {
  rows: number;
  cols: number;
  wall: boolean[];
  targets: number[];
  gates: { idx: number; dir: GateDir }[];
  pits: number[];
  boulders: number[];
  player: number;
}

export interface BoulderSnapshot {
  player: number;
  boulders: number[];
  pits: number[];
  pushes: number;
  moves: number;
  facing: Dir;
}

export interface BoulderGameState {
  def: BoulderLevelDef;
  levelIndex: number; // 0-based
  rows: number;
  cols: number;
  wall: boolean[];
  targets: Set<number>;
  gates: Map<number, GateDir>;
  pits: Set<number>;
  boulders: Set<number>;
  player: number;
  /** last successful movement direction — used by ability buttons */
  facing: Dir;
  pushes: number;
  moves: number;
  history: BoulderSnapshot[];
  solved: boolean;
  /** index of the boulder moved last (for animation emphasis), -1 none */
  lastPushed: number;
}

export const DIR_STEP: Record<'U' | 'D' | 'L' | 'R', number> = { U: 0, D: 0, L: 0, R: 0 }; // filled per-level (cols)

export function parseLevel(def: BoulderLevelDef): ParsedLevel {
  const rows = def.ascii.length;
  const cols = Math.max(...def.ascii.map((r) => r.length));
  const n = rows * cols;
  const wall = new Array<boolean>(n).fill(true);
  const targets: number[] = [];
  const gates: { idx: number; dir: GateDir }[] = [];
  const pits: number[] = [];
  const boulders: number[] = [];
  let player = -1;
  for (let r = 0; r < rows; r++) {
    const line = def.ascii[r].padEnd(cols, ' ');
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      const i = r * cols + c;
      if (ch === ' ') continue; // void = wall
      if (ch === '#') { wall[i] = true; continue; }
      wall[i] = false;
      if (ch === 'B' || ch === '*') boulders.push(i);
      if (ch === 'T' || ch === '*') targets.push(i);
      if (ch === 'O') pits.push(i);
      if (ch === '>' || ch === '<' || ch === '^' || ch === 'v') {
        gates.push({ idx: i, dir: ch === '>' ? 'R' : ch === '<' ? 'L' : ch === '^' ? 'U' : 'D' });
      }
      if (ch === 'P') player = i;
    }
  }
  return { rows, cols, wall, targets, gates, pits, boulders, player };
}

export function createGame(def: BoulderLevelDef, levelIndex: number): BoulderGameState {
  const p = parseLevel(def);
  return {
    def,
    levelIndex,
    rows: p.rows,
    cols: p.cols,
    wall: p.wall,
    targets: new Set(p.targets),
    gates: new Map(p.gates.map((g) => [g.idx, g.dir])),
    pits: new Set(p.pits),
    boulders: new Set(p.boulders),
    player: p.player,
    facing: 'D',
    pushes: 0,
    moves: 0,
    history: [],
    solved: false,
    lastPushed: -1,
  };
}

function snapshot(s: BoulderGameState): BoulderSnapshot {
  return { player: s.player, boulders: [...s.boulders], pits: [...s.pits], pushes: s.pushes, moves: s.moves, facing: s.facing };
}

export type Dir = 'U' | 'D' | 'L' | 'R';

/** Machine ability actions (B1) — performed on the cell in front of the player. */
export type AbilityKind = 'dig' | 'grab' | 'drop';

export interface StepOptions {
  /** chain-push strength: max boulders moved by one push (default 1 = classic) */
  power?: number;
  /** perform an ability action instead of a normal move */
  ability?: AbilityKind;
}

export interface StepResult {
  state: BoulderGameState;
  moved: boolean;
  pushed: boolean;
  swallowed: number; // pit index if a boulder fell in, else -1
  /** how many boulders actually moved (chain push length; 1 for classic pushes) */
  chain: number;
  /** ability performed by this step, if any */
  ability: AbilityKind | null;
}

const NOOP: Omit<StepResult, 'state'> = { moved: false, pushed: false, swallowed: -1, chain: 0, ability: null };

/**
 * Attempt one move (or one machine ability when opts.ability is set).
 * Returns the same state object (solved/no-op/invalid) or a new one.
 * Fully backward compatible: step(s, dir) ≡ step(s, dir, { power: 1 }).
 */
export function step(s: BoulderGameState, dir: Dir, opts: StepOptions = {}): StepResult {
  if (opts.ability) return stepAbility(s, dir, opts.ability);
  const power = Math.max(1, Math.floor(opts.power ?? 1));
  if (s.solved) return { state: s, ...NOOP };
  const dv = dir === 'U' ? -s.cols : dir === 'D' ? s.cols : dir === 'L' ? -1 : 1;
  const target = s.player + dv;
  const n = s.rows * s.cols;
  if (target < 0 || target >= n) return { state: s, ...NOOP };
  if (dir === 'L' || dir === 'R') {
    if (Math.floor(target / s.cols) !== Math.floor(s.player / s.cols)) return { state: s, ...NOOP };
  }
  if (s.wall[target]) return { state: s, ...NOOP };

  /* gate: player passes only in the arrow's direction */
  const gate = s.gates.get(target);
  if (gate && gate !== dir) return { state: s, ...NOOP };

  const snap = snapshot(s);

  if (s.boulders.has(target)) {
    /* ---- chain push (B1): collect up to `power` adjacent boulders ---- */
    const line: number[] = [target];
    let land = target + dv; // destination cell of the front-most boulder
    while (line.length < power) {
      if (land < 0 || land >= n) break;
      if ((dir === 'L' || dir === 'R') && Math.floor(land / s.cols) !== Math.floor(line[line.length - 1] / s.cols)) break;
      if (s.wall[land] || s.gates.has(land) || !s.boulders.has(land)) break;
      line.push(land);
      land += dv;
    }
    /* validate the landing cell of the last boulder */
    if (land < 0 || land >= n) return { state: s, ...NOOP };
    if ((dir === 'L' || dir === 'R') && Math.floor(land / s.cols) !== Math.floor(line[line.length - 1] / s.cols)) {
      return { state: s, ...NOOP };
    }
    if (s.wall[land]) return { state: s, ...NOOP };
    const gateBeyond = s.gates.get(land);
    if (gateBeyond) return { state: s, ...NOOP }; // boulders never pass gates
    if (s.boulders.has(land)) return { state: s, ...NOOP }; // chain longer than power

    const boulders = new Set(s.boulders);
    const pits = new Set(s.pits);
    let swallowed = -1;
    /* shift every boulder one cell forward, from the front-most backwards */
    for (let i = line.length - 1; i >= 0; i--) {
      boulders.delete(line[i]);
      const dest = i === line.length - 1 ? land : line[i + 1];
      if (i === line.length - 1 && s.pits.has(dest)) {
        pits.delete(dest); // pit becomes floor
        swallowed = dest;
      } else {
        boulders.add(dest);
      }
    }
    const solved = isSolved(boulders, s.targets);
    return {
      state: {
        ...s,
        boulders,
        pits,
        player: target,
        facing: dir,
        pushes: s.pushes + 1,
        moves: s.moves + 1,
        history: [...s.history, snap],
        solved,
        lastPushed: swallowed >= 0 ? -1 : land,
      },
      moved: true,
      pushed: true,
      swallowed,
      chain: line.length,
      ability: null,
    };
  }

  if (s.pits.has(target)) return { state: s, ...NOOP }; // player can't enter open pit

  return {
    state: {
      ...s,
      player: target,
      facing: dir,
      moves: s.moves + 1,
      history: [...s.history, snap],
      lastPushed: -1,
    },
    moved: true,
    pushed: false,
    swallowed: -1,
    chain: 0,
    ability: null,
  };
}

/**
 * Machine ability action on the cell directly ahead (B1). Charges/cargo are
 * enforced by the UI layer; the engine validates the BOARD side of each act.
 * Invalid acts return the identical state (no snapshot, nothing consumed).
 */
function stepAbility(s: BoulderGameState, dir: Dir, ability: AbilityKind): StepResult {
  if (s.solved) return { state: s, ...NOOP };
  const dv = dir === 'U' ? -s.cols : dir === 'D' ? s.cols : dir === 'L' ? -1 : 1;
  const ahead = s.player + dv;
  const n = s.rows * s.cols;
  if (ahead < 0 || ahead >= n) return { state: s, ...NOOP };
  if (dir === 'L' || dir === 'R') {
    if (Math.floor(ahead / s.cols) !== Math.floor(s.player / s.cols)) return { state: s, ...NOOP };
  }

  const snap = snapshot(s);

  if (ability === 'dig') {
    if (!s.pits.has(ahead)) return { state: s, ...NOOP }; // only open pits can be filled
    const pits = new Set(s.pits);
    pits.delete(ahead); // pit → ordinary floor
    return {
      state: { ...s, pits, moves: s.moves + 1, history: [...s.history, snap], lastPushed: -1 },
      moved: true,
      pushed: false,
      swallowed: -1,
      chain: 0,
      ability: 'dig',
    };
  }

  if (ability === 'grab') {
    if (!s.boulders.has(ahead)) return { state: s, ...NOOP }; // nothing to lift
    const boulders = new Set(s.boulders);
    boulders.delete(ahead); // cell becomes floor; boulder rides in cargo (UI state)
    return {
      // holding cargo ⇒ level cannot complete this tick
      state: { ...s, boulders, solved: false, moves: s.moves + 1, history: [...s.history, snap], lastPushed: -1 },
      moved: true,
      pushed: false,
      swallowed: -1,
      chain: 0,
      ability: 'grab',
    };
  }

  /* drop */
  if (s.wall[ahead]) return { state: s, ...NOOP };
  if (s.gates.has(ahead)) return { state: s, ...NOOP }; // boulders never rest on gates
  if (s.boulders.has(ahead)) return { state: s, ...NOOP };
  const boulders = new Set(s.boulders);
  const pits = new Set(s.pits);
  let swallowed = -1;
  if (s.pits.has(ahead)) {
    pits.delete(ahead); // documented choice: dropping into a pit fills it
    swallowed = ahead;
  } else {
    boulders.add(ahead);
  }
  const solved = isSolved(boulders, s.targets);
  return {
    state: { ...s, boulders, pits, moves: s.moves + 1, history: [...s.history, snap], solved, lastPushed: swallowed >= 0 ? -1 : ahead },
    moved: true,
    pushed: false,
    swallowed,
    chain: 0,
    ability: 'drop',
  };
}

export function isSolved(boulders: Set<number>, targets: Set<number>): boolean {
  if (boulders.size === 0) return false; // levels always have ≥1 boulder on a pad path
  for (const b of boulders) if (!targets.has(b)) return false;
  return true;
}

export function undo(s: BoulderGameState): BoulderGameState {
  if (s.history.length === 0) return s;
  const prev = s.history[s.history.length - 1];
  return {
    ...s,
    player: prev.player,
    boulders: new Set(prev.boulders),
    pits: new Set(prev.pits),
    pushes: prev.pushes,
    moves: prev.moves,
    facing: prev.facing,
    history: s.history.slice(0, -1),
    solved: false,
    lastPushed: -1,
  };
}

/** Star rating: 3 = par..par+2 pushes · 2 = par+6 · 1 = solved. */
export function starsFor(pushes: number, par: number): 1 | 2 | 3 {
  if (pushes <= par + 2) return 3;
  if (pushes <= par + 6) return 2;
  return 1;
}

export interface BoulderProgress {
  unlocked: number; // highest unlocked level index (0-based)
  stars: Record<number, number>; // levelIndex -> stars
}

export function loadProgress(storageKey: string): BoulderProgress {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw) as BoulderProgress;
      if (typeof p.unlocked === 'number' && p.stars) return p;
    }
  } catch { /* fresh device */ }
  return { unlocked: 0, stars: {} };
}

export function saveProgress(storageKey: string, p: BoulderProgress) {
  try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* private mode */ }
}
