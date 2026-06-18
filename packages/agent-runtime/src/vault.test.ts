import { describe, expect, it } from 'vitest';
import {
  CmaVault,
  InMemoryVault,
  injectSecrets,
  isVaultRef,
  parseVaultRef,
  vaultRef,
} from './vault.js';
import { containsSecret } from './security.js';

describe('VaultRef', () => {
  it('builds, recognizes, and parses refs', () => {
    const ref = vaultRef('acme', 'github-token');
    expect(ref).toBe('vault://acme/github-token');
    expect(isVaultRef(ref)).toBe(true);
    expect(isVaultRef('ghp_realtoken')).toBe(false);
    expect(parseVaultRef(ref)).toEqual({ vaultId: 'acme', key: 'github-token' });
  });

  it('rejects malformed refs', () => {
    expect(() => parseVaultRef('vault://acme' as never)).toThrow(/malformed/);
  });

  it('a ref is not a secret (handle, not value)', () => {
    expect(containsSecret(vaultRef('acme', 'api-key'))).toBe(false);
  });
});

describe('InMemoryVault + injectSecrets', () => {
  it('resolves only at egress; refs carry no secret', async () => {
    const vault = new InMemoryVault();
    vault.set('acme', 'github-token', 'ghp_realtokenvalue0123456789');
    const ref = vaultRef('acme', 'github-token');
    expect(vault.has(ref)).toBe(true);
    expect(await vault.resolve(ref)).toContain('ghp_');
  });

  it('injects refs into headers at egress, passing plain values through', async () => {
    const vault = new InMemoryVault();
    vault.set('acme', 'token', 'ghp_secretsecretsecret123456');
    const headers = { Authorization: vaultRef('acme', 'token'), 'X-Trace': 'plain' };
    // The OUTBOUND config (pre-injection) holds a ref, not a secret.
    expect(containsSecret(headers.Authorization)).toBe(false);
    const injected = await injectSecrets(vault, headers);
    expect(injected.Authorization).toBe('ghp_secretsecretsecret123456');
    expect(injected['X-Trace']).toBe('plain');
  });

  it('throws on an unknown ref', async () => {
    await expect(new InMemoryVault().resolve(vaultRef('x', 'y'))).rejects.toThrow(/no secret bound/);
  });
});

describe('CmaVault (gated)', () => {
  it('throws NotImplemented without creds', async () => {
    await expect(new CmaVault({ vaultId: 'acme' }).resolve(vaultRef('acme', 'k'))).rejects.toThrow(
      /requires ANTHROPIC_API_KEY/,
    );
  });
});
