'use client';

import { useEffect, useRef } from 'react';

/**
 * Podium confetti.
 *
 * Hand-rolled on a canvas rather than pulled from a library: it is ~60 lines,
 * avoids another dependency, and lets the burst be tuned to the moment. Runs
 * once, then stops itself — this is a full stop, not ambience.
 */
export function Confetti({ pieces = 140 }: { pieces?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const colors = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#8b5cf6', '#ffffff'];
    const w = () => canvas.offsetWidth;
    const h = () => canvas.offsetHeight;

    const confetti = Array.from({ length: pieces }, () => ({
      x: Math.random() * w(),
      // Start above the fold so the first frame isn't a wall of paper.
      y: -20 - Math.random() * h() * 0.6,
      size: 6 + Math.random() * 7,
      speed: 1.8 + Math.random() * 2.6,
      drift: -0.9 + Math.random() * 1.8,
      spin: -0.12 + Math.random() * 0.24,
      angle: Math.random() * Math.PI * 2,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    }));

    let raf = 0;
    let settled = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w(), h());
      settled = 0;

      for (const c of confetti) {
        c.y += c.speed;
        c.x += c.drift;
        c.angle += c.spin;

        if (c.y > h() + 20) {
          settled++;
          continue;
        }

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        ctx.fillStyle = c.color;
        // Scaling height by cos() fakes the flutter of a tumbling rectangle.
        ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * Math.abs(Math.cos(c.angle)) * 0.8 + 2);
        ctx.restore();
      }

      // Every piece is off-screen: stop rather than burn frames forever.
      if (settled < confetti.length) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [pieces]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    />
  );
}
