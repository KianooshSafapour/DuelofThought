/** R8 QA: two sockets queue ranked and duel each other — used to light up in-duel presence. */
import { io } from 'socket.io-client';

const cookieA = process.argv[2];
const cookieB = process.argv[3];
if (!cookieA || !cookieB) { console.error('usage: node r8-duel-pair.mjs <cookieA> <cookieB>'); process.exit(1); }

const mk = (cookie, label) => {
  const s = io('http://localhost:3003', {
    transports: ['polling', 'websocket'],
    extraHeaders: { cookie },
    reconnectionAttempts: 5,
  });
  let side = 1;
  let finished = false;
  s.on('connect', () => { console.log(label, 'connected'); s.emit('presence:hello'); setTimeout(() => s.emit('queue:join', { ranked: true }), 400); });
  s.on('match', (d) => { side = d.yourSide; console.log(label, 'MATCH side', side, 'vs', d.opponent.username); });
  s.on('state', (d) => {
    const st = typeof d.state === 'string' ? JSON.parse(d.state) : d.state;
    if (st.finished || st.result) {
      if (!finished) { finished = true; console.log(label, 'game over'); }
      return;
    }
    if (st.turn === side) {
      setTimeout(() => { const col = Math.floor(Math.random() * 9); console.log(label, 'move', col); s.emit('move', { col }); }, 7000);
    }
  });
  s.on('game:over', () => { console.log(label, 'game:over'); });
  return s;
};

mk(cookieA, 'A');
mk(cookieB, 'B');
setTimeout(() => process.exit(0), 45_000);
