import { Controller, Get } from '@nestjs/common';
import { EVENT_PROTOCOL_VERSION } from '@departments/events';

/**
 * STUB controller. Phase 1 exposes only a liveness probe and a hollow
 * `/loops` route so the cockpit's data layer has a URL to point at while
 * everything still reads from FIXTURES. No DB, no auth, no org-context yet.
 */
@Controller()
export class AppController {
  /** Liveness/readiness probe. Used by docker/k8s healthchecks. */
  @Get('health')
  health(): { status: 'ok'; service: 'gateway'; protocol: number; ts: string } {
    return {
      status: 'ok',
      service: 'gateway',
      // Pin the frozen event-protocol version this gateway speaks.
      protocol: EVENT_PROTOCOL_VERSION,
      ts: new Date().toISOString(),
    };
  }

  /**
   * Placeholder loops index.
   *
   * TODO(Phase 2): replace with a real handler that
   *   1. resolves the caller's org via the auth middleware,
   *   2. opens an RLS-scoped txn (`SET app.current_org = <orgId>`),
   *   3. selects loops for that org from @departments/db,
   *   4. shapes rows into the `Loop` type from @departments/shared.
   * For now it returns [] so the contract (GET /loops -> Loop[]) exists.
   */
  @Get('loops')
  loops(): [] {
    return [];
  }
}
