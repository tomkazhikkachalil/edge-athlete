// ── One row per hidden result (fix round, Oct 2026) — pure, zero imports ────
// A round is two rows — its feed post and the owner's stats row — and both
// are hidden together (hide-server.ts setWholeResultHidden). Settings →
// Privacy used to list the pair as two separate things to show again; this
// folds each hidden round into its hidden post. Pinned in results-hide.test.ts.

export interface HiddenResultsList {
  rounds: Array<{ id: string; date: string; course: string | null; gross_score: number | null; hidden_at: string }>;
  posts: Array<{ id: string; caption: string | null; sport_key: string | null; created_at: string; hidden_at: string; course: string | null; gross_score: number | null }>;
}

export interface HiddenRoundRow { id: string; date: string; course: string | null; gross_score: number | null; profile_hidden_at: string; group_post_id: string | null }
export interface HiddenPostRow { id: string; caption: string | null; sport_key: string | null; created_at: string; profile_hidden_at: string; group_post_id: string | null; round_id: string | null }

/** Pure: fold each hidden round into its hidden post. Pinned in results-hide.test.ts. */
export function pairHiddenResults(rounds: HiddenRoundRow[], posts: HiddenPostRow[]): HiddenResultsList {
  const taken = new Set<string>();
  const outPosts = posts.map(p => {
    const round = rounds.find(r => !taken.has(r.id) && ((p.group_post_id != null && r.group_post_id === p.group_post_id) || (p.round_id != null && r.id === p.round_id)));
    if (round) taken.add(round.id);
    return { id: p.id, caption: p.caption, sport_key: p.sport_key, created_at: p.created_at, hidden_at: p.profile_hidden_at, course: round?.course ?? null, gross_score: round?.gross_score ?? null };
  });
  return {
    rounds: rounds.filter(r => !taken.has(r.id)).map(r => ({ id: r.id, date: r.date, course: r.course, gross_score: r.gross_score, hidden_at: r.profile_hidden_at })),
    posts: outPosts,
  };
}
