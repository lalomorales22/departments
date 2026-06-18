/**
 * Server-side RBAC — the AUTHORITATIVE capability check (the cockpit's gating is only
 * cosmetic; this is the real boundary). A `@RequireCapability(...)` decorator tags a
 * route with the capabilities it needs; {@link RbacGuard} reads the caller's role
 * (attached by the auth middleware) and rejects with 403 unless the role holds EVERY
 * required capability — using the SAME {@link RBAC_MATRIX} the UI imports, so the two
 * can never drift.
 */
import { SetMetadata, type CanActivate, type ExecutionContext, ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Capability, type UserRole } from '@departments/shared';

/** The request shape the auth middleware populates. */
export interface AuthedRequest {
  user?: { userId: string; orgId: string; role: UserRole };
  headers: Record<string, string | string[] | undefined>;
}

export const CAPABILITIES_KEY = 'required_capabilities';

/** Tag a handler/controller with the capabilities it requires. */
export const RequireCapability = (...capabilities: Capability[]) =>
  SetMetadata(CAPABILITIES_KEY, capabilities);

/**
 * Rejects a request unless the caller's role holds every capability the route requires.
 * Routes with no `@RequireCapability` are open (e.g. /health). An unauthenticated caller
 * on a guarded route is rejected (fail closed).
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[] | undefined>(CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // open route

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const role = req.user?.role;
    if (!role) throw new ForbiddenException('authentication required');
    const missing = required.filter((c) => !can(role, c));
    if (missing.length > 0) {
      throw new ForbiddenException(`role "${role}" lacks: ${missing.join(', ')}`);
    }
    return true;
  }
}

/**
 * Auth middleware (authored; identity provider gated). Resolves the caller → role + org
 * from a verified session/JWT and attaches `{ userId, orgId, role }` to the request, so
 * {@link RbacGuard} and the RLS org-context interceptor can both read it. The header
 * shortcut below is a DEV stand-in; production verifies a real token (Clerk/Auth0/WorkOS)
 * — never trust these headers in prod.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: AuthedRequest, _res: unknown, next: () => void): void {
    const header = (name: string): string | undefined => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const userId = header('x-user-id');
    const orgId = header('x-org-id');
    const role = header('x-user-role') as UserRole | undefined;
    if (userId && orgId && role) {
      // DEV ONLY: trust headers. PROD: verify a signed token and resolve the app_user row.
      req.user = { userId, orgId, role };
    }
    next();
  }
}
