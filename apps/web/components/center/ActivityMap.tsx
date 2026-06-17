'use client';

import { useMemo } from 'react';
import { ACTIVITY_ARCS, ACTIVITY_NODES } from '@/lib/fixtures';
import { accentVar } from '@/lib/status-theme';
import { SectionLabel } from '@/components/atoms';

const VIEW_W = 360;
const VIEW_H = 180;

/** Equirectangular projection into the 360×180 viewBox. */
function project(lng: number, lat: number): { x: number; y: number } {
  return {
    x: ((lng + 180) / 360) * VIEW_W,
    y: ((90 - lat) / 180) * VIEW_H,
  };
}

/**
 * Crude continent silhouettes in viewBox space (x→right, y→down). Not geographically
 * exact — just enough to make the dot field read as a world map.
 */
const CONTINENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // North America
  [[52, 30], [86, 21], [118, 28], [120, 40], [108, 52], [92, 60], [72, 74], [58, 58], [46, 42]],
  // South America
  [[104, 82], [128, 79], [137, 94], [129, 116], [118, 142], [109, 120], [102, 100]],
  // Europe
  [[168, 30], [206, 25], [214, 39], [198, 50], [176, 49], [165, 39]],
  // Africa
  [[176, 54], [214, 51], [227, 73], [214, 101], [197, 124], [185, 98], [173, 73]],
  // Asia
  [[214, 27], [300, 22], [328, 39], [320, 61], [286, 73], [246, 67], [220, 49]],
  // Australia
  [[296, 103], [332, 99], [338, 116], [316, 128], [297, 119]],
];

/** Ray-casting point-in-polygon. */
function inPoly(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      pi[1] > y !== pj[1] > y &&
      x < ((pj[0] - pi[0]) * (y - pi[1])) / (pj[1] - pi[1] || 1e-9) + pi[0];
    if (intersect) inside = !inside;
  }
  return inside;
}

export function ActivityMap() {
  const coords = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of ACTIVITY_NODES) map.set(node.id, project(node.lng, node.lat));
    return map;
  }, []);

  const liveCount = useMemo(() => ACTIVITY_NODES.filter((n) => n.live).length, []);

  /** Dot-matrix of land cells (the continents, rendered as neutral dots). */
  const landDots = useMemo(() => {
    const dots: Array<{ x: number; y: number }> = [];
    const step = 5;
    for (let x = step; x < VIEW_W; x += step) {
      for (let y = step; y < VIEW_H; y += step) {
        if (CONTINENTS.some((poly) => inPoly(x, y, poly))) dots.push({ x, y });
      }
    }
    return dots;
  }, []);

  const meridians = [30, 90, 150, 210, 270, 330];
  const parallels = [45, 90, 135];

  const arcs = useMemo(() => {
    return ACTIVITY_ARCS.flatMap((arc) => {
      const a = coords.get(arc.from);
      const b = coords.get(arc.to);
      if (!a || !b) return [];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.18 - 8;
      return [{ ...arc, d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}` }];
    });
  }, [coords]);

  return (
    <section className="panel flex min-h-0 flex-col">
      <header className="border-b border-hairline px-3 py-2">
        <SectionLabel
          right={
            <span className="eyebrow tabular text-faint">
              <span style={{ color: accentVar('green') }}>{liveCount}</span> / {ACTIVITY_NODES.length} LIVE
            </span>
          }
        >
          GLOBAL ACTIVITY
        </SectionLabel>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg-deep">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label={`Global activity map · ${liveCount} of ${ACTIVITY_NODES.length} nodes live`}
        >
          {/* graticule */}
          <g stroke="var(--border)" strokeWidth={0.4} strokeOpacity={0.6}>
            {meridians.map((x) => (
              <line key={`m${x}`} x1={x} y1={0} x2={x} y2={VIEW_H} />
            ))}
            {parallels.map((y) => (
              <line key={`p${y}`} x1={0} y1={y} x2={VIEW_W} y2={y} />
            ))}
          </g>

          {/* landmass dot-matrix — neutral; accent color is reserved for live state */}
          <g fill="var(--border-strong)">
            {landDots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={0.85} />
            ))}
          </g>

          {/* arcs between active regions — hidden under prefers-reduced-data */}
          <g className="reduced-data-hide" fill="none">
            {arcs.map((arc, i) => (
              <path
                key={`${arc.from}-${arc.to}-${i}`}
                d={arc.d}
                stroke={accentVar(arc.accent)}
                strokeWidth={0.6}
                strokeOpacity={0.35}
                strokeLinecap="round"
                strokeDasharray="2 3"
                className="animate-flow-dash"
              />
            ))}
          </g>

          {/* nodes */}
          <g>
            {ACTIVITY_NODES.map((node) => {
              const p = coords.get(node.id);
              if (!p) return null;
              const color = accentVar(node.accent);
              return (
                <g key={node.id}>
                  {node.live && (
                    <>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={5}
                        fill={color}
                        fillOpacity={0.12}
                        className="animate-pulse-dot"
                        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                      />
                      <circle cx={p.x} cy={p.y} r={3} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={0.5} />
                    </>
                  )}
                  <circle cx={p.x} cy={p.y} r={node.live ? 1.8 : 1.2} fill={color} fillOpacity={node.live ? 1 : 0.55}>
                    <title>{node.label}</title>
                  </circle>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
