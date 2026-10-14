export interface Preferences {
  sound: boolean;
  volume: number;
  music: boolean;
  animations: 'full' | 'reduced' | 'off';
  /** Partículas y celebraciones visuales. */
  effects: 'full' | 'reduced' | 'off';
  showOddsNotes: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'player' | 'admin';
  createdAt: string;
  balance: number | null;
  unlimited: boolean;
  preferences: Preferences;
}

export interface Balance {
  balance: number | null;
  unlimited: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold';
  unlockedAt?: string | null;
}
