'use client';
/** Client API helpers + shared types */

export interface SafeUserDTO {
  id: string; username: string; role: string; isGuest: boolean;
  banned: boolean; banReason: string | null; bannedUntil: string | null;
  coins: number; xp: number; level: number; rating: number;
  wins: number; losses: number; draws: number; gamesPlayed: number;
  streak: number; bestStreak: number; locale: string; bio: string;
  pieceSkin: string; boardSkin: string; background: string; effectSkin: string;
  avatarItem: string; titleItem: string | null; showcase: string[]; soundOn: boolean;
  emotePack?: string; celebrationPack?: string; phone?: string | null;
  createdAt: string;
}

export interface SessionDTO { user: SafeUserDTO; owned: string[] }
export interface ApplyResultDTO {
  coins: number; xp: number; eloDelta: number | null; levelUps: number;
  unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[];
  completedQuests: { id: string; reward: number }[];
  user: { coins: number; xp: number; level: number; rating: number; wins: number; losses: number; draws: number; gamesPlayed: number; streak: number; bestStreak: number };
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error ?? `HTTP_${res.status}`);
    (err as Error & { payload?: unknown }).payload = data;
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body ?? {}),
    }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body?: unknown) =>
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body ?? {}),
    }).then((r) => handle<T>(r)),
  del: <T>(url: string) => fetch(url, { method: 'DELETE' }).then((r) => handle<T>(r)),
};
