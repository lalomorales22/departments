import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';

/**
 * Root module — STUB.
 *
 * Phase 2+ wiring lands here as feature modules:
 *  - AuthModule          (session/JWT verification, attaches caller + org)
 *  - RbacModule          (role guards: VIEWER / OPERATOR / COMMANDER)
 *  - PersistenceModule   (@departments/db pool + RLS org-context interceptor)
 *  - GraphqlModule       (code-first schema) alongside the REST controllers
 *  - RealtimeModule      (WS hub bridging Redis Streams -> clients)
 *  - CostModule          (@departments/cost budget/limit enforcement)
 */
@Module({
  imports: [],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
