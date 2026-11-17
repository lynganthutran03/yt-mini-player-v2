import React, { useLayoutEffect, useRef } from 'react';

const SPEED_PX_PER_SEC = 10;
/** Pause at each end, in seconds (independent of text length). */
const PAUSE_SEC = 1;

/**
 * Text that, when it overflows its container, slides left to reveal the end,
 * pauses, then slides back (ping-pong). Short text stays still.
 */
export const MarqueeText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let anim: Animation | null = null;
    let lastOverflow = -1;
    const setup = () => {
      const overflow = Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth));
      if (overflow === lastOverflow) return;
      lastOverflow = overflow;
      anim?.cancel();
      anim = null;
      box.classList.toggle('overflowing', overflow > 0);
      if (overflow === 0 || reduceMotion) return;

      const travel = overflow / SPEED_PX_PER_SEC;
      const total = travel * 2 + PAUSE_SEC * 2;
      const p = PAUSE_SEC / total;
      const t = travel / total;
      anim = inner.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: p, easing: 'ease-in-out' },
          { transform: `translateX(-${overflow}px)`, offset: p + t },
          { transform: `translateX(-${overflow}px)`, offset: 2 * p + t, easing: 'ease-in-out' },
          { transform: 'translateX(0)', offset: 1 },
        ],
        { duration: total * 1000, iterations: Infinity },
      );
    };

    setup();
    const ro = new ResizeObserver(setup);
    ro.observe(box);
    ro.observe(inner);
    const pause = () => anim?.pause();
    const resume = () => anim?.play();
    box.addEventListener('mouseenter', pause);
    box.addEventListener('mouseleave', resume);
    return () => {
      ro.disconnect();
      anim?.cancel();
      box.removeEventListener('mouseenter', pause);
      box.removeEventListener('mouseleave', resume);
    };
  }, [text]);

  return (
    <span ref={boxRef} className={`marquee ${className ?? ''}`.trim()}>
      <span key={text} ref={textRef} className="marquee-inner">
        {text}
      </span>
    </span>
  );
};
