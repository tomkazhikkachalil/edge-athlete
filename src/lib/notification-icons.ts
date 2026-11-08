/**
 * The notification types' glyphs (the icons round, Nov 2026), kept APART from
 * the registry: notification-registry.ts is pure rules the server and every
 * page import; the glyphs ride only with the bell and the notifications page.
 * `getNotificationIcon(type)` answers the NAME; this maps it to the glyph.
 */
import type { FaIconDef } from '@/lib/icons/fa-icon';
import { getNotificationIcon } from './notification-registry';
import { faAt } from '@/lib/icons/fa/at';
import { faBell } from '@/lib/icons/fa/bell';
import { faBolt } from '@/lib/icons/fa/bolt';
import { faBuilding } from '@/lib/icons/fa/building';
import { faBullhorn } from '@/lib/icons/fa/bullhorn';
import { faCalendarDay } from '@/lib/icons/fa/calendar-day';
import { faChildReaching } from '@/lib/icons/fa/child-reaching';
import { faClipboardCheck } from '@/lib/icons/fa/clipboard-check';
import { faClipboardList } from '@/lib/icons/fa/clipboard-list';
import { faComment } from '@/lib/icons/fa/comment';
import { faEnvelope } from '@/lib/icons/fa/envelope';
import { faFlag } from '@/lib/icons/fa/flag';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faGavel } from '@/lib/icons/fa/gavel';
import { faGolfBallTee } from '@/lib/icons/fa/golf-ball-tee';
import { faHeart } from '@/lib/icons/fa/heart';
import { faHourglassHalf } from '@/lib/icons/fa/hourglass-half';
import { faLifeRing } from '@/lib/icons/fa/life-ring';
import { faListCheck } from '@/lib/icons/fa/list-check';
import { faPeopleGroup } from '@/lib/icons/fa/people-group';
import { faRightLeft } from '@/lib/icons/fa/right-left';
import { faShieldHalved } from '@/lib/icons/fa/shield-halved';
import { faTriangleExclamation } from '@/lib/icons/fa/triangle-exclamation';
import { faTrophy } from '@/lib/icons/fa/trophy';
import { faUserMinus } from '@/lib/icons/fa/user-minus';
import { faUserPlus } from '@/lib/icons/fa/user-plus';
import { faUserShield } from '@/lib/icons/fa/user-shield';
import { faUsers } from '@/lib/icons/fa/users';

const GLYPHS: Readonly<Record<string, FaIconDef>> = {
  'at': faAt,
  'bell': faBell,
  'bolt': faBolt,
  'building': faBuilding,
  'bullhorn': faBullhorn,
  'calendar-day': faCalendarDay,
  'child-reaching': faChildReaching,
  'clipboard-check': faClipboardCheck,
  'clipboard-list': faClipboardList,
  'comment': faComment,
  'envelope': faEnvelope,
  'flag': faFlag,
  'flag-checkered': faFlagCheckered,
  'gavel': faGavel,
  'golf-ball-tee': faGolfBallTee,
  'heart': faHeart,
  'hourglass-half': faHourglassHalf,
  'life-ring': faLifeRing,
  'list-check': faListCheck,
  'people-group': faPeopleGroup,
  'right-left': faRightLeft,
  'shield-halved': faShieldHalved,
  'triangle-exclamation': faTriangleExclamation,
  'trophy': faTrophy,
  'user-minus': faUserMinus,
  'user-plus': faUserPlus,
  'user-shield': faUserShield,
  'users': faUsers,
};

export function notificationGlyph(type: string): FaIconDef {
  return GLYPHS[getNotificationIcon(type)] ?? GLYPHS.bell;
}
