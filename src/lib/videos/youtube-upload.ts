// ── The device → YouTube upload (Videos program Phase 3, Nov 5 2026) ─────────
// Google's resumable protocol over the session the server opened
// (/api/videos/youtube/upload-session): PUT one chunk at a time with a
// Content-Range; a 308 with a Range header says how much YouTube holds; a
// 200 / 201 carries the new video's id. The bytes go straight from the
// device to www.googleapis.com — never through Edge Athlete or Vercel. The
// access token is the connector's own hour-long one; XMLHttpRequest for the
// upload progress inside the iOS 15 floor; `signal` aborts the chunk in
// flight. The pure pieces (the chunk, the range, the offset) are in
// youtube-connection.ts.

import { nextOffsetFromRange, youtubeContentRange } from './youtube-connection';

export interface YouTubeUploadInput {
  sessionUri: string;
  accessToken: string;
  file: Blob;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export type YouTubeUploadResult = { ok: true; videoId: string } | { ok: false; kind: 'network' | 'refused' | 'cancelled'; message: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** One chunk: resolves the status, the Range header and the body text. Rejects with -1 on abort, 0 on a network failure. */
function putChunk(input: YouTubeUploadInput, range: { start: number; end: number; header: string }, onLoaded: (loaded: number) => void): Promise<{ status: number; range: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.sessionUri);
    xhr.setRequestHeader('Authorization', `Bearer ${input.accessToken}`);
    xhr.setRequestHeader('Content-Range', range.header);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onLoaded(e.loaded); };
    const onAbort = () => xhr.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => input.signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => { done(); resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), body: xhr.responseText }); };
    xhr.onerror = () => { done(); reject(0); };
    xhr.onabort = () => { done(); reject(-1); };
    xhr.send(input.file.slice(range.start, range.end));
  });
}

/** Ask YouTube how much it holds (a resume after a dropped chunk): a PUT with no bytes and `bytes *\/size`. */
function askOffset(input: YouTubeUploadInput): Promise<number | null> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.sessionUri);
    xhr.setRequestHeader('Authorization', `Bearer ${input.accessToken}`);
    xhr.setRequestHeader('Content-Range', `bytes */${input.file.size}`);
    xhr.onload = () => resolve(xhr.status === 308 ? nextOffsetFromRange(xhr.getResponseHeader('Range')) : xhr.status >= 200 && xhr.status < 300 ? input.file.size : null);
    xhr.onerror = () => resolve(null);
    xhr.send();
  });
}

export async function uploadToYouTube(input: YouTubeUploadInput): Promise<YouTubeUploadResult> {
  const size = input.file.size;
  let offset = 0;
  let retries = 0;
  for (;;) {
    if (input.signal?.aborted) return { ok: false, kind: 'cancelled', message: 'The upload was cancelled' };
    const range = youtubeContentRange(size, offset);
    if (!range) return { ok: false, kind: 'refused', message: 'Nothing to upload' };
    let res: { status: number; range: string | null; body: string };
    try {
      res = await putChunk(input, range, loaded => input.onProgress?.(Math.min(1, (offset + loaded) / size)));
    } catch (code) {
      if (code === -1) return { ok: false, kind: 'cancelled', message: 'The upload was cancelled' };
      // The network dropped mid-chunk: ask YouTube where it is and go on from there, a few times.
      if (retries++ >= 3) return { ok: false, kind: 'network', message: 'The upload was interrupted — check your connection and try again' };
      const known = await askOffset(input);
      if (known === null) return { ok: false, kind: 'network', message: 'The upload was interrupted — check your connection and try again' };
      offset = known;
      continue;
    }
    if (res.status === 308) {
      offset = nextOffsetFromRange(res.range) || range.end;
      retries = 0;
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      let id = '';
      try { id = String((JSON.parse(res.body) as { id?: unknown }).id ?? ''); } catch { id = ''; }
      if (!YT_ID.test(id)) return { ok: false, kind: 'refused', message: 'YouTube did not return the video id' };
      input.onProgress?.(1);
      return { ok: true, videoId: id };
    }
    if (res.status === 401) return { ok: false, kind: 'refused', message: 'YouTube refused the upload — reconnect the channel and try again' };
    if (res.status === 403) return { ok: false, kind: 'refused', message: 'YouTube refused the upload for this channel' };
    return { ok: false, kind: 'refused', message: 'The upload did not finish — please try again' };
  }
}
