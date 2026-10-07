/**
 * Duel of Ideas — multiplayer referee service (socket.io, port 3003).
 * Server-authoritative: all moves validated & applied here via the shared engine.
 * Auth via the httpOnly session cookie forwarded by the gateway; verified
 * against the Next.js internal API. Results reported back with per-player rewards.
 */
import { Server as HttpServer, createServer } from 'http';
import { Server } from 'socket.io';
import {
  createGame, applyMove, isValidMove, legalMoves, GameState, PlayerId, COLS,
} from './engine';

const PORT = 3003;
const NEXT = 'http://127.0.0.1:3000';
const INTERNAL_KEY = process.env.INTERNAL_SECRET ?? 'doi-internal-2024-secure-key';
const MOVE_TIME_MS = 45_000;
const DISCONNECT_GRACE_MS = 60_000;
const ROOM_IDLE_TTL_MS = 10 * 60_000;

/* ---------------- deterministic board generator (mirrors src/lib/game/boards.ts) ---------------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TOTAL = 63;
function generateBoard(seed: number, blanks = 14): (number | null)[] {
  const rnd = mulberry32(seed);
  const board: number[] = new Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) board[i] = 1 + Math.floor(rnd() * 9);
  const minPerNumber = 5;
  for (let n = 1; n <= 9; n++) {
    let c = board.filter((x) => x === n).length;
    let guard = 0;
    while (c < minPerNumber && guard++ < 200) {
      const i = Math.floor(rnd() * TOTAL);
      if (board[i] !== n) { board[i] = n; c++; }
    }
  }
  const count: number[] = new Array(10).fill(0);
  for (const x of board) count[x]++;
  const idx = [...Array(TOTAL).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let made = 0;
  for (const i of idx) {
    if (made >= blanks) break;
    if (count[board[i]] > minPerNumber) { count[board[i]]--; board[i] = 0; made++; }
  }
  return board.map((x) => (x === 0 ? null : x));
}

/* ---------------- word filter ---------------- */
interface WordRow { word: string; severity: number }
let words: WordRow[] = [
  { word: 'stupid', severity: 1 }, { word: 'idiot', severity: 1 }, { word: 'احمق', severity: 1 }, { word: 'خیانت', severity: 2 },
];
async function refreshWords() {
  try {
    const res = await fetch(`${NEXT}/api/mp/words`, { headers: { 'x-internal-key': INTERNAL_KEY } });
    if (res.ok) {
      const data = (await res.json()) as { words: WordRow[] };
      if (Array.isArray(data.words) && data.words.length) words = data.words;
      console.log(`[words] loaded ${words.length} filter words`);
    }
  } catch { /* keep defaults */ }
}
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا').replace(/ۀ|ة/g, 'ه')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
function hardNo(s: string): boolean {
  const n = normalize(s);
  return n.includes('kill yourself') || n.includes('kys');
}
function filterChat(text: string): { masked: string; severity: number; found: string[] } {
  const norm = normalize(text);
  let masked = text;
  let severity = 0;
  const found: string[] = [];
  for (const { word, severity: sev } of words) {
    const w = normalize(word);
    if (w && (norm.includes(w) || new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`, 'i').test(norm))) {
      severity = Math.max(severity, sev);
      found.push(word);
      masked = masked.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => m[0] + '*'.repeat(Math.max(m.length - 1, 1)));
    }
  }
  if (hardNo(text)) { severity = 3; found.push('[hard]'); }
  return { masked, severity, found };
}

/* ---------------- types ---------------- */
interface UserInfo {
  id: string; username: string; level: number; rating: number; isGuest: boolean;
  pieceSkin: string; boardSkin: string; avatarItem: string; titleItem: string | null;
}
interface PlayerSlot {
  socketId: string; userId: string; username: string; rating: number; avatarItem: string;
  pieceSkin: string; boardSkin: string;
}
interface Room {
  id: string;
  boardId: string;
  boardNumbers: (number | null)[];
  state: GameState;
  ranked: boolean;
  players: { 1: PlayerSlot; 2: PlayerSlot };
  moveDeadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  rematch: Set<string>; // userIds
  finished: boolean;
  reported: boolean;
  createdAt: number;
  startedAt: number;
  lastActivityAt: number; // last move / start — drives the stuck-room sweep
}

const io = new Server(createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/presence') {
    // online userIds + duel/queue status — consumed internally by the Next.js /api/friends route
    const dueling = new Set<string>();
    for (const r of rooms.values()) {
      if (r.finished) continue;
      // only report live-socket players as "in duel" — a half-dead room is
      // swept shortly, but until then it shouldn't read as an active duel
      if (anyLiveSocket(r.players[1].userId)) dueling.add(r.players[1].userId);
      if (anyLiveSocket(r.players[2].userId)) dueling.add(r.players[2].userId);
    }
    const queuing = rankedQueue.map((e) => e.user.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, online: [...onlineUsers.keys()], dueling: [...dueling], queuing }));
    return;
  }
  if (u.pathname === '/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, rooms: rooms.size,
      queued: rankedQueue.map((e) => ({ userId: e.user.id, name: e.user.username, ranked: e.ranked, live: !!io.sockets.sockets.get(e.socketId)?.connected })),
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true, service: 'duel-socket',
    rooms: [...rooms.values()].filter((r) => !r.finished).length,
    queued: rankedQueue.length,
    players: (io as unknown as { eio: { clientsCount: number } }).eio.clientsCount,
    online: onlineUsers.size,
  }));
}), {
  cors: { origin: true, credentials: true },
});

const rooms = new Map<string, Room>();
const userRooms = new Map<string, string>(); // userId -> roomId
interface QueueEntry { socketId: string; user: UserInfo; ranked: boolean; joinedAt: number }
const rankedQueue: QueueEntry[] = [];
const casualQueue = rankedQueue; // single queue structure; ranked flag carried per entry
const tokenCache = new Map<string, { user: UserInfo | null; at: number }>();
const lastChatAt = new Map<string, number>();
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/* ---------------- presence & friend challenges ---------------- */
const onlineUsers = new Map<string, Set<string>>(); // userId -> live socketIds (multi-tab safe)
const onlineInfo = new Map<string, UserInfo>(); // userId -> profile snapshot captured at auth
interface PendingChallenge {
  id: string; from: UserInfo; fromSocketId: string;
  toUserId: string; to: UserInfo; toSocketId: string; at: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();
const CHALLENGE_TTL_MS = 30_000;

function addOnline(userId: string, socketId: string) {
  let set = onlineUsers.get(userId);
  if (!set) { set = new Set(); onlineUsers.set(userId, set); }
  set.add(socketId);
}
function removeOnline(userId: string, socketId: string) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) { onlineUsers.delete(userId); onlineInfo.delete(userId); }
}
function anyLiveSocket(userId: string): string | null {
  for (const id of onlineUsers.get(userId) ?? []) {
    const s = io.sockets.sockets.get(id);
    if (s?.connected) return id;
  }
  return null;
}
function busyInGame(userId: string): boolean {
  const rid = userRooms.get(userId);
  if (rid) { const r = rooms.get(rid); if (r && !r.finished) return true; }
  return rankedQueue.some((e) => e.user.id === userId);
}
function expireChallenge(id: string, notify: boolean) {
  const c = pendingChallenges.get(id);
  if (!c) return;
  pendingChallenges.delete(id);
  if (notify) {
    io.to(c.fromSocketId).emit('challenge:expired', { id });
    io.to(c.toSocketId).emit('challenge:expired', { id });
  }
}

function randCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function plainState(s: GameState) {
  return {
    cells: s.cells, heights: s.heights, piecesLeft: s.piecesLeft,
    turn: s.turn, ply: s.ply, lastMove: s.lastMove, result: s.result, boardId: s.boardId,
    history: s.history,
    counts: [Array.from(s.counts[0]), Array.from(s.counts[1])], // serializable per-player number counts
  };
}
function broadcastState(room: Room) {
  io.to(room.id).emit('state', { state: plainState(room.state) });
}
function emitTo(room: Room, side: PlayerId, event: string, payload: unknown) {
  const p = room.players[side];
  if (p) io.to(p.socketId).emit(event, payload);
}
function sideOf(room: Room, userId: string): PlayerId | null {
  if (room.players[1]?.userId === userId) return 1;
  if (room.players[2]?.userId === userId) return 2;
  return null;
}
function other(side: PlayerId): PlayerId { return side === 1 ? 2 : 1; }

/* ---------------- auth ---------------- */
async function verifyToken(rawCookie: string | undefined): Promise<UserInfo | null> {
  if (!rawCookie) return null;
  const m = /doi_session=([^;]+)/.exec(rawCookie);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const hit = tokenCache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.user;
  try {
    const res = await fetch(`${NEXT}/api/mp/verify?token=${encodeURIComponent(token)}`, { headers: { 'x-internal-key': INTERNAL_KEY } });
    if (!res.ok) { tokenCache.set(token, { user: null, at: Date.now() }); return null; }
    const data = (await res.json()) as { ok: boolean; user: UserInfo };
    tokenCache.set(token, { user: data.user ?? null, at: Date.now() });
    return data.user ?? null;
  } catch {
    return null;
  }
}

/* ---------------- game lifecycle ---------------- */
function clearTimer(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function armMoveTimer(room: Room) {
  clearTimer(room);
  room.moveDeadline = Date.now() + MOVE_TIME_MS;
  room.timer = setTimeout(() => {
    const s = room.state;
    if (room.finished || s.result) return;
    const loser = s.turn; // mover ran out of time
    finishGame(room, other(loser) as PlayerId, 'TIMEOUT');
  }, MOVE_TIME_MS + 500);
}

function makeBoardId(): string {
  return `s${Math.floor(Math.random() * 2_000_000_000)}`;
}

function startGame(room: Room) {
  const seed = parseInt(room.boardId.slice(1), 10) || 1;
  room.boardNumbers = generateBoard(seed, 14);
  room.state = createGame(room.boardNumbers, room.boardId);
  room.finished = false;
  room.reported = false;
  room.rematch.clear();
  room.startedAt = Date.now();
  room.lastActivityAt = Date.now();
  const [a, b] = [room.players[1], room.players[2]];
  for (const side of [1, 2] as PlayerId[]) {
    const me = room.players[side];
    const opp = side === 1 ? b : a;
    io.to(me.socketId).emit('match', {
      yourSide: side,
      boardId: room.boardId,
      ranked: room.ranked,
      opponent: {
        username: opp.username, avatarItem: opp.avatarItem, rating: opp.rating, level: 0,
        pieceSkin: opp.pieceSkin, boardSkin: opp.boardSkin,
      },
    });
  }
  broadcastState(room);
  armMoveTimer(room);
  console.log(`[game] started ${room.id} board=${room.boardId} ranked=${room.ranked} p1=${a.username} p2=${b.username}`);
}

function createRoom(userA: UserInfo, socketAId: string, userB: UserInfo, socketBId: string, ranked: boolean): Room {
  const id = 'r' + randCode() + randCode();
  const sideA: PlayerId = Math.random() < 0.5 ? 1 : 2;
  const players = {} as { 1: PlayerSlot; 2: PlayerSlot };
  players[sideA] = { socketId: socketAId, userId: userA.id, username: userA.username, rating: userA.rating, avatarItem: userA.avatarItem, pieceSkin: userA.pieceSkin, boardSkin: userA.boardSkin };
  players[other(sideA)] = { socketId: socketBId, userId: userB.id, username: userB.username, rating: userB.rating, avatarItem: userB.avatarItem, pieceSkin: userB.pieceSkin, boardSkin: userB.boardSkin };
  const room: Room = {
    id, boardId: makeBoardId(), boardNumbers: [], state: null as unknown as GameState,
    ranked, players, moveDeadline: 0, timer: null, rematch: new Set(), finished: false,
    reported: false, createdAt: Date.now(), startedAt: Date.now(), lastActivityAt: Date.now(),
  };
  rooms.set(id, room);
  userRooms.set(userA.id, id);
  userRooms.set(userB.id, id);
  const sa = io.sockets.sockets.get(socketAId);
  const sb = io.sockets.sockets.get(socketBId);
  sa?.join(id); sb?.join(id);
  startGame(room);
  return room;
}

async function finishGame(room: Room, winnerSide: PlayerId | 0, endReason: 'KIND' | 'RUN' | 'FULL' | 'RESIGN' | 'TIMEOUT') {
  if (room.finished) return;
  room.finished = true;
  clearTimer(room);
  const s = room.state;
  if (winnerSide === 0) {
    s.result = { winner: 0, type: 'FULL', numbers: [], winCells: [] };
  } else if (!s.result || s.result.winner === 0 || s.result.winner === null) {
    s.result = { winner: winnerSide, type: endReason, numbers: s.result?.numbers ?? [], winCells: [] };
  }
  broadcastState(room);

  const winner: 'P1' | 'P2' | 'DRAW' = winnerSide === 0 ? 'DRAW' : winnerSide === 1 ? 'P1' : 'P2';
  console.log(`[game] over ${room.id} winner=${winner} reason=${endReason} plies=${s.ply}`);
  if (room.reported) return;
  room.reported = true;
  try {
    const res = await fetch(`${NEXT}/api/mp/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({
        roomId: room.id, boardId: room.boardId, ranked: room.ranked,
        endReason, winNumbers: s.result?.numbers ?? [],
        p1: { id: room.players[1].userId, name: room.players[1].username, rating: room.players[1].rating },
        p2: { id: room.players[2].userId, name: room.players[2].username, rating: room.players[2].rating },
        winner, moves: s.ply, history: s.history,
        firstMoveCol: s.history[0] ?? -1,
        durationMs: Date.now() - room.startedAt,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        p1: { coins: number; xp: number; eloDelta: number | null; levelUps: number; unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[]; user: { level: number } };
        p2: { coins: number; xp: number; eloDelta: number | null; levelUps: number; unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[]; user: { level: number } };
      };
      const pack = (r: typeof data.p1) => ({
        coins: r.coins, xp: r.xp, eloDelta: r.eloDelta, level: r.user.level,
        unlockedAchievements: r.unlockedAchievements ?? [],
      });
      emitTo(room, 1, 'game:rewards', pack(data.p1));
      emitTo(room, 2, 'game:rewards', pack(data.p2));
      console.log(`[game] rewards reported ${room.id}`);
    } else {
      console.error('[game] result report failed', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.error('[game] result report error', e);
  }

  // schedule idle cleanup
  setTimeout(() => {
    if (room.finished && Date.now() - room.startedAt > ROOM_IDLE_TTL_MS - 60_000) {
      // keep room for rematch window; cleanup if no rematch happened
      if (rooms.get(room.id) === room && room.finished) {
        destroyRoom(room.id);
      }
    }
  }, ROOM_IDLE_TTL_MS);
}

function destroyRoom(id: string) {
  const room = rooms.get(id);
  if (!room) return;
  clearTimer(room);
  for (const side of [1, 2] as PlayerId[]) userRooms.delete(room.players[side].userId);
  rooms.delete(id);
  console.log(`[room] destroyed ${id}`);
}

/* ---------------- matchmaking loop ---------------- */
function tryMatch() {
  for (let i = 0; i < rankedQueue.length; i++) {
    for (let j = i + 1; j < rankedQueue.length; j++) {
      const a = rankedQueue[i]; const b = rankedQueue[j];
      if ((a.ranked !== b.ranked) || a.user.id === b.user.id) continue;
      const ra = a.user.rating; const rb = b.user.rating;
      const gap = Math.abs(ra - rb);
      const waited = Date.now() - Math.min(a.joinedAt, b.joinedAt);
      const tolerance = 150 + Math.floor(waited / 5000) * 100; // widens 100 per 5s
      if (gap <= tolerance || !a.ranked) {
        rankedQueue.splice(j, 1); rankedQueue.splice(i, 1);
        const sa = io.sockets.sockets.get(a.socketId);
        const sb = io.sockets.sockets.get(b.socketId);
        if (!sa || !sb) continue;
        createRoom(a.user, a.socketId, b.user, b.socketId, a.ranked && b.ranked);
        return;
      }
    }
  }
}

/* ---------------- chat logging ---------------- */
async function logChat(roomId: string, sender: UserInfo, text: string, masked: boolean, flagged: string[]) {
  try {
    await fetch(`${NEXT}/api/mp/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({ roomId, senderId: sender.id, senderName: sender.username, text: text.slice(0, 200), masked, flaggedWords: flagged.join(',') }),
    });
  } catch { /* non-fatal */ }
}

/* ---------------- socket handling ---------------- */
io.on('connection', (socket) => {
  let user: UserInfo | null = null;

  socket.on('disconnect', () => {
    if (!user) return;
    removeOnline(user.id, socket.id);
    // cancel challenges involving this socket
    for (const c of [...pendingChallenges.values()]) {
      if (c.fromSocketId === socket.id) { pendingChallenges.delete(c.id); io.to(c.toSocketId).emit('challenge:cancelled', { id: c.id }); }
      else if (c.toSocketId === socket.id) { pendingChallenges.delete(c.id); io.to(c.fromSocketId).emit('challenge:declined', { id: c.id }); }
    }
    // leave queues
    for (let i = rankedQueue.length - 1; i >= 0; i--) if (rankedQueue[i].socketId === socket.id) rankedQueue.splice(i, 1);
    const roomId = userRooms.get(user.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const side = sideOf(room, user.id);
    if (side === null) return;
    // grace period for reconnect
    const t = setTimeout(() => {
      if (!rooms.has(roomId)) return;
      const r = rooms.get(roomId)!;
      const s = sideOf(r, user!.id);
      const sock = [...io.sockets.sockets.values()].find((sk) => (sk.data as { userId?: string }).userId === user!.id);
      if (!s || sock?.connected) return;
      finishGame(r, other(s), 'TIMEOUT');
      io.to(r.id).emit('opponent:left');
    }, DISCONNECT_GRACE_MS);
    graceTimers.set(user.id, t);
  });

  socket.use(async (event, next) => {
    try { await next(); } catch (e) { console.error('[handler]', event, e); }
  });

  socket.onAny(async (eventName) => {
    if (eventName === 'queue:join') {
      // auth happens on first event (cookie available at handshake; do it here lazily)
    }
  });

  // authenticate lazily on first message
  const authOnce = async (): Promise<UserInfo | null> => {
    if (user) return user;
    const u = await verifyToken(socket.handshake.headers.cookie as string | undefined);
    if (!u) {
      socket.emit('error', { code: 'AUTH' });
      socket.disconnect(true);
      return null;
    }
    user = u;
    (socket.data as { userId?: string }).userId = u.id;
    addOnline(u.id, socket.id);
    onlineInfo.set(u.id, u);
    // page-refresh recovery: rebind pending challenges to the fresh socket
    for (const c of pendingChallenges.values()) {
      if (c.from.id === u.id) c.fromSocketId = socket.id;
      if (c.toUserId === u.id) c.toSocketId = socket.id;
    }
    await rejoinIfNeeded();
    return u;
  };

  /** Re-attach a returning socket (page refresh / network drop) to its active room. */
  const rejoinIfNeeded = async () => {
    if (!user) return;
    const g = graceTimers.get(user.id);
    if (g) { clearTimeout(g); graceTimers.delete(user.id); }
    const roomId = userRooms.get(user.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) { userRooms.delete(user.id); return; }
    // finished room (kept briefly for rematch window): drop the stale binding
    // instead of re-attaching, otherwise the client would resurrect a dead game
    if (room.finished) { userRooms.delete(user.id); return; }
    const side = sideOf(room, user.id);
    if (side === null) return; // spectator or replaced
    room.players[side].socketId = socket.id; // rebind slot to the fresh socket
    socket.join(roomId);
    const me = room.players[side];
    const opp = room.players[other(side)];
    socket.emit('match', {
      yourSide: side,
      boardId: room.boardId,
      ranked: room.ranked,
      opponent: {
        username: opp.username, avatarItem: opp.avatarItem, rating: opp.rating, level: 0,
        pieceSkin: opp.pieceSkin, boardSkin: opp.boardSkin,
      },
    });
    emitTo(room, side, 'state', { state: plainState(room.state) });
    console.log(`[room] rejoined ${room.id} side=${side} user=${user.username}`);
  };

  socket.on('queue:join', async (d: { ranked?: boolean }) => {
    const u = await authOnce(); if (!u) return;
    if (userRooms.has(u.id)) {
      const r = rooms.get(userRooms.get(u.id) ?? '');
      if (r && !r.finished) {
        // actively playing — resume the match instead of queueing (page-refresh recovery)
        await rejoinIfNeeded();
        return;
      }
      // finished room: free to queue again (a new match overwrites the binding)
    }
    // already queued?
    if (rankedQueue.some((e) => e.user.id === u.id)) return;
    rankedQueue.push({ socketId: socket.id, user: u, ranked: !!d?.ranked, joinedAt: Date.now() } as QueueEntry);
    socket.emit('queued');
    tryMatch();
  });

  socket.on('queue:leave', () => {
    for (let i = rankedQueue.length - 1; i >= 0; i--) if (rankedQueue[i].socketId === socket.id) rankedQueue.splice(i, 1);
  });

  /** Register presence without joining anything (lobby heartbeat).
   *  If this user is somehow already waiting in the queue (page-state race),
   *  re-announce it so the client shows the radar instead of idling forever. */
  socket.on('presence:hello', async () => {
    const u = await authOnce(); if (!u) return;
    if (rankedQueue.some((e) => e.user.id === u.id)) socket.emit('queued');
  });

  /* ---- friend duels: direct challenge flow ---- */
  socket.on('challenge:send', async (d: { toUserId?: string }) => {
    const u = await authOnce(); if (!u) return;
    const now = Date.now();
    const last = lastChatAt.get('c' + u.id) ?? 0;
    if (now - last < 2000) return; // light anti-spam throttle
    lastChatAt.set('c' + u.id, now);
    const toUserId = String(d?.toUserId ?? '');
    if (!toUserId || toUserId === u.id) { socket.emit('error', { code: 'CHALLENGE_SELF' }); return; }
    if (busyInGame(u.id)) { socket.emit('error', { code: 'IN_ROOM' }); return; }
    if (pendingChallenges.size > 200) { socket.emit('error', { code: 'RATE' }); return; }
    const targetSocket = anyLiveSocket(toUserId);
    const targetInfo = onlineInfo.get(toUserId);
    if (!targetSocket || !targetInfo) { socket.emit('error', { code: 'CHALLENGE_GONE' }); return; }
    if (busyInGame(toUserId)) { socket.emit('error', { code: 'CHALLENGE_BUSY' }); return; }
    for (const c of pendingChallenges.values()) {
      if ((c.from.id === u.id && c.toUserId === toUserId) || (c.from.id === toUserId && c.toUserId === u.id)) {
        socket.emit('error', { code: 'CHALLENGE_DUP' }); return;
      }
    }
    const id = 'c' + Math.random().toString(36).slice(2, 10);
    const ch: PendingChallenge = { id, from: u, fromSocketId: socket.id, toUserId, to: targetInfo, toSocketId: targetSocket, at: now };
    pendingChallenges.set(id, ch);
    socket.emit('challenge:sent', { id, to: { id: targetInfo.id, username: targetInfo.username } });
    io.to(targetSocket).emit('challenge:incoming', {
      id, from: { id: u.id, username: u.username, avatarItem: u.avatarItem, rating: u.rating, level: u.level },
    });
    setTimeout(() => { if (pendingChallenges.get(id) === ch) expireChallenge(id, true); }, CHALLENGE_TTL_MS + 1000);
  });

  socket.on('challenge:cancel', async () => {
    const u = await authOnce(); if (!u) return;
    for (const c of pendingChallenges.values()) {
      if (c.from.id === u.id) {
        pendingChallenges.delete(c.id);
        io.to(c.toSocketId).emit('challenge:cancelled', { id: c.id });
        socket.emit('challenge:cancelled', { id: c.id });
      }
    }
  });

  socket.on('challenge:decline', async (d: { id?: string }) => {
    const u = await authOnce(); if (!u) return;
    const c = pendingChallenges.get(String(d?.id ?? ''));
    if (!c || c.toUserId !== u.id) return;
    pendingChallenges.delete(c.id);
    io.to(c.fromSocketId).emit('challenge:declined', { id: c.id });
  });

  socket.on('challenge:accept', async (d: { id?: string }) => {
    const u = await authOnce(); if (!u) return;
    const c = pendingChallenges.get(String(d?.id ?? ''));
    if (!c || c.toUserId !== u.id) { socket.emit('error', { code: 'NOT_FOUND' }); return; }
    pendingChallenges.delete(c.id);
    const fromSock = io.sockets.sockets.get(c.fromSocketId);
    if (!fromSock?.connected) { socket.emit('error', { code: 'CHALLENGE_GONE' }); return; }
    if (busyInGame(c.from.id) || busyInGame(u.id)) {
      socket.emit('error', { code: 'CHALLENGE_BUSY' });
      io.to(c.fromSocketId).emit('challenge:declined', { id: c.id });
      return;
    }
    createRoom(c.from, c.fromSocketId, u, socket.id, false); // friendly duel — always casual
  });

  socket.on('room:create', async () => {
    const u = await authOnce(); if (!u) return;
    if (userRooms.has(u.id)) { socket.emit('error', { code: 'IN_ROOM' }); return; }
    // create an open room with one player; store as pseudo-room awaiting join
    const code = randCode();
    openRooms.set(code, { host: { socketId: socket.id, user: u, ranked: false }, at: Date.now() });
    socket.data.openCode = code;
    socket.emit('room:created', { code });
  });
  // NOTE: openRooms is declared after the handlers (hoisted via Map closure below)

  socket.on('room:join', async (d: { code?: string }) => {
    const u = await authOnce(); if (!u) return;
    const code = String(d?.code ?? '').toUpperCase().trim();
    const open = openRooms.get(code);
    if (!open || Date.now() - open.at > 10 * 60_000) {
      socket.emit('error', { code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (open.host.user.id === u.id) return; // host re-join no-op
    if (userRooms.has(u.id)) { socket.emit('error', { code: 'IN_ROOM' }); return; }
    openRooms.delete(code);
    const hostSock = io.sockets.sockets.get(open.host.socketId);
    if (!hostSock || !hostSock.connected) { socket.emit('error', { code: 'HOST_GONE' }); return; }
    createRoom(open.host.user, open.host.socketId, u, socket.id, open.host.ranked);
  });

  socket.on('move', async (d: { col?: number }) => {
    const u = await authOnce(); if (!u) return;
    const roomId = userRooms.get(u.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const side = sideOf(room, u.id);
    if (side === null || room.state.turn !== side) { socket.emit('move:bad', { reason: 'NOT_YOUR_TURN' }); return; }
    const col = Number(d?.col);
    if (!Number.isInteger(col) || col < 0 || col >= COLS || !isValidMove(room.state, col)) {
      socket.emit('move:bad', { reason: 'ILLEGAL' });
      return;
    }
    const n = room.state.cells[room.state.heights[col] * COLS + col]?.n;
    applyMove(room.state, col);
    room.lastActivityAt = Date.now();
    if (n !== null && !room.state.result) socket.emit('noop'); // keep event shape stable
    broadcastState(room);
    if (room.state.result) {
      const winnerSide = room.state.result.winner as 0 | 1 | 2;
      await finishGame(room, winnerSide === 0 ? 0 : (winnerSide as PlayerId), (room.state.result.type as 'KIND' | 'RUN' | 'FULL') ?? 'FULL');
    } else {
      armMoveTimer(room);
    }
  });

  socket.on('chat', async (d: { text?: string }) => {
    const u = await authOnce(); if (!u) return;
    const now = Date.now();
    const last = lastChatAt.get(socket.id) ?? 0;
    if (now - last < 1500) return;
    lastChatAt.set(socket.id, now);
    const text = String(d?.text ?? '').slice(0, 200).trim();
    if (!text) return;
    const f = filterChat(text);
    const roomId = userRooms.get(u.id) ?? '';
    if (f.severity >= 3) {
      socket.emit('chat:blocked', { words: f.found });
      await logChat(roomId, u, text, true, f.found);
      // auto-resign from active room (severe abuse)
      const room = rooms.get(roomId);
      if (room && !room.finished) {
        const side = sideOf(room, u.id);
        if (side !== null) { await finishGame(room, other(side), 'RESIGN'); io.to(room.id).emit('opponent:left'); }
      }
      return;
    }
    if (roomId) io.to(roomId).emit('chat', { from: u.username, text: f.masked });
    if (f.severity > 0) await logChat(roomId, u, f.masked, true, f.found);
    else await logChat(roomId, u, f.masked, false, []);
  });

  socket.on('resign', async () => {
    const u = await authOnce(); if (!u) return;
    const roomId = userRooms.get(u.id);
    const room = rooms.get(roomId ?? '');
    if (!room || room.finished) return;
    const side = sideOf(room, u.id);
    if (side === null) return;
    await finishGame(room, other(side), 'RESIGN');
  });

  socket.on('emote', async (d: { id?: string }) => {
    const u = await authOnce(); if (!u) return;
    // v0.2: emote packs — relay any well-formed id (client maps id→emoji from
    // its own catalog; unknown ids render a fallback). Charset + length bound.
    const id = String(d?.id ?? '');
    if (!/^[a-z0-9_]{1,16}$/.test(id)) return;
    const roomId = userRooms.get(u.id);
    if (roomId) io.to(roomId).emit('emote', { from: u.username, id: d?.id });
  });

  socket.on('rematch:accept', async () => {
    const u = await authOnce(); if (!u) return;
    const roomId = userRooms.get(u.id);
    const room = rooms.get(roomId ?? '');
    if (!room) return;
    if (!room.finished) return;
    room.rematch.add(u.id);
    const both = room.rematch.has(room.players[1].userId) && room.rematch.has(room.players[2].userId);
    if (both) {
      // swap sides & fresh board
      const p1 = room.players[1]; const p2 = room.players[2];
      const newP2: PlayerSlot = { ...p1 };
      room.players[1] = { ...p2 };
      room.players[2] = newP2;
      room.boardId = makeBoardId();
      startGame(room);
    } else {
      socket.emit('rematch:offered');
    }
  });
});

/* open private rooms awaiting second player */
const openRooms = new Map<string, { host: { socketId: string; user: UserInfo; ranked: boolean }; at: number }>();
void casualQueue; // documented alias — kept for clarity

/* ---------------- boot ---------------- */
refreshWords();
setInterval(refreshWords, 60_000);
// periodic cleanup of stale open rooms + stuck live rooms (both players
// vanished without the server noticing — half-open sockets, crashed tabs)
setInterval(() => {
  const now = Date.now();
  for (const [code, o] of openRooms) if (now - o.at > 10 * 60_000) openRooms.delete(code);
  for (const [id, room] of rooms) {
    const bothGone = ([1, 2] as PlayerId[]).every((s) => !io.sockets.sockets.get(room.players[s].socketId)?.connected);
    if (bothGone && !room.finished && now - (room.lastActivityAt ?? room.startedAt) > DISCONNECT_GRACE_MS * 2) {
      console.log(`[room] stuck (both players gone) — closing ${id} as draw`);
      void finishGame(room, 0, 'TIMEOUT'); // draw — nobody deserves the win
    }
    if (bothGone && room.finished && now - room.startedAt > ROOM_IDLE_TTL_MS) destroyRoom(id);
  }
}, 60_000);

const httpServer = io.httpServer as HttpServer;
httpServer.listen(PORT, () => {
  console.log(`[duel-socket] referee service listening on :${PORT}`);
});
