/**
 * The sports' glyphs (the icons round, Nov 2026), kept APART from the
 * registry: SportRegistry.ts is imported by every page for names, labels and
 * rules, and the seventeen glyphs would ride along into every route; a page
 * that draws a sport's icon imports this file and carries exactly these.
 * `icon_id` on the definition stays the name other systems know.
 */
import type { FaIconDef } from '@/lib/icons/fa-icon';
import type { SportKey } from './SportRegistry';
import { faBaseball } from '@/lib/icons/fa/baseball';
import { faBasketball } from '@/lib/icons/fa/basketball';
import { faFootball } from '@/lib/icons/fa/football';
import { faFutbol } from '@/lib/icons/fa/futbol';
import { faGolfBallTee } from '@/lib/icons/fa/golf-ball-tee';
import { faHandFist } from '@/lib/icons/fa/hand-fist';
import { faHockeyPuck } from '@/lib/icons/fa/hockey-puck';
import { faMitten } from '@/lib/icons/fa/mitten';
import { faPeoplePulling } from '@/lib/icons/fa/people-pulling';
import { faPersonBiking } from '@/lib/icons/fa/person-biking';
import { faPersonRunning } from '@/lib/icons/fa/person-running';
import { faPersonSwimming } from '@/lib/icons/fa/person-swimming';
import { faTableTennisPaddleBall } from '@/lib/icons/fa/table-tennis-paddle-ball';
import { faUserNinja } from '@/lib/icons/fa/user-ninja';
import { faVolleyball } from '@/lib/icons/fa/volleyball';
import { faWater } from '@/lib/icons/fa/water';

export const SPORT_ICONS: Readonly<Record<SportKey, FaIconDef>> = {
  golf: faGolfBallTee,
  ice_hockey: faHockeyPuck,
  volleyball: faVolleyball,
  track_field: faPersonRunning,
  basketball: faBasketball,
  soccer: faFutbol,
  tennis: faTableTennisPaddleBall,
  swimming: faPersonSwimming,
  cycling: faPersonBiking,
  running: faPersonRunning,
  rowing: faWater,
  mma: faHandFist,
  boxing: faMitten,
  wrestling: faPeoplePulling,
  bjj: faUserNinja,
  baseball: faBaseball,
  football: faFootball,
};

export function sportIcon(key: SportKey): FaIconDef {
  return SPORT_ICONS[key];
}
