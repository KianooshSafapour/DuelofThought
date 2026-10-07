/**
 * End-to-end selftest for the duel-socket service (Task 11-a).
 *
 * Prereqs:
 *   - the service running:  bun run index.ts   (port 3003)
 *   - the Next app running: http://127.0.0.1:3000 (real session verify)
 *
 * Run:  bun run selftest.ts
 *
 * Uses throwaway guest accounts (POST /api/auth/guest) and plays a
 * cooperative KIND win so the full pipeline is exercised:
 * auth → matchmaking → server-authoritative moves → finish →
 * result report → per-player rewards → rematch → chat filter paths →
 * private rooms/spectators.
 */
import { io, Socket } from 'socket.io-client';
import { createGame, applyMove, isValidMove, GameState } from './engine';
import { boardNumbersForId } from './boards';

const URL = 'http://127.0.0.1:3003';
const NEXT = 'http://127.0.0.1:3000';

interface MatchPayload {
  yourSide: 1 | 2;
  boardId: string;
  ranked: boolean;
  opponent: { username: string; avatarItem: string; rating: number; level: number };
}
interface StateMsg { state: GameState }
interface Rewards {
  coins: number; xp: number; eloDelta: number | null; level: number;
  unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond: boolean, label: string) {
  if (cond) console.log(`  OK  ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

/** Attach a persistent collector to a socket (avoids listener races). */
function tap<T>(sock: Socket, event: string) {
  const items: T[] = [];
  sock.on(event, (d: T) => items.push(d));
  return {
    items,
    wait: (pred: ((x: T) => boolean) | null = null, timeoutMs = 12_000) =>
      new Promise<T>((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (pred) {
            const hit = items.find(pred);
            if (hit !== undefined) { clearInterval(iv); resolve(hit); return; }
          } else if (items.length > 0) {
            clearInterval(iv);
            resolve(items[0] as T);
            return;
          }
          if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`timeout waiting "${event}"`)); }
        }, 40);
      }),
  };
}

function connect(cookie?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = io(URL, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
      reconnection: false,
      timeout: 6000,
    });
    const to = setTimeout(() => { try { sock.disconnect(); } catch {} reject(new Error('connect timeout')); }, 7000);
    sock.on('connect', () => { clearTimeout(to); resolve(sock); });
    sock.on('connect_error', (e) => { clearTimeout(to); reject(e); });
  });
}

async function guest(): Promise<{ cookie: string; id: string; username: string }> {
  const jarOf = (r: Response): string[] =>
    typeof (r.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (r.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [r.headers.get('set-cookie') ?? ''];
  const cookieOf = (r: Response): string | null => {
    const m = /doi_session=([^;\s]+)/.exec(jarOf(r).join(';'));
    return m ? `doi_session=${m[1]}` : null;
  };

  // 1st choice: throwaway guest (rate-limited 6/h per IP)
  let res = await fetch(`${NEXT}/api/auth/guest`, { method: 'POST' });
  if (res.ok) {
    const cookie = cookieOf(res);
    const j = (await res.json()) as { user?: { id?: string; username?: string } };
    if (cookie && j?.user?.id) return { cookie, id: j.user.id, username: j.user.username ?? '' };
  }

  // 2nd choice: fresh registration (separate rate-limit bucket)
  const name = `dst_${Math.random().toString(36).slice(2, 9)}`;
  const reg = await fetch(`${NEXT}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'Selftest#2024', locale: 'en' }),
  });
  if (reg.ok) {
    const cookie = cookieOf(reg);
    const j = (await reg.json()) as { user?: { id?: string; username?: string } };
    if (cookie && j?.user?.id) return { cookie, id: j.user.id, username: j.user.username ?? name };
  }

  // last resort: the seeded admin account
  const l = await fetch(`${NEXT}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'DuelAdmin@2024' }),
  });
  if (!l.ok) throw new Error(`guest rate-limited and admin login failed: HTTP ${l.status}`);
  const cookie = cookieOf(l);
  if (!cookie) throw new Error('no doi_session from admin login');
  const u = (await l.json()) as { user?: { id?: string; username?: string } };
  return { cookie, id: u?.user?.id ?? '', username: u?.user?.username ?? 'admin' };
}

/* ------------------------------------------------------------------ */
/* TEST A — unauthenticated sockets are rejected                       */
/* ------------------------------------------------------------------ */
async function testAuth() {
  console.log('TEST A: unauthenticated socket is rejected');
  const s = await connect();
  const errs = tap<{ code: string }>(s, 'error');
  const disc = tap<string>(s, 'disconnect');
  const err = await errs.wait();
  check(err?.code === 'AUTH', `error {code:'AUTH'} emitted (got ${JSON.stringify(err)})`);
  await disc.wait();
  check(true, 'socket disconnected after auth failure');
}

/* ------------------------------------------------------------------ */
/* TEST B — matchmaking + cooperative KIND win + rewards               */
/* ------------------------------------------------------------------ */
async function testMatchAndWin() {
  console.log('TEST B: matchmaking, server-authoritative play, KIND win, rewards');
  const A = await guest();
  const B = await guest();
  const sa = await connect(A.cookie);
  const sb = await connect(B.cookie);

  const matchA = tap<MatchPayload>(sa, 'match');
  const matchB = tap<MatchPayload>(sb, 'match');
  const statesA = tap<StateMsg>(sa, 'state');
  const badA = tap<{ reason: string }>(sa, 'move:bad');
  const badB = tap<{ reason: string }>(sb, 'move:bad');
  const overB = tap<{ winner: string; endReason: string }>(sb, 'game:over');
  const rewA = tap<Rewards>(sa, 'game:rewards');
  const rewB = tap<Rewards>(sb, 'game:rewards');

  sa.emit('queue:join', { ranked: false });
  sb.emit('queue:join', { ranked: false });
  const mA = await matchA.wait();
  const mB = await matchB.wait();
  check(mA.yourSide !== mB.yourSide, `opposite sides (A=${mA.yourSide}, B=${mB.yourSide})`);
  check(mA.opponent.username === B.username, `A sees opponent "${B.username}"`);
  check(mB.opponent.username === A.username, `B sees opponent "${A.username}"`);
  check(/^s\d+$/.test(mA.boardId), `seeded board id (${mA.boardId})`);
  check(mA.ranked === false && mB.ranked === false, 'casual match flagged ranked=false');

  const init = await statesA.wait((s) => (s.state?.ply ?? 99) === 0, 6000);
  check(init.state.boardId === mA.boardId && init.state.turn === 1, 'initial state broadcast (ply=0, P1 to move)');
  check(Array.isArray(init.state.cells) && init.state.cells.length === 63, 'state has 63 cells');
  check(Array.isArray((init.state as unknown as { counts: number[][] }).counts), 'state carries counts (client insightFor safety)');

  /* replay the same board locally and drive both clients to a KIND win */
  const numbers = boardNumbersForId(mA.boardId);
  check(!!numbers && numbers.length === 63, 'board reproducible from seed (63 cells)');
  const sim = createGame(numbers!, mA.boardId);
  const cnt = new Array(10).fill(0);
  for (const n of numbers!) if (n) cnt[n]++;
  let target = 1;
  for (let n = 2; n <= 9; n++) if (cnt[n] > cnt[target]) target = n;

  const pickCol = (side: 1 | 2): number => {
    const legal: number[] = [];
    for (let c = 0; c < 9; c++) if (isValidMove(sim, c)) legal.push(c);
    if (!legal.length) return -1;
    if (side === mA.yourSide) {
      const hit = legal.find((c) => sim.cells[sim.heights[c] * 9 + c]?.n === target);
      if (hit !== undefined) return hit;
      const dig = legal.find((c) => {
        for (let r = sim.heights[c]; r < 7; r++) if (sim.cells[r * 9 + c]?.n === target) return true;
        return false;
      });
      return dig !== undefined ? dig : legal[0];
    }
    const blank = legal.find((c) => sim.cells[sim.heights[c] * 9 + c]?.n === null);
    if (blank !== undefined) return blank;
    const safe = legal.find((c) => sim.cells[sim.heights[c] * 9 + c]?.n !== target);
    return safe !== undefined ? safe : legal[0];
  };

  let plies = 0;
  while (!sim.result && plies < 63) {
    const side = sim.turn;
    const col = pickCol(side);
    if (col < 0) break;
    (side === mA.yourSide ? sa : sb).emit('move', { col });
    if (applyMove(sim, col) < 0) { check(false, `local sim rejected col ${col}`); break; }
    plies++;
    await sleep(90);
  }
  check(!!sim.result, `game finished in ${plies} plies (${sim.result ? `${sim.result.type} ${sim.result.numbers.join(',')}` : 'NOT FINISHED'})`);
  check(badA.items.length === 0 && badB.items.length === 0, 'no move:bad for legal scripted moves');

  const winKey = sim.result ? (sim.result.winner === 1 ? 'P1' : sim.result.winner === 2 ? 'P2' : 'DRAW') : 'DRAW';
  const over = await overB.wait().catch(() => null);
  check(over?.winner === winKey && over?.endReason !== 'RESIGN', `game:over {winner:${over?.winner}, reason:${over?.endReason}}`);

  const final = await statesA.wait((s) => !!s.state?.result).catch(() => null);
  check(!!final, 'final state (result included) broadcast to room');
  check(final?.state?.result?.winner === sim.result?.winner, 'final result matches local replay');

  const rA = await rewA.wait().catch(() => null);
  const rB = await rewB.wait().catch(() => null);
  check(!!rA && typeof rA.coins === 'number' && rA.coins >= 0, `A got game:rewards (coins=${rA?.coins}, xp=${rA?.xp})`);
  check(!!rA && typeof rA.level === 'number' && Array.isArray(rA.unlockedAchievements), 'A rewards shape matches OnlineRewards');
  check(!!rB && typeof rB.coins === 'number', `B got game:rewards (coins=${rB?.coins})`);

  return { sa, sb, A, B, mA, mB };
}

/* ------------------------------------------------------------------ */
/* TEST C — rematch: both vote, sides swap, new board                  */
/* ------------------------------------------------------------------ */
async function testRematch(ctx: Awaited<ReturnType<typeof testMatchAndWin>>) {
  console.log('TEST C: rematch (both vote → swapped sides + fresh board)');
  const { sa, sb, mA } = ctx;
  const matchA = tap<MatchPayload>(sa, 'match');
  const matchB = tap<MatchPayload>(sb, 'match');
  const statesA = tap<StateMsg>(sa, 'state');

  sa.emit('rematch:accept');
  await sleep(150);
  sb.emit('rematch:accept');

  const nA = await matchA.wait();
  const nB = await matchB.wait();
  check(nA.yourSide !== mA.yourSide, `side swapped for A (${mA.yourSide} → ${nA.yourSide})`);
  check(nA.yourSide !== nB.yourSide, 'still opposite sides');
  check(nA.boardId !== mA.boardId, `fresh board seed (${mA.boardId} → ${nA.boardId})`);
  const st = await statesA.wait((s) => s.state?.boardId === nA.boardId, 6000);
  check(st.state.ply === 0 && st.state.turn === 1, 'fresh state (ply=0, P1 to move)');
  return { ...ctx, nA, nB };
}

/* ------------------------------------------------------------------ */
/* TEST D — chat: clean, masked (sev 1), severe (sev 3 auto-resign)     */
/* ------------------------------------------------------------------ */
async function testChat(ctx: Awaited<ReturnType<typeof testRematch>>) {
  console.log('TEST D: chat moderation paths');
  const { sa, sb, A, B, nA, nB } = ctx;

  const chatA = tap<{ from: string; text: string }>(sa, 'chat');
  const chatB = tap<{ from: string; text: string }>(sb, 'chat');

  sb.emit('chat', { text: 'سلام خوبی؟' });
  const c1 = await chatA.wait((c) => c.from === B.username);
  check(!c1.text.includes('*'), `clean chat broadcast as-is ("${c1.text}")`);

  await sleep(1600); // 1 msg / 1.5s per socket
  sb.emit('chat', { text: 'you are stupid lol' });
  const c2 = await chatA.wait((c) => c.text.includes('*'));
  check(!c2.text.toLowerCase().includes('stupid'), `mild word masked ("${c2.text}")`);
  check(chatB.items.some((c) => c.text === c2.text), 'masked chat reached the whole room');

  await sleep(1600);
  const blocked = tap<unknown>(sa, 'chat:blocked');
  const over = tap<{ winner: string; endReason: string }>(sa, 'game:over');
  const rewA2 = tap<Rewards>(sa, 'game:rewards');
  sa.emit('chat', { text: 'fuck you all' });
  await blocked.wait();
  check(true, 'severe (severity 3) message → chat:blocked to sender');
  const ov = await over.wait((o) => o.endReason === 'RESIGN');
  const expectedWinner = nA.yourSide === 1 ? 'P2' : 'P1';
  check(ov.winner === expectedWinner, `offender auto-resigned (winner=${ov.winner}, expected ${expectedWinner})`);
  const r2 = await rewA2.wait().catch(() => null);
  check(!!r2 && typeof r2.coins === 'number', `rematch game rewards reported under <roomId>-g2 (coins=${r2?.coins})`);
  check(nB.yourSide !== nA.yourSide, 'sanity: sides consistent');
}

/* ------------------------------------------------------------------ */
/* TEST E — private rooms: create/join/spectate/bad code               */
/* ------------------------------------------------------------------ */
async function testPrivateRooms(A: { cookie: string; username: string }, B: { cookie: string; username: string }) {
  console.log('TEST E: private rooms (create / join / spectator / bad code)');
  const C = await guest();
  const sa = await connect(A.cookie);
  const sb = await connect(B.cookie);
  const sc = await connect(C.cookie);

  const created = tap<{ code: string }>(sa, 'room:created');
  const matchA = tap<MatchPayload>(sa, 'match');
  const matchB = tap<MatchPayload>(sb, 'match');
  const matchC = tap<MatchPayload>(sc, 'match');
  const errC = tap<{ code: string }>(sc, 'error');
  const badC = tap<{ reason: string }>(sc, 'move:bad');

  sa.emit('room:create');
  const { code } = await created.wait();
  check(/^[A-Z2-9]{4}$/.test(code) && !/[01IO]/.test(code), `room code "${code}" (4 chars, no 0/O/1/I)`);

  sb.emit('room:join', { code });
  const mA = await matchA.wait();
  const mB = await matchB.wait();
  check(mA.yourSide === 1 && mB.yourSide === 2, 'creator=P1, joiner=P2, both got match');
  check(mA.opponent.username === B.username, 'P1 sees joiner as opponent');

  sc.emit('room:join', { code }); // full → spectator
  const mC = await matchC.wait();
  check(mC.yourSide === 1, 'room full → spectator gets a P1-view match payload');

  sc.emit('move', { col: 0 });
  const bad = await badC.wait();
  check(!!bad?.reason, `spectator move rejected (move:bad ${bad?.reason})`);

  sc.emit('room:join', { code: 'ZZZZ' });
  const err = await errC.wait((e) => e.code === 'ROOM_NOT_FOUND');
  check(err?.code === 'ROOM_NOT_FOUND', 'unknown code → error ROOM_NOT_FOUND');

  sa.disconnect(); sb.disconnect(); sc.disconnect();
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log(`duel-socket selftest → ${URL} (Next: ${NEXT})\n`);
  await testAuth();
  const ctx = await testMatchAndWin();
  const ctx2 = await testRematch(ctx);
  await testChat(ctx2);
  await testPrivateRooms(ctx.A, ctx.B);
  ctx.sa.disconnect();
  ctx.sb.disconnect();
  console.log('');
  if (failures > 0) {
    console.error(`SELFTEST FAILED — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('SELFTEST PASSED — all checks green');
  process.exit(0);
}

main().catch((e) => {
  console.error('SELFTEST ERROR:', e);
  process.exit(1);
});
