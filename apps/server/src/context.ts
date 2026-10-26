import type { AppConfig } from './config';
import type { Database } from './db/database';
import type { PokerManager } from './poker/manager';
import type { BlackjackManager } from './blackjack/manager';
import type { BotPool } from './bots/pool';
import type { AdsService } from './ads/ads';
import type { SocialService } from './social/social';
import type { RoomService } from './rooms/rooms';
import type { RealtimeHub } from './realtime/hub';
import type { CrashGame } from './crash/crash';
import type { BingoManager } from './bingo/bingo';
import type { LookService } from './profile/profile';

export interface AppContext {
  config: AppConfig;
  db: Database;
  realtime: RealtimeHub;
  poker: PokerManager;
  blackjack: BlackjackManager;
  bots: BotPool;
  ads: AdsService;
  social: SocialService;
  rooms: RoomService;
  crash: CrashGame;
  bingo: BingoManager;
  looks: LookService;
  startedAt: number;
}
