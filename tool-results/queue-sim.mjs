import { io } from 'socket.io-client';
const token = process.argv[2];
const sock = io('http://localhost:3003', { transports: ['polling'], extraHeaders: { cookie: `doi_session=${token}` } });
sock.on('connect', () => { console.log('connected'); sock.emit('queue:join', { ranked: true }); });
sock.on('queued', () => console.log('queued'));
sock.on('match', (d) => { console.log('MATCH side', d.yourSide, 'ranked', d.ranked); setTimeout(()=>process.exit(0), 1500); });
sock.on('error', (d) => { console.log('ERR', JSON.stringify(d)); process.exit(1); });
setTimeout(() => process.exit(0), 25000);
