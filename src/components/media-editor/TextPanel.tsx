'use client';

/**
 * Text & sticker panel (E4h): add / select / remove overlays, edit the
 * selected one (content, font, colour, size, rotation, backdrop — or the
 * emoji grid + free entry). Placement is a drag on the stage's OverlayLayer.
 *
 * Nov 6 2026: "+ Text" focuses the field with its content selected, so
 * typing replaces the placeholder words; the field can be EMPTIED while
 * typing (a local draft — the overlay itself never holds an empty string,
 * the schema's floor); Remove sits outside the chips' scrolling strip.
 */

import { useEffect, useRef, useState } from 'react';
import {
  defaultEmojiOverlay,
  defaultTextOverlay,
  MAX_OVERLAYS,
  OVERLAY_COLORS,
  OVERLAY_EMOJI,
  OVERLAY_FONT_LABELS,
} from '@/lib/media/engine/overlay-layout';
import { signedToUi, uiToSigned } from '@/lib/media/slider-scale';
import type { ImageRecipe, Overlay, OverlayFontId } from '@/lib/media/types';
import EditorSlider from './EditorSlider';

interface TextPanelProps {
  recipe: ImageRecipe;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPatch: (patch: Partial<ImageRecipe>, keys: string) => void;
}

const FONT_IDS: OverlayFontId[] = ['inter', 'lora', 'caveat'];

const CHIP = 'px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0';
const CHIP_IDLE = `${CHIP} bg-white/10 text-white/70 hover:bg-white/20`;
const CHIP_ON = `${CHIP} bg-white/20 text-white font-semibold`;

export default function TextPanel({ recipe, selectedIndex, onSelectIndex, onPatch }: TextPanelProps) {
  const overlays = recipe.overlays ?? [];
  const selected: Overlay | undefined = overlays[selectedIndex];
  const full = overlays.length >= MAX_OVERLAYS;

  // The field's draft while it is being typed in: may be empty, which the
  // overlay never is. Keyed by index so another selection shows its own text.
  const [draft, setDraft] = useState<{ index: number; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // "+ Text" asks for the field to take focus once it has rendered.
  const focusNextRef = useRef(false);
  useEffect(() => {
    if (!focusNextRef.current || selected?.kind !== 'text') return;
    focusNextRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [selected, selectedIndex]);

  const patchOverlays = (next: Overlay[], keys: string) =>
    onPatch({ overlays: next.length > 0 ? next : undefined }, keys);

  const addOverlay = (overlay: Overlay) => {
    const next = [...overlays, overlay];
    patchOverlays(next, 'overlay.add');
    onSelectIndex(next.length - 1);
  };

  const patchSelected = (overlay: Overlay, keys: string) =>
    patchOverlays(overlays.map((o, i) => (i === selectedIndex ? overlay : o)), keys);

  return (
    <div className="px-4 py-3 space-y-2 w-full max-w-xl mx-auto">
      {overlays.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {overlays.map((overlay, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectIndex(i)}
                aria-pressed={i === selectedIndex}
                className={`${CHIP} max-w-[8rem] truncate ${
                  i === selectedIndex
                    ? 'bg-brand text-white font-semibold'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {overlay.kind === 'text' ? overlay.content : overlay.emoji}
              </button>
            ))}
          </div>
          {selected && (
            <button
              type="button"
              onClick={() => {
                patchOverlays(overlays.filter((_, i) => i !== selectedIndex), 'overlay.delete');
                onSelectIndex(Math.max(0, selectedIndex - 1));
              }}
              className={`${CHIP_IDLE} hover:text-white`}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {full ? (
        <p className="text-chip text-white/50">Up to {MAX_OVERLAYS} on a photo.</p>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            onClick={() => {
              focusNextRef.current = true;
              addOverlay(defaultTextOverlay());
            }}
            className={CHIP_IDLE}
          >
            + Text
          </button>
          <button type="button" onClick={() => addOverlay(defaultEmojiOverlay())} className={CHIP_IDLE}>
            + Sticker
          </button>
        </div>
      )}

      {!selected ? (
        <p className="text-chip text-white/50">
          Add text or a sticker, then drag it into place on the photo.
        </p>
      ) : (
        <div className="space-y-2 max-h-[34vh] overflow-y-auto">
          {selected.kind === 'text' ? (
            <>
              <input
                ref={inputRef}
                type="text"
                value={draft?.index === selectedIndex ? draft.value : selected.content}
                maxLength={120}
                aria-label="Overlay text"
                onChange={e => {
                  const content = e.target.value;
                  setDraft({ index: selectedIndex, value: content });
                  // The overlay keeps its last words while the field is empty.
                  if (content.length > 0) {
                    patchSelected({ ...selected, content }, `overlay.${selectedIndex}.content`);
                  }
                }}
                onBlur={() => setDraft(null)}
                className="w-full min-h-[44px] px-3 rounded-lg bg-white/10 text-white text-label placeholder-white/40 focus-visible:bg-white/15"
                placeholder="Your text"
              />
              <div className="flex items-center gap-2">
                {FONT_IDS.map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patchSelected({ ...selected, fontId: id }, `overlay.${selectedIndex}.font`)}
                    aria-pressed={selected.fontId === id}
                    className={selected.fontId === id ? CHIP_ON : CHIP_IDLE}
                  >
                    {OVERLAY_FONT_LABELS[id]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    patchSelected({ ...selected, pill: !selected.pill }, `overlay.${selectedIndex}.pill`)
                  }
                  aria-pressed={selected.pill === true}
                  title="A dark box behind the words"
                  className={`ml-auto ${selected.pill ? CHIP_ON : CHIP_IDLE}`}
                >
                  Backdrop
                </button>
              </div>
              <div className="flex items-center gap-2">
                {OVERLAY_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => patchSelected({ ...selected, color }, `overlay.${selectedIndex}.color`)}
                    aria-label={`Text color ${color}`}
                    aria-pressed={selected.color === color}
                    className={`w-8 h-8 rounded-full flex-shrink-0 ${
                      selected.color === color ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/25'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-8 gap-1">
                {OVERLAY_EMOJI.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => patchSelected({ ...selected, emoji }, `overlay.${selectedIndex}.emoji`)}
                    aria-pressed={selected.emoji === emoji}
                    className={`min-h-[40px] rounded-lg text-xl ${
                      selected.emoji === emoji ? 'bg-white/25' : 'hover:bg-white/10'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-3 text-chip text-white/60">
                Or type any emoji
                <input
                  type="text"
                  value={selected.emoji}
                  maxLength={16}
                  aria-label="Custom emoji"
                  onChange={e => {
                    const emoji = e.target.value;
                    if (emoji.length === 0) return;
                    patchSelected({ ...selected, emoji }, `overlay.${selectedIndex}.emoji`);
                  }}
                  className="w-28 min-h-[44px] px-3 rounded-lg bg-white/10 text-white text-label"
                />
              </label>
            </>
          )}
          <EditorSlider
            label="Size"
            value={Math.round(((selected.size - 0.02) / 0.28) * 100)}
            min={0}
            onChange={ui =>
              patchSelected(
                { ...selected, size: 0.02 + (ui / 100) * 0.28 },
                `overlay.${selectedIndex}.size`
              )
            }
          />
          <EditorSlider
            label="Rotation"
            value={signedToUi(selected.rotation / 45)}
            onChange={ui =>
              patchSelected(
                { ...selected, rotation: uiToSigned(ui) * 45 },
                `overlay.${selectedIndex}.rotation`
              )
            }
          />
        </div>
      )}
    </div>
  );
}
