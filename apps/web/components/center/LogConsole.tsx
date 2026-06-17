'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import type { AccentKey } from '@departments/shared';
import type { DeptEvent, LogLevel } from '@departments/events';
import { getAgent, getLogs } from '@/lib/fixtures';
import { useCockpit, type LogTab } from '@/lib/store';
import { accentVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/atoms';

const LOG_TABS: readonly LogTab[] = ['LOGS', 'DEBUG', 'OUTPUT'];

/** Which event kinds belong to each console tab. */
const TAB_KINDS: Record<LogTab, ReadonlyArray<DeptEvent['kind']>> = {
  LOGS: ['log', 'status', 'error', 'agent_msg'],
  DEBUG: ['debug', 'tool_use'],
  OUTPUT: ['output'],
};

/** log level → accent key (info=blue, warn=amber, error=red, debug=muted-ish purple). */
const LEVEL_ACCENT: Record<LogLevel, AccentKey> = {
  info: 'blue',
  warn: 'amber',
  error: 'red',
  debug: 'purple',
};

/** The short uppercase tag shown per line, plus its resolved accent. */
function lineTag(ev: DeptEvent): { label: string; accent: AccentKey | null } {
  switch (ev.kind) {
    case 'log':
      return { label: ev.payload.level.toUpperCase(), accent: LEVEL_ACCENT[ev.payload.level] };
    case 'tool_use':
      return { label: 'TOOL', accent: 'purple' };
    case 'agent_msg':
      return { label: 'MSG', accent: 'cyan' };
    case 'output':
      return { label: 'OUT', accent: 'green' };
    case 'error':
      return { label: 'ERR', accent: 'red' };
    case 'debug':
      return { label: 'DBG', accent: 'blue' };
    case 'status':
      return { label: 'STAT', accent: null }; // muted
    case 'metric':
      return { label: 'METR', accent: null };
    default:
      return { label: 'LOG', accent: null };
  }
}

/** A readable one-line message synthesized from the event payload. */
function lineMessage(ev: DeptEvent): string {
  switch (ev.kind) {
    case 'log':
      return ev.payload.source ? `[${ev.payload.source}] ${ev.payload.message}` : ev.payload.message;
    case 'debug':
      return ev.payload.message;
    case 'output':
      return ev.payload.text;
    case 'agent_msg':
      return ev.payload.message;
    case 'tool_use':
      return `${ev.payload.tool} · ${ev.payload.phase} — ${ev.payload.summary}`;
    case 'status': {
      const p = ev.payload;
      const bits = [
        `${p.scope}:${p.targetId}`,
        p.loopStatus ? `→ ${p.loopStatus.toUpperCase()}` : null,
        p.agentStatus ? `→ ${p.agentStatus.toUpperCase()}` : null,
        p.phase ? `phase ${p.phase.toUpperCase()}` : null,
      ].filter(Boolean);
      return bits.join(' ');
    }
    case 'metric':
      return `${ev.payload.name} = ${ev.payload.display} (${ev.payload.delta >= 0 ? '+' : ''}${ev.payload.delta}%)`;
    case 'error':
      return ev.payload.code ? `${ev.payload.code}: ${ev.payload.message}` : ev.payload.message;
    default:
      return '';
  }
}

/** Pull the agentId off any payload that carries one (for agent scoping). */
function eventAgentId(ev: DeptEvent): string | null {
  if ('agentId' in ev.payload && typeof ev.payload.agentId === 'string') {
    return ev.payload.agentId;
  }
  return null;
}

/** HH:MM:SS gutter from an ISO timestamp. */
function clock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function LogConsole({ loopId }: { loopId: string }) {
  const logTab = useCockpit((s) => s.logTab);
  const setLogTab = useCockpit((s) => s.setLogTab);
  const selectedAgentId = useCockpit((s) => s.selectedAgentId);
  const setSelectedAgent = useCockpit((s) => s.setSelectedAgent);

  const scrollRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    const kinds = TAB_KINDS[logTab];
    return getLogs(loopId)
      .filter((ev) => kinds.includes(ev.kind))
      .filter((ev) => (selectedAgentId ? eventAgentId(ev) === selectedAgentId : true));
  }, [loopId, logTab, selectedAgentId]);

  // Autoscroll to bottom whenever the visible stream changes (mount + tab/scope/loop swap).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const scopedAgent = selectedAgentId ? getAgent(selectedAgentId) : undefined;

  return (
    <section className="panel-inset flex min-h-0 flex-col font-mono text-xs">
      {/* Header: label + tab switches */}
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <SectionLabel>TERMINAL / LOGS</SectionLabel>
        <nav className="flex items-center gap-3" aria-label="Console stream">
          {LOG_TABS.map((tab) => {
            const active = tab === logTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setLogTab(tab)}
                aria-pressed={active}
                className={cn(
                  'focus-ring relative -mb-px rounded-sm px-0.5 py-1 text-2xs tracking-wider transition-colors',
                  active ? 'text-accent-cyan' : 'text-faint hover:text-muted',
                )}
              >
                {tab}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-2 h-px"
                    style={{ backgroundColor: accentVar('cyan') }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Agent scope chip */}
      {scopedAgent && (
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
          <span className="eyebrow">scoped to</span>
          <button
            type="button"
            onClick={() => setSelectedAgent(null)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-2 px-1.5 py-0.5 text-2xs text-muted hover:border-hairline-strong hover:text-text"
          >
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: accentVar('cyan') }}
              aria-hidden
            />
            <span className="truncate">{scopedAgent.name}</span>
            <X className="h-3 w-3" strokeWidth={2} aria-label="Clear agent scope" />
          </button>
        </div>
      )}

      {/* Stream */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 leading-relaxed">
        {events.length === 0 ? (
          <p className="py-6 text-center text-2xs text-faint">
            no {logTab.toLowerCase()} events{scopedAgent ? ' for this agent' : ''}
          </p>
        ) : (
          <ol className="space-y-0.5">
            {events.map((ev, i) => {
              const { label, accent } = lineTag(ev);
              const last = i === events.length - 1;
              return (
                <li key={ev.id} className="flex items-baseline gap-2 tabular">
                  <span className="shrink-0 select-none text-faint">{clock(ev.ts)}</span>
                  <span
                    className={cn('w-10 shrink-0 select-none text-right', accent === null && 'text-muted')}
                    style={accent ? { color: accentVar(accent) } : undefined}
                  >
                    {label}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text">
                    {lineMessage(ev)}
                    {last && (
                      <span
                        aria-hidden
                        className="ml-1 inline-block h-3 w-1.5 translate-y-px animate-blink align-middle"
                        style={{ backgroundColor: accentVar('cyan') }}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
