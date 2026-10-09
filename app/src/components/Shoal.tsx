"use client";

// The ciphertext shoal: real ciphertext bytes rendered as glyph-fish that school through the dark.
// When `bytes` changes, a new shoal bursts from the origin point (where the plaintext was) and
// disperses: the number is gone, only unreadable bytes remain. Respects reduced motion.
import { useEffect, useRef } from "react";

interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: string;
  a: number;
  hue: number;
}

export function Shoal({ bytes, origin, className, lantern }: { bytes: Uint8Array | null; origin?: { x: number; y: number }; className?: string; lantern?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fish = useRef<Fish[]>([]);
  const lanternRef = useRef(false);
  const redraw = useRef<(() => void) | null>(null);
  lanternRef.current = Boolean(lantern);

  // ambient school (before any encryption): sparse random glyphs
  useEffect(() => {
    const c = canvas.current!;
    const seed = new Uint8Array(140);
    crypto.getRandomValues(seed);
    const w = c.clientWidth || 800;
    const h = c.clientHeight || 500;
    fish.current = Array.from(seed, (b) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.3,
      g: b.toString(16).padStart(2, "0"),
      a: 0.18 + Math.random() * 0.25,
      hue: 188 + Math.random() * 14,
    }));
  }, []);

  // a new ciphertext: burst from the origin
  useEffect(() => {
    if (!bytes || !canvas.current) return;
    const c = canvas.current;
    const ox = origin?.x ?? c.clientWidth * 0.3;
    const oy = origin?.y ?? c.clientHeight * 0.5;
    const step = Math.max(1, Math.floor(bytes.length / 420));
    const burst: Fish[] = [];
    for (let i = 0; i < bytes.length; i += step) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 3.2;
      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp * 0.6;
      // start each glyph somewhere along its own path: even a single frame reads as a school
      // leaving the origin, not a clump (also what reduced-motion users see)
      const k = 6 + Math.random() * 70;
      burst.push({ x: ox + vx * k, y: oy + vy * k, vx, vy, g: bytes[i]!.toString(16).padStart(2, "0"), a: 0.95 - k / 140, hue: 186 + Math.random() * 18 });
    }
    fish.current = [...fish.current.slice(-120), ...burst];
    redraw.current?.();
  }, [bytes, origin?.x, origin?.y]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    const frame = () => {
      t += 0.004;
      const w = c.clientWidth;
      const h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.font = "500 11px var(--font-plex-mono), ui-monospace, monospace";
      for (const f of fish.current) {
        if (!reduced) {
          // a slow current field + gentle schooling drift
          const flow = Math.sin(f.y * 0.012 + t * 3) * 0.05 + 0.025;
          f.vx = f.vx * 0.985 + flow;
          f.vy = f.vy * 0.985 + Math.cos(f.x * 0.01 + t * 2) * 0.03;
          f.x += f.vx;
          f.y += f.vy;
          if (f.x > w + 20) f.x = -20;
          if (f.x < -20) f.x = w + 20;
          if (f.y > h + 20) f.y = -20;
          if (f.y < -20) f.y = h + 20;
          if (f.a > 0.35) f.a *= 0.996;
        }
        ctx.fillStyle = `hsla(${f.hue}, 100%, 70%, ${f.a})`;
        ctx.fillText(f.g, f.x, f.y);
      }
      if (lanternRef.current) {
        const g = ctx.createRadialGradient(w * 0.78, h * 0.42, 0, w * 0.78, h * 0.42, 140);
        g.addColorStop(0, "rgba(255,182,72,0.35)");
        g.addColorStop(1, "rgba(255,182,72,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    redraw.current = () => {
      if (reduced) frame();
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className={className} />;
}
