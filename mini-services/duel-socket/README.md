# duel-socket — Multiplayer Referee (port 3003)

Server-authoritative socket.io service for Duel of Ideas online games.
- Auth: parses `doi_session` cookie from handshake, verifies via Next `/api/mp/verify` (5-min cache).
- Matchmaking: FIFO queue with ELO-gap tolerance widening (+100 per 5s wait); ranked & casual; private 4-char room codes (`room:create` / `room:join`).
- Protocol in: `queue:join{ranked} queue:leave room:create room:join{code} move{col} chat{text} resign rematch:accept emote{id}`
- Protocol out: `match{yourSide,boardId,ranked,opponent} state{state} move:bad chat{from,text} chat:blocked opponent:left rematch:offered emote game:rewards{coins,xp,eloDelta,level,unlockedAchievements} error{code}`
- Moves validated + applied via shared engine (copied as `engine.ts`); 45s move timer → TIMEOUT loss; 60s disconnect grace.
- Chat: word-filter (normalized Persian/Arabic variants), 1 msg/1.5s, severity 3 → block + auto-resign; all messages logged to Next.
- Results POST `/api/mp/result` (x-internal-key) → per-player coins/XP/ELO broadcast as `game:rewards`.
