/**
 * Vaults — third-party credentials referenced by HANDLE, injected at egress, never
 * visible in the sandbox/prompt/artifact/event history.
 *
 * The platform's secret discipline (README → Security): agent-facing creds live in CMA
 * Vaults; the runtime resolves a {@link VaultRef} to a real value ONLY at the egress
 * boundary (an MCP OAuth header, a custom-tool env var) and never hands it to the
 * model. A prompt/tool config carries the *ref* (`vault://acme/github-token`), so a
 * leaked prompt or event log exposes a handle, not a secret.
 *
 * This file owns the contract + an in-memory fake (local/dev/tests) + a gated CMA
 * adapter (throws without creds), mirroring the runtime's CMA-vs-fake split.
 */

/** Opaque reference to a secret in a vault: `vault://<vaultId>/<key>`. */
export type VaultRef = `vault://${string}`;

/** Build a {@link VaultRef} from a vault id + key. */
export function vaultRef(vaultId: string, key: string): VaultRef {
  return `vault://${vaultId}/${key}`;
}

/** Whether a string is a vault reference (so prompts can be scanned for inlined secrets vs refs). */
export function isVaultRef(value: string): value is VaultRef {
  return value.startsWith('vault://');
}

/** Parse a {@link VaultRef} into its parts. Throws on a malformed ref. */
export function parseVaultRef(ref: VaultRef): { vaultId: string; key: string } {
  const rest = ref.slice('vault://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(`malformed vault ref: ${ref} (expected vault://<vaultId>/<key>)`);
  }
  return { vaultId: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

/**
 * The vault boundary. `resolve` is the ONLY place a real secret value exists, and it is
 * called at egress (header/env injection), not in the request path the model sees.
 */
export interface VaultPort {
  /** Resolve a ref to its secret value at egress. Throws if the ref is unknown. */
  resolve(ref: VaultRef): Promise<string>;
  /** Whether a ref is bound (so a pre-flight can fail fast before a run). */
  has(ref: VaultRef): boolean;
}

/**
 * Inject vault refs into a header map at egress: every value that is a {@link VaultRef}
 * is replaced by its resolved secret; plain values pass through. This is how an MCP
 * server's `Authorization` header gets its token without the token ever being in the
 * agent's config. Returns a NEW map (never mutates input).
 */
export async function injectSecrets(
  vault: VaultPort,
  headers: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isVaultRef(value) ? await vault.resolve(value) : value;
  }
  return out;
}

/**
 * In-memory vault for local/dev/tests. Holds secrets keyed by ref; the values never
 * cross the model boundary because callers pass refs and only egress code calls
 * `resolve`. NOT for production secrets (no encryption at rest) — that is the CMA vault.
 */
export class InMemoryVault implements VaultPort {
  private readonly store = new Map<string, string>();

  /** Bind a secret to `vault://<vaultId>/<key>`. */
  set(vaultId: string, key: string, value: string): void {
    this.store.set(vaultRef(vaultId, key), value);
  }

  has(ref: VaultRef): boolean {
    return this.store.has(ref);
  }

  async resolve(ref: VaultRef): Promise<string> {
    const value = this.store.get(ref);
    if (value === undefined) throw new Error(`vault: no secret bound for ${ref}`);
    return value;
  }
}

/**
 * Gated CMA Vault adapter — egress injection against CMA Vaults. Authored but inert
 * without creds (mirrors `CmaRuntime`): it throws a loud NotImplemented so the
 * deployment wiring is explicit and a missing-creds run never silently no-ops.
 */
export class CmaVault implements VaultPort {
  constructor(private readonly opts: { apiKey?: string; vaultId: string }) {}

  has(_ref: VaultRef): boolean {
    return false;
  }

  async resolve(ref: VaultRef): Promise<string> {
    if (!this.opts.apiKey) {
      throw new Error(
        `CmaVault.resolve(${ref}) requires ANTHROPIC_API_KEY + a provisioned CMA Vault — ` +
          'gated behind creds (see README → Security: CMA Vaults / egress injection).',
      );
    }
    // Real implementation: GET the vault binding via client.beta.vaults.* and inject at
    // egress. Intentionally NotImplemented here so the gated path ships explicit.
    throw new Error('CmaVault is not implemented in this build (gated CMA path).');
  }
}
