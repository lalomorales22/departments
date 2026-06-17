'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, X } from 'lucide-react';
import type { AccentKey } from '@departments/shared';
import type { DeptEvent, LogLevel } from '@departments/events';
import { getAgent, getLogs } from '@/lib/fixtures';
import { useCockpit, type LogTab } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
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
  // Autoscroll LOCK: stick to the bottom until the operator scrolls up, then surface a
  // "↓ N new" pill instead of yanking them back down.
  const [stuck, setStuck] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const prevLenRef = useRef(0);

  // Live events from a real engine run (streamed via the realtime store) are appended
  // after the fixture backlog, so "run a loop" shows raw phase progression live.
  const liveEvents = useRealtime((s) => s.liveEvents[loopId]);
  const runStatus = useRealtime((s) => s.runStatus[loopId]);

  const events = useMemo(() => {
    const kinds = TAB_KINDS[logTab];
    return [...getLogs(loopId), ...(liveEvents ?? [])]
      .filter((ev) => kinds.includes(ev.kind))
      .filter((ev) => (selectedAgentId ? eventAgentId(ev) === selectedAgentId : true));
  }, [loopId, logTab, selectedAgentId, liveEvents]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStuck(true);
    setNewCount(0);
  };

  // When the visible stream grows: follow the bottom if stuck, else count unseen lines.
  useEffect(() => {
    const added = events.length - prevLenRef.current;
    prevLenRef.current = events.length;
    if (stuck) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (added > 0) {
      setNewCount((n) => n + added);
    }
  }, [events, stuck]);

  // Reset scroll position + lock when the loop/tab/scope changes.
  useEffect(() => {
    prevLenRef.current = events.length;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStuck(true);
    setNewCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopId, logTab, selectedAgentId]);

  // Track whether the operator is pinned to the bottom (within a small threshold).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStuck(atBottom);
    if (atBottom) setNewCount(0);
  };

  const scopedAgent = selectedAgentId ? getAgent(selectedAgentId) : undefined;

  return (
    <section className="panel-inset flex min-h-0 flex-col font-mono text-xs">
      {/* Header: label + tab switches */}
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-2">
          <SectionLabel>TERMINAL / LOGS</SectionLabel>
          {runStatus === 'running' && (
            <span
              className="inline-flex items-center gap-1 text-2xs tracking-wider"
              style={{ color: accentVar('green') }}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full"
                style={{ backgroundColor: accentVar('green') }}
                aria-hidden
              />
              RUNNING
            </span>
          )}
        </div>
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
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={`${logTab} stream`}
          className="h-full overflow-y-auto px-3 py-2 leading-relaxed"
        >
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

        {/* Autoscroll-lock pill: jump back to the live tail without losing your place. */}
        {!stuck && newCount > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="focus-ring absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-accent-cyan/40 bg-surface-2 px-2 py-0.5 text-2xs tracking-wider text-accent-cyan shadow-glow-cyan"
            style={{ backgroundColor: 'color-mix(in oklab, var(--accent-cyan) 12%, var(--surface-2))' }}
          >
            <ArrowDown className="h-3 w-3" strokeWidth={2} aria-hidden />
            {newCount} NEW
          </button>
        )}
      </div>
    </section>
  );
}
