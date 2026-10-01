import { useEffect, useState } from 'react';
import { Star, ThumbsUp, Check, BookOpen, X } from 'lucide-react';
import type { MoveQuality } from '@/lib/types';

/** How long each language stays on screen. Tweak freely. */
const ENGLISH_MS = 3500;
const DARIJA_MS = 2000; // the 2-second switch

/** Qualities that make the coach angry. */
const ANGRY: MoveQuality[] = ['blunder'];

/** Phrases from the reference sheet (WhatsApp image). */
const DARIJA: Record<MoveQuality, string> = {
  brilliant: 'مقودة',
  best: 'احسن ما غنات ام كلثوم',
  great: 'الرضا',
  excellent: 'ازبي مابيكش',
  good: 'هاديك الخوينز',
  book: 'قضي وعدي',
  inaccuracy: 'بقا تحل عينيك',
  mistake: 'عور شوية',
  miss: 'مطنگ امدير',
  blunder: 'مصرفق فكرك لا ؟',
};

/** Chess.com-style English phrases: "<move> <tail>". */
const ENGLISH_TAIL: Record<MoveQuality, string> = {
  brilliant: 'is brilliant',
  best: 'is the best move',
  great: 'is a great move',
  excellent: 'is excellent',
  good: 'is good',
  book: 'is a book move',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'is a miss',
  blunder: 'is a blunder',
};

/** What the coach shouts on a knight fork. */
const FORK_PHRASE = 'W NRIIIISKII';

const FIGURINE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

/** "Bg5" -> "♗g5" (outlined figurine, like the reference). */
function figurine(san: string): string {
  const glyph = FIGURINE[san[0]];
  return glyph ? glyph + san.slice(1) : san;
}

function QualityDot({ quality, color, size }: { quality: MoveQuality; color: string; size: number }) {
  const icon = Math.round(size * 0.55);
  const text = 'font-black text-white leading-none tracking-tighter';
  return (
    <span
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {quality === 'brilliant' && <span className={text} style={{ fontSize: size * 0.5 }}>!!</span>}
      {quality === 'great' && <span className={text} style={{ fontSize: size * 0.6 }}>!</span>}
      {quality === 'inaccuracy' && <span className={text} style={{ fontSize: size * 0.5 }}>?!</span>}
      {quality === 'mistake' && <span className={text} style={{ fontSize: size * 0.6 }}>?</span>}
      {quality === 'blunder' && <span className={text} style={{ fontSize: size * 0.5 }}>??</span>}
      {quality === 'best' && <Star size={icon} className="text-white" fill="white" />}
      {quality === 'excellent' && <ThumbsUp size={icon} className="text-white" fill="white" />}
      {quality === 'good' && <Check size={icon} className="text-white" strokeWidth={3.5} />}
      {quality === 'book' && <BookOpen size={icon} className="text-white" />}
      {quality === 'miss' && <X size={icon} className="text-white" strokeWidth={4} />}
    </span>
  );
}

/** Drawn cartoon coach. Calm and smiling normally; furious on a blunder. */
function CoachAvatar({ size, angry }: { size: number; angry: boolean }) {
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      <span
        className="block h-full w-full overflow-hidden rounded-full"
        style={{ backgroundColor: angry ? '#5a2620' : '#2f3542' }}
      >
      <svg
        key={angry ? 'angry' : 'calm'}
        width={size}
        height={size}
        viewBox="0 0 120 120"
        className={angry ? 'coach-angry' : ''}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        {/* hoodie */}
        <path d="M8 120 C10 92 30 84 60 84 C90 84 110 92 112 120 Z" fill="#d4d7d9" />
        <path d="M40 86 C46 100 74 100 80 86 C74 90 46 90 40 86 Z" fill="#b9bdc0" />
        <path d="M50 94 L48 112" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M70 94 L72 112" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* neck + ears */}
        <rect x="49" y="70" width="22" height="18" rx="8" fill="#e2ac8c" />
        <ellipse cx="28" cy="52" rx="5" ry="8" fill="#eab796" />
        <ellipse cx="92" cy="52" rx="5" ry="8" fill="#eab796" />
        {/* face */}
        <path d="M30 44 C30 24 44 16 60 16 C76 16 90 24 90 44 C90 66 76 80 60 80 C44 80 30 66 30 44 Z" fill="#f0c4a6" />
        {angry && (
          <path
            d="M30 44 C30 24 44 16 60 16 C76 16 90 24 90 44 C90 66 76 80 60 80 C44 80 30 66 30 44 Z"
            fill="#fa412d"
            opacity="0.38"
          />
        )}
        {/* hair */}
        <path
          d="M27 46 C20 28 30 8 52 6 C60 2 74 4 82 12 C94 16 98 32 92 46 C90 38 86 32 80 30 C70 34 52 30 44 24 C38 30 32 36 27 46 Z"
          fill="#6e4a38"
        />
        <path d="M44 24 C52 20 62 18 70 20" stroke="#8a6350" strokeWidth="3" fill="none" strokeLinecap="round" />

        {angry ? (
          <>
            {/* slanted, furrowed brows */}
            <path d="M37 35 L56 44" stroke="#3d2619" strokeWidth="4" strokeLinecap="round" />
            <path d="M83 35 L64 44" stroke="#3d2619" strokeWidth="4" strokeLinecap="round" />
            {/* narrowed eyes */}
            <ellipse cx="48" cy="49" rx="4" ry="2.6" fill="#fff" />
            <ellipse cx="72" cy="49" rx="4" ry="2.6" fill="#fff" />
            <circle cx="49" cy="49.5" r="2" fill="#2a2020" />
            <circle cx="71" cy="49.5" r="2" fill="#2a2020" />
            <path d="M42 46 L55 46" stroke="#5a3a2c" strokeWidth="1.5" />
            <path d="M65 46 L78 46" stroke="#5a3a2c" strokeWidth="1.5" />
            {/* nose */}
            <path d="M60 50 Q56 60 60 62" stroke="#c9604f" strokeWidth="2" fill="none" strokeLinecap="round" />
            {/* gritted teeth */}
            <rect x="46" y="65" width="28" height="9" rx="3" fill="#fff" stroke="#8a2f25" strokeWidth="2" />
            <path d="M53 65 V74 M60 65 V74 M67 65 V74" stroke="#8a2f25" strokeWidth="1.2" />
            <path d="M44 74 Q60 64 76 74" stroke="#8a2f25" strokeWidth="0" fill="none" />
          </>
        ) : (
          <>
            <path d="M41 40 Q48 36 55 40" stroke="#5a3a2c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M65 40 Q72 36 79 40" stroke="#5a3a2c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <circle cx="48" cy="48" r="2.6" fill="#2a2020" />
            <circle cx="72" cy="48" r="2.6" fill="#2a2020" />
            <path d="M60 50 Q56 60 60 62" stroke="#d29c7e" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M38 62 C42 76 78 76 82 62 C76 70 44 70 38 62 Z" fill="#d9a98b" opacity="0.7" />
            <path d="M45 64 Q60 78 75 64 Q60 68 45 64 Z" fill="#fff" stroke="#b5755c" strokeWidth="1.5" strokeLinejoin="round" />
          </>
        )}
      </svg>
      </span>
      {angry && (
        <span className="coach-anger-mark absolute -top-1 -right-1 select-none" style={{ fontSize: size * 0.32 }} aria-hidden="true">
          💢
        </span>
      )}
    </span>
  );
}

interface CoachBubbleProps {
  san: string;
  quality: MoveQuality;
  /** Accent color for the quality icon (QUALITY_META[quality].color). */
  color: string;
  /** Eval after the move, already formatted (e.g. "-3.64"). */
  evalText?: string | null;
  /** Changes whenever a new move is shown, so the language timer restarts on English. */
  moveKey: string | number;
  compact?: boolean;
  /** Knight fork: the coach shouts the fork phrase instead of the usual lines. */
  fork?: boolean;
}

export function CoachBubble({ san, quality, color, evalText, moveKey, compact, fork }: CoachBubbleProps) {
  const [lang, setLang] = useState<'en' | 'ar'>('en');

  // English -> (2s of Darija) -> English -> ..., restarting on every new move.
  useEffect(() => {
    setLang('en');
    if (fork) return; // the fork phrase stays on screen
    let timer: number;
    const toDarija = () => {
      setLang('ar');
      timer = window.setTimeout(toEnglish, DARIJA_MS);
    };
    const toEnglish = () => {
      setLang('en');
      timer = window.setTimeout(toDarija, ENGLISH_MS);
    };
    timer = window.setTimeout(toDarija, ENGLISH_MS);
    return () => window.clearTimeout(timer);
  }, [moveKey, quality, fork]);

  const angry = ANGRY.includes(quality);
  const avatar = compact ? 56 : 88;
  const dot = compact ? 24 : 34;

  return (
    <div className="flex items-end gap-1 rounded-xl bg-ink-900 px-3 pt-3" style={{ minHeight: avatar + 12 }}>
      <CoachAvatar size={avatar} angry={angry} />

      <div
        className="relative flex-1 min-w-0 mb-3 ml-2 flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3"
        style={{ color: '#262421' }}
        role="status"
        aria-live="polite"
      >
        {/* tail pointing at the coach */}
        <span
          className="absolute -left-2 bottom-4 w-3 h-4 bg-white"
          style={{ clipPath: 'polygon(100% 0, 0 50%, 100% 100%)' }}
          aria-hidden="true"
        />

        <QualityDot quality={quality} color={color} size={dot} />

        <span
          key={lang}
          className={`flex-1 min-w-0 font-extrabold leading-tight text-left coach-swap ${compact ? 'text-base' : 'text-xl'}`}
          dir={lang === 'ar' && !fork ? 'rtl' : 'ltr'}
          lang={lang === 'ar' && !fork ? 'ar' : 'en'}
          style={lang === 'ar' && !fork ? { fontFamily: '"Segoe UI", Tahoma, system-ui, sans-serif', textAlign: 'left' } : undefined}
        >
          {fork ? FORK_PHRASE : lang === 'ar' ? DARIJA[quality] : `${figurine(san)} ${ENGLISH_TAIL[quality]}`}
        </span>

        {evalText && (
          <span
            className={`shrink-0 rounded-lg px-2.5 py-1 font-bold font-mono text-white ${compact ? 'text-sm' : 'text-base'}`}
            style={{ backgroundColor: '#4b4845' }}
          >
            {evalText}
          </span>
        )}
      </div>

      <style>{`
        @keyframes coach-swap-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .coach-swap { animation: coach-swap-in 220ms ease-out; }
        @keyframes coach-shake { 0%,100% { transform: translateX(0) rotate(0); } 15% { transform: translateX(-4px) rotate(-3deg); } 30% { transform: translateX(4px) rotate(3deg); } 45% { transform: translateX(-3px) rotate(-2deg); } 60% { transform: translateX(3px) rotate(2deg); } 80% { transform: translateX(-1px); } }
        .coach-angry { animation: coach-shake 500ms ease-in-out; }
        @keyframes coach-pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.3); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        .coach-anger-mark { animation: coach-pop 300ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .coach-swap, .coach-angry, .coach-anger-mark { animation: none; } }
      `}</style>
    </div>
  );
}