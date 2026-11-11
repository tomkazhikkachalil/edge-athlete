// ── The device → YouTube upload (Videos program Phase 3, Nov 5 2026) ─────────
// Google's resumable protocol over the session the server opened
// (/api/videos/youtube/upload-session): PUT one chunk at a time with a
// Content-Range; a 308 with a Range header says how much YouTube holds; a
// 200 / 201 carries the new video's id. The bytes go straight from the
// device to www.googleapis.com — never through Edge Athlete or Vercel.
//
// The uploads round (Nov 10 2026): a full game outlives the hour, the tunnel
// and a reload. The LOOP (`runYouTubeUpload`) is separate from the wire
// (`UploadTransport`, XMLHttpRequest in the browser — upload progress inside
// the iOS 15 floor), so its every branch is a unit test:
//   • a 401 mid-upload asks the server for a fresh token (`refreshToken`),
//     asks YouTube where it is, and goes on — the hour is not the limit;
//   • no answer, a timeout, a 429 or a 5xx waits (1 s … 30 s, and for the
//     connection to come back when the device is offline), asks YouTube
//     where it is, and goes on — up to UPLOAD_RETRY_MAX failures in a row;
//   • `resume` starts by asking YouTube where it is (after a reload);
//   • a 404 / 410 means the session itself is gone: start over, said so.
// The pure pieces (the chunk, the range, the offset, the backoff, what is
// worth a retry) are in youtube-connection.ts.

import { chunkRetryable, nextOffsetFromRange, UPLOAD_RETRY_MAX, UPLOAD_TOKEN_REFRESH_MAX, uploadBackoffMs, youtubeContentRange } from './youtube-connection';

export interface ChunkAnswer { status: number; range: string | null; body: string }
export interface ChunkRange { start: number; end: number; header: string }

/** The wire. `put` and `ask` reject with 'abort' or 'network'; `wait` rejects with 'abort'. */
export interface UploadTransport {
  put(range: ChunkRange, token: string, onLoaded: (loaded: number) => void): Promise<ChunkAnswer>;
  /** "How much do you hold?" — a PUT with no bytes and `bytes *\/size`. */
  ask(token: string): Promise<ChunkAnswer>;
  /** Wait `ms`; with `forOnline`, also until the device reports a connection. */
  wait(ms: number, forOnline: boolean): Promise<void>;
  online(): boolean;
}

export interface UploadRun {
  size: number;
  accessToken: string;
  /** Start by asking YouTube how much it holds — a session kept across a reload. */
  resume?: boolean;
  /** A fresh access token when YouTube answers 401 (the hour ran out); null = the connection has to be made again. */
  refreshToken?: () => Promise<string | null>;
  aborted?: () => boolean;
  onProgress?: (fraction: number) => void;
  /** The upload is waiting to try again: which failure in a row, how long, and whether the device is offline. */
  onRetry?: (info: { failures: number; waitMs: number; offline: boolean }) => void;
}

export type YouTubeUploadResult =
  | { ok: true; videoId: string }
  | { ok: false; kind: 'network' | 'refused' | 'cancelled' | 'expired'; message: string; reconnect?: boolean };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const CANCELLED: YouTubeUploadResult = { ok: false, kind: 'cancelled', message: 'The upload was cancelled' };
const INTERRUPTED: YouTubeUploadResult = { ok: false, kind: 'network', message: 'The upload was interrupted — check your connection, then resume it' };
const EXPIRED: YouTubeUploadResult = { ok: false, kind: 'expired', message: 'YouTube ended this upload session — start the upload again' };
const RECONNECT: YouTubeUploadResult = { ok: false, kind: 'refused', message: 'YouTube refused the upload — reconnect the channel and try again', reconnect: true };

function finished(body: string): YouTubeUploadResult {
  let id = '';
  try { id = String((JSON.parse(body) as { id?: unknown }).id ?? ''); } catch { id = ''; }
  return YT_ID.test(id) ? { ok: true, videoId: id } : { ok: false, kind: 'refused', message: 'YouTube did not return the video id' };
}

/** The loop — no DOM, no clock of its own. */
export async function runYouTubeUpload(run: UploadRun, t: UploadTransport): Promise<YouTubeUploadResult> {
  const { size } = run;
  let token = run.accessToken;
  let offset = 0;
  let failures = 0;
  let refreshes = 0;
  let needAsk = !!run.resume;
  const aborted = () => run.aborted?.() === true;

  /** One more failure in a row: give up past the limit, else wait (longer each time, and for the connection). false = stop. */
  const backOff = async (): Promise<boolean> => {
    failures += 1;
    if (failures > UPLOAD_RETRY_MAX) return false;
    const waitMs = uploadBackoffMs(failures);
    const offline = !t.online();
    run.onRetry?.({ failures, waitMs, offline });
    await t.wait(waitMs, offline);
    return true;
  };
  /** A 401: one fresh token from the server. false = the connection is over. */
  const renew = async (): Promise<boolean> => {
    if (!run.refreshToken || refreshes >= UPLOAD_TOKEN_REFRESH_MAX) return false;
    refreshes += 1;
    const next = await run.refreshToken().catch(() => null);
    if (!next) return false;
    token = next;
    return true;
  };

  try {
    for (;;) {
      if (aborted()) return CANCELLED;

      if (needAsk) {
        let a: ChunkAnswer;
        try {
          a = await t.ask(token);
        } catch (why) {
          if (why === 'abort') return CANCELLED;
          if (!(await backOff())) return INTERRUPTED;
          continue;
        }
        if (a.status === 308) {
          offset = nextOffsetFromRange(a.range);
          needAsk = false;
          run.onProgress?.(Math.min(1, offset / size));
        } else if (a.status >= 200 && a.status < 300) {
          const done = finished(a.body);
          if (done.ok) run.onProgress?.(1);
          return done;
        } else if (a.status === 401) {
          if (!(await renew())) return RECONNECT;
          continue;
        } else if (a.status === 404 || a.status === 410) {
          return EXPIRED;
        } else if (chunkRetryable(a.status)) {
          if (!(await backOff())) return INTERRUPTED;
          continue;
        } else {
          return { ok: false, kind: 'refused', message: 'The upload did not finish — please try again' };
        }
      }

      const range = youtubeContentRange(size, offset);
      if (!range) return { ok: false, kind: 'refused', message: 'Nothing to upload' };
      let res: ChunkAnswer;
      try {
        const base = offset;
        res = await t.put(range, token, loaded => run.onProgress?.(Math.min(1, (base + loaded) / size)));
      } catch (why) {
        if (why === 'abort') return CANCELLED;
        // The network dropped mid-chunk: wait, ask YouTube where it is, go on from there.
        if (!(await backOff())) return INTERRUPTED;
        needAsk = true;
        continue;
      }
      if (res.status === 308) {
        const next = nextOffsetFromRange(res.range);
        if (next > offset) {
          offset = next;
          failures = 0;
        } else if (!(await backOff())) {
          return INTERRUPTED; // YouTube keeps answering "nothing new stored"
        }
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        const done = finished(res.body);
        if (done.ok) run.onProgress?.(1);
        return done;
      }
      if (res.status === 401) {
        // The hour-long token ran out mid-upload: a fresh one, then YouTube's own offset.
        if (!(await renew())) return RECONNECT;
        needAsk = true;
        continue;
      }
      if (res.status === 404 || res.status === 410) return EXPIRED;
      if (chunkRetryable(res.status)) {
        if (!(await backOff())) return INTERRUPTED;
        needAsk = true;
        continue;
      }
      if (res.status === 403) return { ok: false, kind: 'refused', message: 'YouTube refused the upload for this channel' };
      return { ok: false, kind: 'refused', message: 'The upload did not finish — please try again' };
    }
  } catch (why) {
    // `wait` was aborted, or something threw that is not ours: never an unhandled rejection in the panel.
    return why === 'abort' ? CANCELLED : INTERRUPTED;
  }
}

// ── The browser's wire ──────────────────────────────────────────────────────
export interface YouTubeUploadInput {
  sessionUri: string;
  accessToken: string;
  file: Blob;
  signal?: AbortSignal;
  resume?: boolean;
  refreshToken?: () => Promise<string | null>;
  onProgress?: (fraction: number) => void;
  onRetry?: (info: { failures: number; waitMs: number; offline: boolean }) => void;
}

function xhrTransport(input: YouTubeUploadInput): UploadTransport {
  const send = (token: string, contentRange: string, body: Blob | null, onLoaded?: (loaded: number) => void) =>
    new Promise<ChunkAnswer>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', input.sessionUri);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Range', contentRange);
      if (onLoaded) xhr.upload.onprogress = e => { if (e.lengthComputable) onLoaded(e.loaded); };
      const onAbort = () => xhr.abort();
      input.signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => input.signal?.removeEventListener('abort', onAbort);
      xhr.onload = () => { done(); resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), body: xhr.responseText }); };
      xhr.onerror = () => { done(); reject('network'); };
      xhr.ontimeout = () => { done(); reject('network'); };
      xhr.onabort = () => { done(); reject('abort'); };
      if (input.signal?.aborted) { done(); reject('abort'); return; }
      xhr.send(body);
    });
  return {
    put: (range, token, onLoaded) => send(token, range.header, input.file.slice(range.start, range.end), onLoaded),
    ask: token => send(token, `bytes */${input.file.size}`, null),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    wait: (ms, forOnline) =>
      new Promise<void>((resolve, reject) => {
        if (input.signal?.aborted) { reject('abort'); return; }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          input.signal?.removeEventListener('abort', onAbort);
          window.removeEventListener('online', onOnline);
        };
        const onAbort = () => { cleanup(); reject('abort'); };
        const finish = () => { cleanup(); resolve(); };
        // Offline: the wait ends when the connection returns (then the short backoff), never by the clock alone.
        const onOnline = () => { timer = setTimeout(finish, Math.min(ms, 2000)); };
        input.signal?.addEventListener('abort', onAbort, { once: true });
        if (forOnline && typeof navigator !== 'undefined' && navigator.onLine === false) window.addEventListener('online', onOnline, { once: true });
        else timer = setTimeout(finish, ms);
      }),
  };
}

export function uploadToYouTube(input: YouTubeUploadInput): Promise<YouTubeUploadResult> {
  return runYouTubeUpload(
    { size: input.file.size, accessToken: input.accessToken, resume: input.resume, refreshToken: input.refreshToken, aborted: () => input.signal?.aborted === true, onProgress: input.onProgress, onRetry: input.onRetry },
    xhrTransport(input),
  );
}
