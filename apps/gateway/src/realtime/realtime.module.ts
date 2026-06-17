import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';

/**
 * RealtimeModule — the WS hub bridging the per-loop {@link EventStream} (Redis Streams
 * in prod) to cockpit clients. Wired into {@link AppModule}; activated by the
 * `WsAdapter` set in `main.ts`.
 */
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
