/**
 * @departments/gateway — Phase 1 STUB.
 *
 * Boots a minimal NestJS app on :4000 with a single `/health` route (and a
 * hollow `/loops`). It compiles and runs, but it does NOT do anything real yet:
 * the cockpit UI still reads from FIXTURES. This file is the seam where the
 * production gateway grows in Phase 2+.
 *
 * Requires the Phase 1 dev stack only in later phases (postgres/redis/temporal/
 * minio via `docker compose up -d`); the bare /health boot needs nothing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ROADMAP — where the real machinery attaches (kept as comments on purpose):
 *
 *  [AUTH MIDDLEWARE]   Verify session/JWT, resolve the caller + their org, and
 *                      attach `{ userId, orgId, roles }` to the request. Reject
 *                      anonymous traffic before it reaches any resolver.
 *
 *  [RBAC GUARDS]       NestJS guards keyed off `roles` (VIEWER/OPERATOR/COMMANDER)
 *                      gating mutations (run_now, pause, kill) vs. reads.
 *
 *  [RLS ORG-CONTEXT]   Per-request DB txn that runs `SET app.current_org = $orgId`
 *                      so Postgres Row-Level Security scopes every query to the
 *                      caller's org. This is the hard tenant boundary — never
 *                      trust an app-level `WHERE org_id = ...` alone.
 *
 *  [GraphQL + REST]    Code-first GraphQL schema for the cockpit's rich reads,
 *                      plus thin REST controllers (this stub's AppController) for
 *                      probes/webhooks. Both share the same guarded services.
 *
 *  [WS HUB / REPLAY]   Realtime spine. Subscribes to per-loop Redis Streams
 *                      (`loopStreamKey(loopId)` from @departments/events) and
 *                      fans `DeptEvent`s out over WS topics:
 *                        - loopTopic(loopId, 'status' | 'pipeline' | 'logs' | 'metrics')
 *                        - agentTopic(agentId)
 *                        - tasksTopic(loopId)
 *                        - SYSTEM_TOPIC
 *                      Honors `ResumeCursor (loopId, lastSeq)` for replay and
 *                      `isAlwaysSettle()` so terminal status/metric/error events
 *                      re-settle on reconnect. A MOCK event-replay source (driving
 *                      the same topics from fixtures) lands here first so the UI
 *                      can be exercised before the CMA normalizer exists.
 * ───────────────────────────────────────────────────────────────────────────
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

const PORT = Number(process.env.PORT ?? 4000);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // [AUTH MIDDLEWARE]  app.use(authMiddleware)             — Phase 2
  // [RBAC GUARDS]      app.useGlobalGuards(new RbacGuard()) — Phase 2
  // [RLS ORG-CONTEXT]  app.useGlobalInterceptors(orgCtx)    — Phase 2
  // [WS HUB / REPLAY]  RealtimeModule fans the per-loop EventStream out over /ws with
  //                    resume-by-seq + dedupe + heartbeats (Phase 3, this build).
  app.useWebSocketAdapter(new WsAdapter(app));

  await app.listen(PORT);
  // eslint-disable-next-line no-console
  console.log(`[gateway] listening on :${PORT} (GET /health, GET /loops, WS /ws)`);
}

void bootstrap();
