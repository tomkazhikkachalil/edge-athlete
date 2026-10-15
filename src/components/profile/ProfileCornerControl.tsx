'use client';

import ActionMenu from '@/components/ActionMenu';

/**
 * The ONE control in the cover photo's top-right corner (Tom, Oct 14 2026 —
 * the profile's title card with its back arrow is gone; what it held moved):
 *
 *   viewer → the "…" menu: Report profile today; Share profile and Block
 *            land in this same list later (keep it a list).
 *   owner  → the Edit profile pencil (the page's own editor door).
 *
 * Drawn ON the photo through ProfileCoverHeader's `overlay`, so it needs
 * contrast on any photo in both themes: a translucent black disc with a
 * white glyph (the owner's Add cover photo button's recipe). 44 px target.
 * The owner's Add cover photo button keeps the bottom-right corner.
 */
const CORNER = 'absolute top-2 right-2 z-20';
const SCRIM = 'bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm shadow-lg';

type Props =
  | { mode: 'viewer'; onReport: () => void }
  | { mode: 'owner'; onEdit: () => void };

export default function ProfileCornerControl(props: Props) {
  if (props.mode === 'owner') {
    return (
      <button
        type="button"
        onClick={props.onEdit}
        aria-label="Edit profile"
        title="Edit profile"
        data-profile-edit=""
        className={`${CORNER} ${SCRIM} w-11 h-11 rounded-full inline-flex items-center justify-center transition-colors`}
      >
        <i className="fas fa-pen text-sm" aria-hidden="true"></i>
      </button>
    );
  }
  return (
    <ActionMenu
      ariaLabel="Profile options"
      triggerTestAttr="profile-menu"
      triggerTone="scrim"
      triggerClassName={CORNER}
      // Spec 2: report this profile (Block + Mute are offered after).
      items={[{ key: 'report', label: 'Report profile', icon: 'fa-flag', onSelect: props.onReport }]}
    />
  );
}
