import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { AuthMiddleware, RbacGuard } from './auth/rbac.js';
import { OrgContextInterceptor } from './auth/org-context.interceptor.js';

/**
 * Root module. Phase 3 wired the RealtimeModule (WS hub over the EventStream spine);
 * Phase 5 wires the security spine: the AuthMiddleware (resolves caller → role + org),
 * the RBAC guard (capability checks against the shared RBAC_MATRIX), and the RLS
 * org-context interceptor (the hard tenant boundary). The DB pool + identity provider
 * stay gated (Docker/creds); the guard + capability decorators are live.
 *
 * Remaining gated modules: PersistenceModule (@departments/db pool), GraphqlModule,
 * CostModule (@departments/cost enforcement).
 */
@Module({
  imports: [RealtimeModule],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: RbacGuard },
    // No pool wired locally → the interceptor passes through (see OrgContextInterceptor).
    { provide: APP_INTERCEPTOR, useFactory: () => new OrgContextInterceptor() },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
