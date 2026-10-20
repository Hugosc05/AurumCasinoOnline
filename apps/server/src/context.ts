import type { AppConfig } from './config';
import type { Database } from './db/database';
import type { PokerManager } from './poker/manager';
import type { BlackjackManager } from './blackjack/manager';
import type { BotPool } from './bots/pool';
import type { AdsService } from './ads/ads';
import type { SocialService } from './social/social';
import type { RoomService } from './rooms/rooms';
import type { RealtimeHub } from './realtime/hub';

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
  startedAt: number;
}
