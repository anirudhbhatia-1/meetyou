/**
 * Deploy-time settings served by the web server as `/config.json` (one image for every
 * environment). Without it (Vite dev, `pnpm --filter @meetyou/web dev`) the app runs on the mock API.
 */
export interface RuntimeConfig {
  googleClientId: string;
}

export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<RuntimeConfig | null> {
  try {
    const res = await fetchImpl('/config.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return null;
    const id = (body as Record<string, unknown>).googleClientId;
    return typeof id === 'string' && id !== '' ? { googleClientId: id } : null;
  } catch {
    // Vite dev answers index.html for unknown paths; that JSON parse failure means "mock mode".
    return null;
  }
}
