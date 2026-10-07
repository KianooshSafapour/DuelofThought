#!/usr/bin/env python3
"""
Boulder Yard 1+2 solution finder (QA tool, not shipped).

Push-optimal BFS with parent pointers; outputs per level:
  - optimal push count
  - FULL move sequence (walks + pushes) as U/D/L/R letters
Sequences are then verified through the real TypeScript engine
(tool-results/verify-solutions.ts via bun) — engine is ground truth.

Usage: python3 boulder-solve.py <levels-file.ts> <out.json>
"""
import json
import re
import sys
from collections import deque

src = open(sys.argv[1]).read()
blocks = re.findall(r"\{ par: (\d+), ascii: \[(.*?)\]\s*\}", src, re.S)
levels = []
for par, body in blocks:
    rows = re.findall(r"'([^']*)'", body)
    levels.append({"par": int(par), "rows": rows})

DIRS = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}


def parse(rows):
    cols = max(len(r) for r in rows)
    grid = [r.ljust(cols) for r in rows]
    h = len(rows)
    wall = set()
    targets, pits, gates = set(), set(), {}
    boulders, player = set(), None
    for r in range(h):
        for c in range(cols):
            ch = grid[r][c]
            if ch == " ":
                continue
            if ch == "#":
                wall.add((c, r))
                continue
            if ch in "T*":
                targets.add((c, r))
            if ch == "O":
                pits.add((c, r))
            if ch in "<>^v":
                gates[(c, r)] = {"<": "L", ">": "R", "^": "U", "v": "D"}[ch]
            if ch in "B*":
                boulders.add((c, r))
            if ch == "P":
                player = (c, r)
    return {"w": cols, "h": h, "wall": wall, "targets": targets, "pits": pits, "gates": gates, "b": frozenset(boulders), "p": player}


def player_bfs(lv, boulders, filled, start):
    """BFS over player walks; returns {cell: first-step-letter} backpointers."""
    w, h, wall, gates = lv["w"], lv["h"], lv["wall"], lv["gates"]
    blocked = wall | boulders | (lv["pits"] - filled)
    prev = {start: None}
    q = deque([start])
    while q:
        cur = q.popleft()
        for letter, (dx, dy) in DIRS.items():
            nxt = (cur[0] + dx, cur[1] + dy)
            if nxt in prev or nxt in blocked:
                continue
            g = gates.get(nxt)
            if g and g != letter:
                continue  # one-way gate for player
            prev[nxt] = (cur, letter)
            q.append(nxt)
    return prev


def walk_path(prev, dest):
    """Reconstruct move letters from start to dest via backpointers."""
    seq = []
    cur = dest
    while prev[cur] is not None:
        parent, letter = prev[cur]
        seq.append(letter)
        cur = parent
    return list(reversed(seq))


def alive_squares(lv):
    """Squares from which a lone boulder can still reach a target or a pit
    (sound over-approx — pits count because a boulder may be swallowed)."""
    w, h = lv["w"], lv["h"]
    alive = set(lv["targets"]) | set(lv["pits"])
    changed = True
    while changed:
        changed = False
        for r in range(h):
            for c in range(w):
                q = (c, r)
                if q in alive or q in lv["wall"]:
                    continue
                for dx, dy in DIRS.values():
                    fwd = (c + dx, r + dy)
                    back = (c - dx, r - dy)
                    if fwd in alive and fwd not in lv["wall"] and back not in lv["wall"]:
                        alive.add(q)
                        changed = True
                        break
    return alive


def solve(lv):
    lv = parse(lv["rows"])
    alive = alive_squares(lv)
    start = (lv["p"], lv["b"], frozenset())
    # win: boulders nonempty and all on targets
    def win(b):
        return len(b) > 0 and all(x in lv["targets"] for x in b)

    if win(lv["b"]):
        return 0, []
    visited = {start}
    queue = deque([(start, [])])
    while queue:
        (pos, boulders, filled), seq = queue.popleft()
        prev = player_bfs(lv, boulders, filled, pos)
        for b in boulders:
            for letter, (dx, dy) in DIRS.items():
                stand = (b[0] - dx, b[1] - dy)
                fwd = (b[0] + dx, b[1] + dy)
                if stand not in prev:
                    continue
                if fwd in lv["wall"] or fwd in boulders or fwd in lv["gates"]:
                    continue
                nb = set(boulders)
                nf = set(filled)
                if fwd in lv["pits"] and fwd not in filled:
                    nf.add(fwd)  # open pit swallows the boulder, becomes floor
                else:
                    nb.add(fwd)  # (covers filled pits = ordinary floor)
                nb.discard(b)
                nb = frozenset(nb)
                nf = frozenset(nf)
                # dead-square prune: any boulder stuck off-target on a dead square
                if any(x not in alive and x not in lv["targets"] for x in nb):
                    continue
                if win(nb):
                    full = seq + walk_path(prev, stand) + [letter]
                    pushes = sum(1 for i, mv in enumerate(full) if is_push(lv, full[:i], mv))
                    return pushes, full
                state = (b, nb, nf)  # player ends on the boulder's old cell
                if state in visited:
                    continue
                visited.add(state)
                queue.append((state, seq + walk_path(prev, stand) + [letter]))
    return None, None


def cell_after(lv, pos, letter):
    dx, dy = DIRS[letter]
    return (pos[0] + dx, pos[1] + dy)


def is_push(lv, prefix, mv):
    """Replay prefix (letters) to get boulders; a move is a push if target cell held a boulder."""
    lv2 = lv
    boulders = set(lv2["b"])
    pos = lv2["p"]
    filled = set()
    for m in prefix:
        nxt = cell_after(lv2, pos, m)
        if nxt in boulders:
            beyond = cell_after(lv2, nxt, m)
            boulders.discard(nxt)
            if beyond in lv2["pits"]:
                filled.add(beyond)
            else:
                boulders.add(beyond)
        pos = nxt
    nxt = cell_after(lv2, pos, mv)
    return nxt in boulders


out = []
fails = 0
print("lvl | par | optimal | status")
for i, lv in enumerate(levels):
    pushes, seq = solve(lv)
    ok = pushes is not None
    if not ok:
        fails += 1
        print(f"{i+1:3} | {lv['par']:3} |   ---   | UNSOLVABLE ✗")
        out.append({"i": i + 1, "par": lv["par"], "optimal": None, "seq": None})
    else:
        mark = "OK" if pushes == lv["par"] else f"PAR MISMATCH (set {pushes})"
        if pushes != lv["par"]:
            fails += 1
        print(f"{i+1:3} | {lv['par']:3} | {pushes:7} | {mark}")
        out.append({"i": i + 1, "par": lv["par"], "optimal": pushes, "seq": "".join(seq)})

print("\nOptimal pars:", [o["optimal"] for o in out])
print("ALL VERIFIED ✓" if fails == 0 else f"{fails} FAILURE(S) ✗")
json.dump(out, open(sys.argv[2], "w"))
