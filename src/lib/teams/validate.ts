import { z } from 'zod';

// Team roster request bodies (teams & divisions program, PR 4).
const uuid = z.string().uuid();

export const TeamRosterAddSchema = z.object({ profileId: uuid });
export const TeamRosterMoveSchema = z.object({ profileId: uuid, toTeamId: uuid });
export const TeamRosterRemoveSchema = z.object({ profileId: uuid });
