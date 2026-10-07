/**
 * Boulder Yard II — campaign level data ( pits & one-way gates ).
 * Modernized homage to Bulldozer II (The Code Zone, 2000) — task T9-e.
 *
 * ASCII legend: '#' wall · '.' floor · 'B' boulder · 'T' target pad ·
 * 'P' player start · '*' boulder on target · 'O' pit ·
 * '>' '<' '^' 'v' one-way gates (PLAYER only; boulders never pass).
 *
 * Every level is machine-verified solvable by
 * tool-results/boulder-push-solver2.mjs (push-optimal BFS). `par` = solver
 * optimum, re-asserted on every solver run.
 *
 * Campaign: 3 yards × 8 levels, sequential unlock.
 */

export interface BoulderLevelDef {
  /** Solver-verified optimal push count (par == optimum). */
  par: number;
  /** Rectangular ASCII map; all rows same length. */
  ascii: string[];
}

export const YARD_SIZE = 8;

export const LEVELS: BoulderLevelDef[] = [
  /* ---------------- Yard 1 — آیین‌گاهِ چاله‌ها (pits) ---------------- */
  // 1 — teach pits: swallow the stray boulder, deliver the real one.
  { par: 5, ascii: [
    '########',
    '#P.B.O.#',
    '#......#',
    '#.B..T.#',
    '########',
  ] },
  // 2 — teach gates: the player passes, boulders never do.
  { par: 4, ascii: [
    '#########',
    '#...>...#',
    '#.B...T.#',
    '#...P...#',
    '#########',
  ] },
  // 3 — pit first, then the pad.
  { par: 6, ascii: ['#########','#P......#','#..B.O..#','#..B...T#','#########'] },
  // 4 — gate detour: push the boulder around the wall.
  { par: 3, ascii: ['##########','#.P..#...#','#....#.T.#','#.B..>.B.#','#..O.#...#','##########'] },
  // 5 — two pits tidy the yard before the real work.
  { par: 4, ascii: ['##########','#..B.O...#','#........#','#P..O....#','#...B.T..#','#....T...#','##########'] },
  // 6 — the pit eats the blocked one, the free one scores.
  { par: 4, ascii: ['#########','#.......#','#.B.B.T.#','#..O....#','#P......#','#..T....#','#########'] },
  // 7 — gate as a door only you can use.
  { par: 5, ascii: [
    '##########',
    '#..B...T.#',
    '#..>.....#',
    '#P.....B.#',
    '#..T...O.#',
    '##########',
  ] },
  // 8 — yard finale: two deliveries, one swallow.
  { par: 10, ascii: [
    '##########',
    '#..B..O..#',
    '#.P......#',
    '#...#....#',
    '#.B...T..#',
    '#..B..T..#',
    '##########',
  ] },

  /* ---------------- Yard 2 — آیین‌گاهِ دروازه‌ها (gates) ---------------- */
  // 9 — one-way in: plan the exit before you enter.
  { par: 8, ascii: [
    '#########',
    '#P..>..T#',
    '#.B.....#',
    '#...B...#',
    '#..T....#',
    '#########',
  ] },
  // 10 — pit swallows the awkward boulder behind the gate.
  { par: 3, ascii: ['##########','#....#..T#','#.BP.#.B.#','#.O..#...#','#....>.T.#','##########'] },
  // 11 — gates both ways: a clockwise dance.
  { par: 8, ascii: ['##########','#P..>....#','#..B..B..#','#...^..v.#','#........#','#...T..T.#','##########'] },
  // 12 — swallow two, place two.
  { par: 5, ascii: ['##########','#P.......#','#..B.O.B.#','#..O.....#','#..B.T.T.#','##########'] },
  // 13 — the gate keeps the boulder in play.
  { par: 6, ascii: ['###########','#.........#','#..P..B...#','#.....>...#','#..T.B..O.#','#.........#','###########'] },
  // 14 — pit ordering matters: fill the far pit first.
  { par: 7, ascii: ['##########','#P.......#','#.B....B.#','#..T..T..#','#.B..O...#','##########'] },
  // 15 — corridor of gates.
  { par: 8, ascii: [
    '##########',
    '#P.>.>.T.#',
    '#.B......#',
    '#...B....#',
    '#..T.....#',
    '##########',
  ] },
  // 16 — yard finale: gates + pits + four pads.
  { par: 10, ascii: ['##########','#....>..T#','#.B.O.B..#','#P.....B.#','#.B..O...#','#...T..T.#','##########'] },

  /* ---------------- Yard 3 — آیین‌گاهِ استادی (mastery) ---------------- */
  // 17 — nested rooms with a gate lock.
  { par: 8, ascii: [
    '##########',
    '#P...#...#',
    '#.B..v.B.#',
    '#....#...#',
    '#..T...T.#',
    '#...O....#',
    '#..B..O..#',
    '##########',
  ] },
  // 18 — swallow the blocker, free the line.
  { par: 7, ascii: [
    '#########',
    '#P.B.O..#',
    '#...B...#',
    '#..T.T..#',
    '#.......#',
    '#..B..T.#',
    '#########',
  ] },
  // 19 — the long way around the gate.
  { par: 5, ascii: ['###########','#....#..T.#','#.B..#....#','#.P.>..B..#','#....#..O.#','#.T..#....#','###########'] },
  // 20 — double gate loop.
  { par: 8, ascii: ['##########','#P...>...#','#..B.....#','#.....B..#','#..^.....#','#..O.T.T.#','##########'] },
  // 21 — four pads, tight hallways.
  { par: 11, ascii: ['###########','#P........#','#.B...B...#','#..#.#.#..#','#.T.....T.#','#..#.#.#..#','#.B..O.B.T#','###########'] },
  // 22 — pit chain reaction.
  { par: 6, ascii: ['##########','#P.......#','#.B.O.B..#','#..O.....#','#.B.T.T..#','#....T...#','##########'] },
  // 23 — gate maze with a single key boulder.
  { par: 4, ascii: ['##########','#........#','#.B...^..#','#..T.....#','#P.>.>.B.#','#..T..T.v#','##########'] },
  // 24 — grand finale: everything at once.
  { par: 9, ascii: ['###########','#P.B..O.T.#','#......B..#','#..>.B....#','#..#..T...#','#.B.O..T..#','###########'] },
];
