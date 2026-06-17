import type { AccentKey } from '@departments/shared';

/**
 * Activity nodes for the world-map view. Lat/lng are projected equirectangularly by
 * the ActivityMap organism. `live` nodes pulse + glow; the rest are dim. In Phase 5
 * this is replaced by a real event→geo source (or shipped as a labeled decorative
 * stub if no geo signal exists).
 */
export interface ActivityNode {
  id: string;
  label: string;
  lat: number;
  lng: number;
  accent: AccentKey;
  live: boolean;
}

export const ACTIVITY_NODES: ActivityNode[] = [
  { id: 'sd', label: 'San Diego · edge', lat: 32.72, lng: -117.16, accent: 'green', live: true },
  { id: 'sf', label: 'SF · inference', lat: 37.77, lng: -122.42, accent: 'cyan', live: true },
  { id: 'iad', label: 'Virginia · CMA', lat: 38.95, lng: -77.45, accent: 'green', live: true },
  { id: 'lhr', label: 'London · CDN', lat: 51.5, lng: -0.12, accent: 'blue', live: true },
  { id: 'fra', label: 'Frankfurt · CDN', lat: 50.11, lng: 8.68, accent: 'blue', live: false },
  { id: 'sin', label: 'Singapore · CDN', lat: 1.35, lng: 103.82, accent: 'amber', live: true },
  { id: 'syd', label: 'Sydney · CDN', lat: -33.87, lng: 151.21, accent: 'blue', live: false },
  { id: 'sao', label: 'São Paulo · CDN', lat: -23.55, lng: -46.63, accent: 'blue', live: false },
  { id: 'tok', label: 'Tokyo · CDN', lat: 35.68, lng: 139.69, accent: 'purple', live: true },
];

/** Edges (arcs) between nodes — drawn as faint great-circle-ish curves. */
export const ACTIVITY_ARCS: Array<{ from: string; to: string; accent: AccentKey }> = [
  { from: 'iad', to: 'sf', accent: 'green' },
  { from: 'sf', to: 'sd', accent: 'cyan' },
  { from: 'iad', to: 'lhr', accent: 'blue' },
  { from: 'lhr', to: 'sin', accent: 'amber' },
  { from: 'sf', to: 'tok', accent: 'purple' },
];
