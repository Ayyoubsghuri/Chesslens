import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { haptic } from '../native';
import { Star, ThumbsUp, Check, BookOpen, X } from 'lucide-react';
import type { MoveQuality } from '@/lib/types';
import type { TbFrame } from '@/lib/tablebase';
import { TablebaseNote } from './TablebaseNote';
import { AdvancedCoach } from './AdvancedCoach';
import type { ExplainInput, Scene } from '@/lib/coach-explain';

/** How long each language stays on screen. Tweak freely. */
const ENGLISH_MS = 2000;
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
  miss: 'غا كتخور',
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

const POKES = ['Hehe!', 'Boop!', 'Hey!', 'Ooh!', 'Need a hint?', 'I see you 👀'];
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The coach: a friendly mint-green mascot. It is alive:
 *  - its eyes follow your finger / mouse, and it blinks now and then;
 *  - it floats gently, wiggles on hover and squishes when you tap it (and says something);
 *  - it smiles with happy eyes after a great move and turns red with slanted eyes after a blunder.
 */
export function CoachAvatar({ size, angry, flying, onClick, mood }: { size: number; angry: boolean; flying?: boolean; onClick?: () => void; mood?: 'calm' | 'happy' }) {
  const uid = useId().replace(/:/g, '');
  const live = !flying;
  const box = useRef<HTMLSpanElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [poke, setPoke] = useState(0);          // changes on every tap -> restarts the squish animation
  const [say, setSay] = useState<string | null>(null);
  const pokes = useRef<number[]>([]);
  const sayTimer = useRef<number | undefined>(undefined);

  // Eyes follow the pointer.
  useEffect(() => {
    if (!live || reduceMotion()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = box.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 160) * 5; // up to 5 units in the 120-unit drawing
        setLook({ x: (dx / d) * k, y: (dy / d) * k });
      });
    };
    const leave = () => setLook({ x: 0, y: 0 });
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
  }, [live]);

  // Random blinking.
  useEffect(() => {
    if (!live || reduceMotion()) return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => { setBlink(true); t = window.setTimeout(() => { setBlink(false); loop(); }, 140); }, 2200 + Math.random() * 3800);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [live]);

  useEffect(() => () => window.clearTimeout(sayTimer.current), []);

  const tap = () => {
    if (!live) return;
    haptic();
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 2000), now];
    const many = pokes.current.length >= 4;
    setPoke((n) => n + 1);
    setSay(many ? 'Okay okay, stop! 😵' : angry ? "Don't remind me!" : POKES[Math.floor(Math.random() * POKES.length)]);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSay(null), 1300);
    onClick?.();
  };

  const light = angry ? '#ffd2cb' : '#b4ecd3';
  const mid = angry ? '#ff8a78' : '#62d8a2';
  const dark = angry ? '#f0452f' : '#3ec98a';
  const happy = mood === 'happy' && !angry && !say;
  const eyeStyle = { transformBox: 'fill-box' as const, transformOrigin: 'center', transform: blink ? 'scaleY(0.12)' : 'scaleY(1)', transition: 'transform 90ms ease-out' };

  return (
    <span
      ref={box}
      className={`relative block shrink-0 ${live ? 'coach-live' : ''}`}
      style={{ width: size, height: size, cursor: live ? 'pointer' : undefined, touchAction: 'manipulation' }}
      {...(flying ? {} : { 'data-coach-avatar': '' })}
      {...(live ? { onClick: tap, role: 'button', tabIndex: 0, title: onClick ? 'Tap me (I can replay the blunder)' : 'Tap me!', onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } } } : {})}
    >
      <span className={`block h-full w-full ${live && !reduceMotion() ? 'coach-float' : ''}`}>
        <svg
          key={`${angry ? 'angry' : 'calm'}-${poke}`}
          width={size}
          height={size}
          viewBox="0 0 120 120"
          className={poke > 0 ? 'coach-poke' : angry ? 'coach-angry' : ''}
          style={{ display: 'block', overflow: 'visible' }}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={`cg-${uid}`} gradientUnits="userSpaceOnUse" cx="38" cy="34" r="92">
              <stop offset="0" stopColor={light} />
              <stop offset="0.45" stopColor={mid} />
              <stop offset="1" stopColor={dark} />
            </radialGradient>
          </defs>
          <g transform="translate(60 61) scale(1.14) translate(-60 -60)">
            {/* body leans a little toward what you are looking at */}
            <g style={{ transform: `translate(${look.x * 0.35}px, ${look.y * 0.35}px)`, transition: 'transform 120ms ease-out' }}>
              <polygon points="60,27 101,93 19,93" fill={`url(#cg-${uid})`} stroke={`url(#cg-${uid})`} strokeWidth="24" strokeLinejoin="round" />
              <g style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: 'transform 90ms ease-out' }}>
                {angry ? (
                  <>
                    <g style={eyeStyle}><rect x="48.5" y="47" width="10" height="19" rx="5" fill="#0d0d0d" transform="rotate(30 54 56)" /></g>
                    <g style={eyeStyle}><rect x="67" y="47" width="10" height="19" rx="5" fill="#0d0d0d" transform="rotate(-30 72 56)" /></g>
                  </>
                ) : happy ? (
                  <>
                    <path d="M47 62 Q54 51 61 62" stroke="#0d0d0d" strokeWidth="5" fill="none" strokeLinecap="round" />
                    <path d="M65 58 Q72 47 79 58" stroke="#0d0d0d" strokeWidth="5" fill="none" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <g style={eyeStyle}><rect x="48.5" y="47" width="11" height={say ? 22 : 20} rx="5.5" fill="#0d0d0d" transform="rotate(-14 54 57)" /></g>
                    <g style={eyeStyle}><rect x="66" y="43" width="11" height={say ? 22 : 20} rx="5.5" fill="#0d0d0d" transform="rotate(-14 71.5 53)" /></g>
                  </>
                )}
              </g>
            </g>
          </g>
        </svg>
      </span>
      {say && (
        <span key={poke} className="coach-say pointer-events-none absolute left-1/2 -top-1 z-10 whitespace-nowrap rounded-full bg-[#f5ecd9] px-2.5 py-1 text-[11px] font-bold text-[#1a2a24] shadow-lg" aria-live="polite">
          {say}
        </span>
      )}
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
  /** Position after the move. With 7 pieces or fewer, the tablebase verdict is shown under the bubble. */
  fen?: string;
  /** Plays the tablebase sequence on the board (frames, label). */
  onPlayTablebase?: (frames: TbFrame[], label: string) => void;
  /** Settings → "Advanced coach mode". Adds the step-by-step explanation player under the bubble. */
  advanced?: boolean;
  /** Data the advanced coach needs (positions, engine evals, best move...). */
  explainInput?: ExplainInput | null;
  /** True while the board shows a coach/preview position. */
  previewActive?: boolean;
  /** Puts an advanced-coach scene on the board (null = back to the game). */
  onScene?: (scene: Scene | null) => void;
  /** Settings → "Speak explanations". */
  voice?: boolean;
  voiceName?: string;
  /** Render only the speech-bubble row (no tablebase / advanced panel). Used for the pinned top bar. */
  bubbleOnly?: boolean;
  /** Render everything except the bubble row (a pinned bar elsewhere already shows it). */
  hideBubble?: boolean;
}

export function CoachBubble({ san, quality, color, evalText, moveKey, compact, fork, fen, onPlayTablebase, advanced, explainInput, previewActive, onScene, voice, voiceName, bubbleOnly, hideBubble }: CoachBubbleProps) {
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

  const bubbleRow = (
    <div className="flex items-end gap-1 rounded-xl bg-ink-900 px-3 pt-3" style={{ minHeight: avatar + 12 }}>
      <CoachAvatar
        size={avatar}
        angry={angry}
        mood={['brilliant', 'great', 'best', 'excellent'].includes(quality) ? 'happy' : 'calm'}
        onClick={angry || ['inaccuracy', 'mistake', 'miss'].includes(quality) ? () => window.dispatchEvent(new CustomEvent('coach-blunder-run')) : undefined}
      />

      <div
        className="relative flex-1 min-w-0 mb-3 ml-2 flex items-center gap-3 rounded-2xl bg-[#f5ecd9] px-3.5 py-3 h-[3.25rem] sm:h-[3.75rem] lg:h-[5.5rem] lg:py-2"
        style={{ color: '#1a2a24' }}
        role="status"
        aria-live="polite"
      >
        {/* tail pointing at the coach */}
        <span
          className="absolute -left-2 bottom-4 w-3 h-4 bg-[#f5ecd9]"
          style={{ clipPath: 'polygon(100% 0, 0 50%, 100% 100%)' }}
          aria-hidden="true"
        />

        <QualityDot quality={quality} color={color} size={dot} />

        <span
          key={lang}
          className={`flex-1 min-w-0 font-extrabold leading-none text-left coach-swap whitespace-nowrap overflow-hidden text-ellipsis lg:whitespace-normal lg:text-clip lg:break-words ${lang === 'ar' && !fork ? 'lg:leading-snug text-base lg:text-sm' : `lg:leading-tight lg:text-lg ${compact ? 'text-xl' : 'text-2xl'}`}`}
          dir={lang === 'ar' && !fork ? 'rtl' : 'ltr'}
          lang={lang === 'ar' && !fork ? 'ar' : 'en'}
          style={lang === 'ar' && !fork ? { fontFamily: '"Segoe UI", Tahoma, system-ui, sans-serif', textAlign: 'left' } : { fontFamily: 'var(--cl-font-display)', fontStyle: 'italic', fontWeight: 700 }}
        >
          {fork ? FORK_PHRASE : lang === 'ar' ? DARIJA[quality] : `${figurine(san)} ${ENGLISH_TAIL[quality]}`}
        </span>

        {evalText && (
          <span
            className={`shrink-0 rounded-lg px-2.5 py-1 font-bold font-mono text-white ${compact ? 'text-sm' : 'text-base'}`}
            style={{ backgroundColor: '#22352f', color: '#d8c196' }}
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
        @keyframes coach-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .coach-float { animation: coach-float 3.4s ease-in-out infinite; }
        @keyframes coach-poke { 0% { transform: scale(1,1); } 25% { transform: scale(1.2,0.8) translateY(4px); } 55% { transform: scale(0.9,1.14) translateY(-8px); } 80% { transform: scale(1.04,0.97); } 100% { transform: scale(1,1); } }
        .coach-poke { transform-origin: 50% 88%; animation: coach-poke 480ms cubic-bezier(.3,1.4,.5,1); }
        @keyframes coach-wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-5deg); } 75% { transform: rotate(5deg); } }
        .coach-live:hover > span:first-child { animation: coach-wiggle 420ms ease-in-out; }
        @keyframes coach-say { 0% { opacity: 0; transform: translate(-50%, 6px) scale(.8); } 15% { opacity: 1; transform: translate(-50%, -6px) scale(1); } 85% { opacity: 1; transform: translate(-50%, -10px); } 100% { opacity: 0; transform: translate(-50%, -14px); } }
        .coach-say { animation: coach-say 1300ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) { .coach-swap, .coach-angry, .coach-anger-mark, .coach-float, .coach-poke, .coach-say, .coach-live:hover > span:first-child { animation: none; } }
      `}</style>
    </div>
  );

  // Pinned top bar: just the bubble.
  if (bubbleOnly) return bubbleRow;

  return (
    <div>
    {!hideBubble && bubbleRow}
    {fen && <TablebaseNote fen={fen} compact={compact} onPlayLine={onPlayTablebase} />}
    {advanced && explainInput && onScene && (
      <AdvancedCoach
        input={explainInput}
        moveKey={moveKey}
        previewActive={!!previewActive}
        onScene={onScene}
        compact={compact}
        voice={voice}
        voiceName={voiceName}
      />
    )}
    </div>
  );
}