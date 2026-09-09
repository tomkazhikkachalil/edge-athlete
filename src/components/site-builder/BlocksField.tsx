'use client';

import { TEXT_WIDGET_BLOCKS_MAX } from '@/lib/site-builder/fields';

/**
 * The text widget's compact block editor — Site Builder P6-B (Sep 9 2026).
 * Bound STRAIGHT to the instance (no local copy): every keystroke commits
 * the instance, coalesced into one undo step per field, so ⌘Z behaves and
 * the canvas tile updates as you type. Blocks are stored leniently
 * (`TextBlockSchema` — a paragraph being typed is empty for a moment) and
 * rendered strictly (`parsePageBody` drops what is not yet a block).
 * Paragraphs, headings and link lists here; a photo is its own section
 * (the Image widget), so no image block is offered — one that arrived
 * through the API stays and is shown read-only.
 */
export type TextBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'link-list'; links: { label: string; url: string }[] }
  | { type: 'image'; path: string; alt: string; width?: number; height?: number };

const LABEL: Record<TextBlock['type'], string> = { heading: 'Heading', paragraph: 'Paragraph', 'link-list': 'Links', image: 'Photo' };

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const SMALL = 'min-h-[28px] rounded-md px-2 text-xs text-secondary hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed';

/** Defensive read of the instance's blocks (any build's config). */
export function readTextBlocks(raw: unknown): TextBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: TextBlock[] = [];
  for (const b of raw.slice(0, TEXT_WIDGET_BLOCKS_MAX)) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    if ((r.type === 'heading' || r.type === 'paragraph') && typeof r.text === 'string') out.push({ type: r.type, text: r.text });
    else if (r.type === 'link-list' && Array.isArray(r.links)) {
      out.push({
        type: 'link-list',
        links: r.links
          .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
          .map(l => ({ label: typeof l.label === 'string' ? l.label : '', url: typeof l.url === 'string' ? l.url : '' })),
      });
    } else if (r.type === 'image' && typeof r.path === 'string') {
      out.push({ type: 'image', path: r.path, alt: typeof r.alt === 'string' ? r.alt : '', ...(typeof r.width === 'number' ? { width: r.width } : {}), ...(typeof r.height === 'number' ? { height: r.height } : {}) });
    }
  }
  return out;
}

export interface BlocksFieldProps {
  idBase: string;
  blocks: TextBlock[];
  /** `coalesce` names the field being typed in; structural edits pass none. */
  onChange: (blocks: TextBlock[], coalesce?: string) => void;
}

export default function BlocksField({ idBase, blocks, onChange }: BlocksFieldProps) {
  const full = blocks.length >= TEXT_WIDGET_BLOCKS_MAX;
  const add = (b: TextBlock) => onChange([...blocks, b]);
  const patch = (i: number, next: TextBlock, coalesce?: string) => onChange(blocks.map((b, j) => (j === i ? next : b)), coalesce);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const copy = [...blocks];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const remove = (i: number) => onChange(blocks.filter((_, j) => j !== i));

  return (
    <div className="space-y-3" data-sb-blocks={blocks.length}>
      {blocks.length === 0 && <p className="text-xs text-tertiary">Nothing written yet — add a paragraph below.</p>}
      {blocks.map((b, i) => {
        const id = `${idBase}-block-${i}`;
        const n = i + 1;
        return (
          <div key={i} className="rounded-md border border-border p-2 space-y-2" data-sb-block={b.type}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-secondary">{`${LABEL[b.type]} ${n}`}</span>
              <span className="flex items-center gap-1">
                <button type="button" className={SMALL} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${LABEL[b.type].toLowerCase()} ${n} up`}>
                  ↑
                </button>
                <button type="button" className={SMALL} onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label={`Move ${LABEL[b.type].toLowerCase()} ${n} down`}>
                  ↓
                </button>
                <button type="button" className={SMALL} onClick={() => remove(i)} aria-label={`Remove ${LABEL[b.type].toLowerCase()} ${n}`}>
                  ×
                </button>
              </span>
            </div>
            {b.type === 'heading' && (
              <input
                id={id}
                type="text"
                aria-label={`Heading ${n}`}
                maxLength={120}
                value={b.text}
                onChange={e => patch(i, { type: 'heading', text: e.target.value }, `${id}:text`)}
                className={INPUT}
              />
            )}
            {b.type === 'paragraph' && (
              <textarea
                id={id}
                aria-label={`Paragraph ${n}`}
                rows={4}
                maxLength={2000}
                value={b.text}
                onChange={e => patch(i, { type: 'paragraph', text: e.target.value }, `${id}:text`)}
                className={INPUT}
              />
            )}
            {b.type === 'link-list' && (
              <div className="space-y-2">
                {b.links.map((l, k) => (
                  <div key={k} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        type="text"
                        aria-label={`Link ${k + 1} label`}
                        placeholder="Label"
                        maxLength={80}
                        value={l.label}
                        onChange={e => patch(i, { type: 'link-list', links: b.links.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) }, `${id}:link:${k}:label`)}
                        className={INPUT}
                      />
                      <input
                        type="url"
                        aria-label={`Link ${k + 1} address`}
                        placeholder="https://…"
                        maxLength={200}
                        value={l.url}
                        onChange={e => patch(i, { type: 'link-list', links: b.links.map((x, m) => (m === k ? { ...x, url: e.target.value } : x)) }, `${id}:link:${k}:url`)}
                        className={INPUT}
                      />
                    </div>
                    <button
                      type="button"
                      className={`${SMALL} mt-1`}
                      onClick={() => patch(i, { type: 'link-list', links: b.links.filter((_, m) => m !== k) })}
                      aria-label={`Remove link ${k + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={SMALL}
                  disabled={b.links.length >= 20}
                  onClick={() => patch(i, { type: 'link-list', links: [...b.links, { label: '', url: '' }] })}
                >
                  + Link
                </button>
                <p className="text-xs text-tertiary">Links need a label and an https:// address to show.</p>
              </div>
            )}
            {b.type === 'image' && <p className="text-xs text-tertiary">A photo block — edit it in the console’s page editor.</p>}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SMALL} disabled={full} onClick={() => add({ type: 'paragraph', text: '' })}>
          + Paragraph
        </button>
        <button type="button" className={SMALL} disabled={full} onClick={() => add({ type: 'heading', text: '' })}>
          + Heading
        </button>
        <button type="button" className={SMALL} disabled={full} onClick={() => add({ type: 'link-list', links: [{ label: '', url: '' }] })}>
          + Links
        </button>
      </div>
      {full && <p className="text-xs text-tertiary">{`A section holds up to ${TEXT_WIDGET_BLOCKS_MAX} blocks — add another Text section for more.`}</p>}
    </div>
  );
}
