/**
 * GET /api/ollama/models — list the models installed on the local Ollama daemon.
 *
 * Proxies `${baseUrl}/api/tags` server-side so the cockpit's Provider settings can
 * populate the model dropdown without a browser CORS / mixed-content hurdle, and so an
 * unreachable daemon degrades to a clean `{ reachable: false }` instead of a console error.
 *
 *   ?baseUrl=http://localhost:11434   (defaults to OLLAMA_BASE_URL, then localhost)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OllamaTag {
  name: string;
  size?: number;
  details?: { parameter_size?: string; context_length?: number };
  capabilities?: string[];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = sanitizeBaseUrl(url.searchParams.get('baseUrl')) ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      return Response.json({ reachable: false, baseUrl, models: [], error: `HTTP ${res.status}` });
    }
    const data = (await res.json()) as { models?: OllamaTag[] };
    const models = (data.models ?? []).map((m) => ({
      name: m.name,
      sizeGb: m.size ? Math.round((m.size / 1e9) * 10) / 10 : null,
      paramSize: m.details?.parameter_size ?? null,
      contextLength: m.details?.context_length ?? null,
      capabilities: m.capabilities ?? [],
    }));
    // Largest, most capable first is unhelpful; keep Ollama's order (recently-modified).
    return Response.json({ reachable: true, baseUrl, models });
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : e instanceof Error ? e.message : 'unreachable';
    return Response.json({ reachable: false, baseUrl, models: [], error: reason });
  } finally {
    clearTimeout(timer);
  }
}

/** Only allow http(s) URLs (a local daemon); reject anything else. */
function sanitizeBaseUrl(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}
