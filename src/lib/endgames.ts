// Built-in endgame studies (model lines, checked move by move with chess.js).
// Place in src/lib/endgames.ts

export interface EndgameStudy {
  id: string;
  title: string;
  blurb: string;
  tags: string;
  pgn: string;
}

export const ENDGAME_STUDIES: EndgameStudy[] = [
  {
    id: 'endgames-essential',
    title: 'Essential endgames',
    blurb: 'King + queen, king + rook, two rooks, king + pawn and the Lucena position.',
    tags: 'endgame endgames king queen rook mate checkmate pawn lucena opposition basic',
    pgn: "[Event \"Essential endgames: King + queen vs king\"]\n[StudyName \"Essential endgames\"]\n[ChapterName \"King + queen vs king\"]\n[FEN \"8/8/8/3k4/8/8/8/Q3K3 w - - 0 1\"]\n[SetUp \"1\"]\n[Orientation \"white\"]\n\n{The easiest mate. Use the queen a knight's move away from the enemy king to shrink the box, bring your king up, and watch out for stalemate: always leave the enemy king a legal move until the final blow.} 1. Qa5+ {First check pushes the king to the edge of the board.} Ke4 2. Qc5 Kf4 3. Qd5 Ke3 4. Qc4 Kf3 5. Qd4 Kg3 6. Qe4 Kh3 7. Kf2 Kh2 8. Qh7# {Checkmate. The queen is protected by the king.}\n\n[Event \"Essential endgames: King + rook vs king\"]\n[StudyName \"Essential endgames\"]\n[ChapterName \"King + rook vs king\"]\n[FEN \"8/8/8/3k4/8/8/8/R3K3 w - - 0 1\"]\n[SetUp \"1\"]\n[Orientation \"white\"]\n\n{Cut the king off with the rook, then use the opposition to push it back rank by rank. Keep the rook a safe distance from the enemy king and make a waiting move when you need to hand over the move.} 1. Ra2 Ke5 2. Ra3 Kd5 3. Ra4 Ke5 4. Ra5+ Ke4 5. Ke2 Kd4 6. Kf3 Kd3 7. Ra4 Kd2 8. Ra3 Kd1 9. Ke3 Kc2 10. Rd3 Kc1 11. Rd2 Kb1 12. Kd4 Kc1 13. Kc3 Kb1 14. Kb3 Kc1 15. Rd3 Kb1 16. Rd1# {Checkmate on the back rank: the kings face each other and the rook delivers mate.}\n\n[Event \"Essential endgames: Two rooks vs king\"]\n[StudyName \"Essential endgames\"]\n[ChapterName \"Two rooks vs king\"]\n[FEN \"8/8/8/3k4/8/8/8/R3K2R w - - 0 1\"]\n[SetUp \"1\"]\n[Orientation \"white\"]\n\n{The ladder mate: one rook checks along a rank while the other cuts off the next rank. Repeat until the king runs out of room.} 1. Ra5+ Ke4 2. Rh4+ Kd3 3. Rc5 Ke3 4. Rc3# {Checkmate.}\n\n[Event \"Essential endgames: King + pawn: the king in front\"]\n[StudyName \"Essential endgames\"]\n[ChapterName \"King + pawn: the king in front\"]\n[FEN \"4k3/8/4K3/4P3/8/8/8/8 w - - 0 1\"]\n[SetUp \"1\"]\n[Orientation \"white\"]\n\n{With the king in front of its pawn on the 6th rank, White wins. Use the opposition, push the pawn only when it is safe, and avoid stalemate when the pawn is on the 7th.} 1. Kd6 Kd8 2. e6 Ke8 3. e7 Kf7 4. Kd7 Kg7 5. e8=Q {The pawn promotes and White wins easily.}\n\n[Event \"Essential endgames: Lucena position: building a bridge\"]\n[StudyName \"Essential endgames\"]\n[ChapterName \"Lucena position: building a bridge\"]\n[FEN \"1K1k4/1P6/8/8/8/8/r7/5R2 w - - 0 1\"]\n[SetUp \"1\"]\n[Orientation \"white\"]\n\n{The most important rook endgame. White's king shelters on the 8th rank, but the pawn can only advance once the rook builds a bridge on the 4th rank and shields the king from checks.} 1. Rd1+ Ke7 2. Rd4 {The bridge: the rook cuts the enemy king off along the 4th rank.} Ra1 3. Kc7 Rc1+ 4. Kb6 Rb1+ 5. Kc6 Rc1+ 6. Kb5 Rb1+ 7. Rb4 {Rb4 blocks the checks from the side.} Rxb4+ 8. Kxb4 Kd7 9. b8=Q {The pawn promotes.}\n",
  },
];

/** Public Lichess studies, loaded on demand with loadFeaturedPgn(studyId). */
export const ENDGAME_LICHESS_STUDIES = [
  {
    id: 'lichess-endgame-a-z',
    studyId: 'k5E8e1Pd',
    title: 'Endgame A-Z',
    blurb: 'A complete tour of the endgames, from basic mates to rook and minor-piece endings.',
    tags: 'endgame endgames a-z lichess basic rook pawn king queen mate',
  },
  {
    id: 'lichess-100-endgames',
    studyId: 'Dnh4e6jY',
    title: '100 Endgames You Must Know: Basic endings',
    blurb: 'The essential basic endings every player should know by heart.',
    tags: 'endgame endgames 100 must know basic endings lichess',
  },
  {
    id: "lichess-beginner-endgames",
    studyId: "wukLYIXj",
    title: "Beginner Endgames You Must Know!",
    blurb: "Basic endgames: the first endings to learn.",
    tags: "endgame endgames beginner basic lichess",
  },
  {
    id: "lichess-rook-endgames",
    studyId: "bnboDhFM",
    title: "Rook Endgames You Must Know!",
    blurb: "Lucena, Philidor and the other key rook endings.",
    tags: "endgame endgames rook lucena philidor lichess",
  },
  {
    id: "lichess-pawn-endgames",
    studyId: "Xv2XDobK",
    title: "Pawn Endgames You MUST Know",
    blurb: "Opposition, key squares and the square of the pawn.",
    tags: "endgame endgames pawn opposition key squares lichess",
  },
];
