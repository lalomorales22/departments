import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { RealtimeModule } from './realtime/realtime.module.js';

/**
 * Root module. The Phase 3 RealtimeModule (WS hub over the EventStream spine) is wired
 * now. Remaining Phase 2+ feature modules land here:
 *  - AuthModule          (session/JWT verification, attaches caller + org)
 *  - RbacModule          (role guards: VIEWER / OPERATOR / COMMANDER)
 *  - PersistenceModule   (@departments/db pool + RLS org-context interceptor)
 *  - GraphqlModule       (code-first schema) alongside the REST controllers
 *  - CostModule          (@departments/cost budget/limit enforcement)
 */
@Module({
  imports: [RealtimeModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
