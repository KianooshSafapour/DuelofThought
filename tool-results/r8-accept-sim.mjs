/** R8 QA: presence-only sim that stays online and auto-accepts any friend challenge. */
import { io } from 'socket.io-client';

const cookie = process.argv[2];
const label = process.argv[3] ?? 'SIM';
if (!cookie) { console.error('usage: node r8-accept-sim.mjs <cookie> [label]'); process.exit(1); }

const s = io('http://localhost:3003', {
  transports: ['polling', 'websocket'],
  extraHeaders: { cookie },
  reconnectionAttempts: 10,
});

let side = 1;
s.on('connect', () => { console.log(label, 'online'); s.emit('presence:hello'); });
s.on('challenge:incoming', (d) => {
  console.log(label, 'challenge from', d.from?.username, '— accepting');
  setTimeout(() => s.emit('challenge:accept', { id: d.id }), 1200);
});
s.on('match', (d) => { side = d.yourSide; console.log(label, 'MATCH side', side, 'vs', d.opponent.username); });
s.on('state', (d) => {
  const st = typeof d.state === 'string' ? JSON.parse(d.state) : d.state;
  if (st.finished || st.result) return;
  if (st.turn === side) setTimeout(() => { const col = Math.floor(Math.random() * 9); console.log(label, 'move', col); s.emit('move', { col }); }, 1500);
});
s.on('game:over', () => console.log(label, 'game over'));
s.on('disconnect', () => console.log(label, 'disconnected'));

setTimeout(() => { console.log(label, 'done'); process.exit(0); }, 75_000);
