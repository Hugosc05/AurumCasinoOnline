import type { AppConfig } from './config';
import type { Database } from './db/database';
import type { PokerManager } from './poker/manager';
import type { RealtimeHub } from './realtime/hub';

export interface AppContext {
  config: AppConfig;
  db: Database;
  realtime: RealtimeHub;
  poker: PokerManager;
  startedAt: number;
}
