import type { PublicOrgVideo } from '@/lib/org-sites/public-data';
import { embedSrcAt, thumbUrl, watchUrl } from '@/lib/videos/youtube';

// The Videos tile on the public site (Videos program, Phase 1b). Server-safe
// and script-free (the (public) contract): each poster is an <iframe srcdoc>
// built ONLY from the 11-character YouTube id — the i.ytimg.com thumbnail
// and a play glyph in inline CSS; the tap navigates THAT frame to the
// youtube-nocookie embed (frame-src already admits it; a srcdoc frame is
// exempt from frame-src itself and inherits the page's policy). Nothing
// from YouTube loads before the tap — the help centre's click-to-play rule
// without a client component. Titles come from the org's own rows (never a
// profile join — the masking invariant holds by construction).

function posterDoc(videoId: string): string {
  const href = `${embedSrcAt(videoId, null)}&autoplay=1`;
  const img = thumbUrl(videoId);
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;background:#000;overflow:hidden}' +
    'a{display:block;position:relative;width:100%;height:100%}' +
    'img{width:100%;height:100%;object-fit:cover;display:block}' +
    'span{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(0,0,0,.7)}' +
    "span:after{content:'';position:absolute;left:22px;top:17px;border-style:solid;border-width:11px 0 11px 18px;border-color:transparent transparent transparent #fff}" +
    '</style></head><body>' +
    `<a href="${href}" target="_self" aria-label="Play"><img src="${img}" alt=""><span></span></a>` +
    '</body></html>'
  );
}

export default function VideosList({ items }: { items: PublicOrgVideo[] }) {
  return (
    <ul role="list" className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2" data-site-videos={items.length}>
      {items.map(v => (
        <li key={v.id} data-site-video={v.videoId}>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-sunken">
            {v.live && (
              <span className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white" data-site-video-live="">
                <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true"></span>
                Live
              </span>
            )}
            <iframe
              srcDoc={posterDoc(v.videoId)}
              title={v.title}
              loading="lazy"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full border-0"
            />
          </div>
          <p className="mt-2 text-sm font-semibold text-primary">{v.title}</p>
          <p className="text-xs text-tertiary">
            {v.date ?? ''}
            {v.date ? ' · ' : ''}
            <a href={watchUrl(v.videoId)} target="_blank" rel="noopener noreferrer" className="underline">Open on YouTube</a>
          </p>
        </li>
      ))}
    </ul>
  );
}
