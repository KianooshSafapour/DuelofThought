/** Shared constants (client & server safe) */
export const LEVEL_UP_COIN_BONUS = 25;
export const MOVE_TIME_MS = 45_000; // online per-move timer
export const MAX_BIO_LEN = 140;
export const MAX_CHAT_LEN = 200;
export const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'doi-internal-2024-secure-key';
