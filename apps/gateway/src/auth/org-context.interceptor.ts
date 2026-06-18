/**
 * RLS org-context interceptor (authored; DB pool gated). The HARD tenant boundary:
 * before any handler runs, open a per-request transaction and
 *   SELECT set_config('app.current_org', <orgId>, true);   -- tx-local
 *   SELECT set_config('app.current_user', <userId>, true); -- for the audit trigger
 * so every query inside the request sees Postgres Row-Level Security (0003/0006) scoped
 * to the caller's org — never trust an app-level `WHERE org_id = …` alone.
 *
 * Without a DB pool injected, this is a documented pass-through (the rest of the gateway
 * still runs against fixtures/the realtime spine). The `setOrgContext` SQL is the exact
 * statement the production pool runs per request.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthedRequest } from './rbac.js';

/** The minimal pool surface this interceptor needs (so it doesn't import a driver). */
export interface OrgContextPool {
  withTransaction<T>(
    fn: (setOrgContext: (orgId: string, userId?: string) => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class OrgContextInterceptor implements NestInterceptor {
  constructor(private readonly pool?: OrgContextPool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> | Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const orgId = req.user?.orgId;
    // No pool wired (local build) OR no org (open route): pass through unchanged.
    if (!this.pool || !orgId) return next.handle();
    return this.pool.withTransaction(async (setOrgContext) => {
      // SET LOCAL app.current_org / app.current_user — RLS + the audit trigger read these.
      await setOrgContext(orgId, req.user?.userId);
      return next.handle();
    });
  }
}
