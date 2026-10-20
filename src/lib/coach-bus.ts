/**
 * Tiny hand-off between the board and the coach: when the player drags a piece while a coach scene is on the board,
 * AnalysisView offers the move here and any AdvancedCoach that is playing takes it as a "Why not this move?" question.
 * (A plain module instead of props, so the coach card can sit anywhere in the layout, including the mobile and theater copies.)
 */
export interface CoachMove {
  /** The position on the board when the piece was dragged (the scene's position). */
  fen: string;
  /** The move the player tried, UCI ("e2e4", "e7e8q"). */
  uci: string;
}
type Handler = (m: CoachMove) => boolean;

const handlers = new Set<Handler>();

/** A coach registers to receive dragged moves. Return true from the handler when the move was taken. Returns the unsubscribe function. */
export function onCoachMove(h: Handler): () => void {
  handlers.add(h);
  return () => { handlers.delete(h); };
}

/** Offer a dragged move to the coaches. True when one of them took it (the board should then not treat it as a free move). */
export function offerCoachMove(m: CoachMove): boolean {
  let taken = false;
  for (const h of [...handlers]) if (h(m)) taken = true;
  return taken;
}
