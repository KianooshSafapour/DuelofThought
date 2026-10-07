/**
 * Duel of Ideas — Core Game Engine (pure, deterministic, isomorphic)
 *
 * Rules:
 *  - Board: 9 columns × 7 rows = 63 cells. Some cells carry numbers 1..9, some are blank.
 *  - Players alternate placing one piece (32 each) into a column; it lands on the
 *    lowest empty cell of that column (gravity).
 *  - A cell once captured can never be re-claimed by the other side.
 *  - Win conditions (checked for the player who just moved):
 *      KIND: owns 4 cells bearing the same number (e.g. four 5s)
 *      RUN : owns at least one cell of each of 4 consecutive numbers (e.g. 2,3,4,5)
 *    Blank cells never count toward wins; they are strategic blockers only.
 *  - If all 63 cells are captured with no win → draw.
 */

export const COLS = 9;
export const ROWS = 7;
export const TOTAL = COLS * ROWS; // 63
export const PIECES_PER_SIDE = 32;

export type PlayerId = 1 | 2;
export type Owner = 0 | PlayerId | null; // 0 = draw placeholder, null = empty
export type WinType = 'KIND' | 'RUN' | 'FULL' | 'RESIGN' | 'TIMEOUT' | null;

export interface Cell {
  n: number | null; // the number printed on the cell (null = blank cell)
  o: Owner; // owner of the cell (null = unclaimed)
}

export interface WinInfo {
  winner: PlayerId | 0; // 0 = draw
  type: WinType;
  numbers: number[]; // the winning set (for highlighting)
  winCells: number[]; // cell indices to highlight
}

export interface GameState {
  cells: Cell[];
  heights: number[]; // next free row per column
  counts: [Uint8Array, Uint8Array]; // per player, index 1..9 => owned count of that number
  piecesLeft: [number, number]; // index 0 => player 1, 1 => player 2
  turn: PlayerId;
  ply: number;
  result: WinInfo | null;
  history: number[]; // column sequence
  lastMove: number | null; // cell index
  boardId: string;
}

export function createGame(boardNumbers: (number | null)[], boardId = 'custom'): GameState {
  if (boardNumbers.length !== TOTAL) throw new Error('board must have 63 cells');
  const cells: Cell[] = boardNumbers.map((n) => ({ n, o: null }));
  return {
    cells,
    heights: new Array(COLS).fill(0),
    counts: [new Uint8Array(10), new Uint8Array(10)],
    piecesLeft: [PIECES_PER_SIDE, PIECES_PER_SIDE],
    turn: 1,
    ply: 0,
    result: null,
    history: [],
    lastMove: null,
    boardId,
  };
}

export function cloneState(s: GameState): GameState {
  return {
    cells: s.cells.map((c) => ({ n: c.n, o: c.o })),
    heights: s.heights.slice(),
    counts: [s.counts[0].slice(), s.counts[1].slice()],
    piecesLeft: [s.piecesLeft[0], s.piecesLeft[1]],
    turn: s.turn,
    ply: s.ply,
    result: s.result,
    history: s.history.slice(),
    lastMove: s.lastMove,
    boardId: s.boardId,
  };
}

export function isValidMove(s: GameState, col: number): boolean {
  if (s.result) return false;
  if (col < 0 || col >= COLS) return false;
  if (s.heights[col] >= ROWS) return false;
  if (s.piecesLeft[s.turn - 1] <= 0) return false;
  return true;
}

export function legalMoves(s: GameState): number[] {
  const ms: number[] = [];
  for (let c = 0; c < COLS; c++) if (s.heights[c] < ROWS) ms.push(c);
  return ms;
}

/** Detect win for a player given its number counts. Returns winning set (kind numbers or run window). */
export function detectWin(counts: Uint8Array): { type: 'KIND' | 'RUN'; numbers: number[] } | null {
  // KIND: four of a kind
  for (let n = 1; n <= 9; n++) {
    if (counts[n] >= 4) return { type: 'KIND', numbers: [n] };
  }
  // RUN: four consecutive numbers each owned at least once
  for (let k = 1; k <= 6; k++) {
    let ok = true;
    for (let n = k; n <= k + 3; n++) if (counts[n] === 0) { ok = false; break; }
    if (ok) return { type: 'RUN', numbers: [k, k + 1, k + 2, k + 3] };
  }
  return null;
}

function winCellsFor(s: GameState, p: PlayerId, win: { type: 'KIND' | 'RUN'; numbers: number[] }): number[] {
  const set = new Set<number>(win.numbers);
  const cells: number[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const c = s.cells[i];
    if (c.o === p && c.n !== null && set.has(c.n)) cells.push(i);
  }
  return cells;
}

/**
 * Apply a move. Mutates the state in place for performance (AI search clones first).
 * Returns the cell index the piece landed on, or -1 if the move was illegal.
 */
export function applyMove(s: GameState, col: number): number {
  if (!isValidMove(s, col)) return -1;
  const row = s.heights[col];
  const idx = row * COLS + col;
  const p = s.turn;
  const cell = s.cells[idx];
  cell.o = p;
  s.heights[col] = row + 1;
  s.piecesLeft[p - 1]--;
  s.ply++;
  s.history.push(col);
  s.lastMove = idx;

  if (cell.n !== null) {
    s.counts[p - 1][cell.n]++;
    const win = detectWin(s.counts[p - 1]);
    if (win) {
      s.result = {
        winner: p,
        type: win.type,
        numbers: win.numbers,
        winCells: winCellsFor(s, p, win),
      };
      return idx;
    }
  }

  if (s.ply >= TOTAL || (s.piecesLeft[0] === 0 && s.piecesLeft[1] === 0)) {
    s.result = { winner: 0, type: 'FULL', numbers: [], winCells: [] };
  } else {
    s.turn = (p === 1 ? 2 : 1) as PlayerId;
  }
  return idx;
}

/** Mirror the board view so numbers read upright for player 2 (visual only). */
export function mirrorCellIndex(idx: number): number {
  const r = Math.floor(idx / COLS);
  const c = idx % COLS;
  return (ROWS - 1 - r) * COLS + (COLS - 1 - c);
}

/** Compact serialization for network transmission */
export function encodeState(s: GameState): string {
  return JSON.stringify({
    cells: s.cells.map((c) => (c.n === null ? '_' : String(c.n))),
    heights: s.heights,
    piecesLeft: s.piecesLeft,
    turn: s.turn,
    ply: s.ply,
    result: s.result,
    lastMove: s.lastMove,
    boardId: s.boardId,
  });
}

/** Replay a column history onto a fresh state (used by spectate/replay & validation). */
export function replay(boardNumbers: (number | null)[], history: number[], boardId = 'custom'): GameState {
  const s = createGame(boardNumbers, boardId);
  for (const col of history) {
    if (applyMove(s, col) < 0) throw new Error('corrupt history');
  }
  return s;
}

/** Statistics snapshot used by post-game "insight" cards (educational feedback). */
export function insightFor(s: GameState, p: PlayerId) {
  const counts: Record<number, number> = {};
  let unclaimed = 0;
  let blanks = 0;
  for (let n = 1; n <= 9; n++) counts[n] = s.counts[p - 1][n];
  for (const c of s.cells) {
    if (c.o === null) unclaimed++;
    if (c.o === p && c.n === null) blanks++;
  }
  let bestKind = 0;
  let bestKindNum = 0;
  let bestRun = 0;
  let bestRunWin: number[] = [];
  for (let n = 1; n <= 9; n++) if (counts[n] > bestKind) { bestKind = counts[n]; bestKindNum = n; }
  for (let k = 1; k <= 6; k++) {
    let d = 0;
    const have: number[] = [];
    for (let n = k; n <= k + 3; n++) if (counts[n] > 0) { d++; have.push(n); }
    if (d > bestRun) { bestRun = d; bestRunWin = have; }
  }
  return {
    captured: TOTAL - s.piecesLeft[p - 1] - unclaimed,
    counts, blanks, bestKind, bestKindNum, bestRun, bestRunWin,
  };
}
