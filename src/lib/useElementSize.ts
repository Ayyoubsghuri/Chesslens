import { useEffect, useRef, useState } from 'react';

/**
 * Tracks an element's actual rendered pixel size via ResizeObserver.
 *
 * The chess board itself sizes responsively with pure CSS (width: 100%,
 * aspect-ratio: 1/1, max-width: cap) — no JS needed for that. But a few
 * sibling elements (e.g. the eval bar) need a real pixel height that
 * matches the board's rendered height, and that can only be known by
 * measuring, since it changes with viewport width. This hook does that
 * measuring so the eval bar (and anything else) stays in sync on every
 * resize/orientation change, not just on first render.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
