/**
 * A fetch that gives up when the upstream does not ANSWER in time
 * (maintenance pass, Oct 10 2026). The timer covers the wait for the
 * response's headers only and is cleared the moment they arrive, so a long
 * body (a video streamed through a media proxy) is never cut off — a hung
 * storage host no longer holds the function and the viewer for the
 * function's whole duration. A timeout rejects with an AbortError.
 */
export async function fetchWithHeaderTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The media proxies' budget for storage to start answering. */
export const STORAGE_ANSWER_TIMEOUT_MS = 10_000;

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
