import { describe, expect, it } from 'vitest';
import {
  autoApproveToolGate,
  denyToolGate,
  isIrreversibleTool,
  ManualToolGate,
  type ToolConfirmRequest,
} from './tool-gate.js';

const REQ: ToolConfirmRequest = {
  loopId: 'loop-x',
  runId: 'run-x',
  phase: 'execute',
  tool: 'github.deploy',
  summary: 'deploy to prod',
};

describe('isIrreversibleTool', () => {
  it('flags deploy / send / spend / delete families (namespaced too)', () => {
    for (const t of ['github.deploy', 'email.send', 'stripe.charge', 'fs.delete', 'mcp:slack.post', 'db.drop', 'wallet.transfer']) {
      expect(isIrreversibleTool(t)).toBe(true);
    }
  });

  it('leaves reversible tools alone', () => {
    for (const t of ['memory.query', 'fs.write', 'web_search', 'fs.read', 'git.commit']) {
      expect(isIrreversibleTool(t)).toBe(false);
    }
  });
});

describe('policy gates', () => {
  it('auto-approve allows', async () => {
    expect(await autoApproveToolGate.confirm(REQ)).toEqual({ allow: true });
  });

  it('deny gate denies with a reason', async () => {
    const d = await denyToolGate('nope').confirm(REQ);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('nope');
  });
});

describe('ManualToolGate — FIFO confirmation', () => {
  it('blocks until decided, oldest first', async () => {
    const gate = new ManualToolGate();
    const a = gate.confirm({ ...REQ, tool: 'a.deploy' });
    const b = gate.confirm({ ...REQ, tool: 'b.send' });
    expect(gate.pending).toBe(2);
    gate.decide({ allow: true });
    gate.decide({ allow: false, reason: 'risky' });
    expect(await a).toEqual({ allow: true });
    expect(await b).toEqual({ allow: false, reason: 'risky' });
    expect(gate.pending).toBe(0);
  });

  it('releaseAll denies everything outstanding and future calls', async () => {
    const gate = new ManualToolGate();
    const pending = gate.confirm(REQ);
    gate.releaseAll();
    expect((await pending).allow).toBe(false);
    expect((await gate.confirm(REQ)).allow).toBe(false);
  });
});
