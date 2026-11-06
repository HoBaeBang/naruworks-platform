// “Click effect, Confetti”: a short burst of paper confetti from the button
// that was clicked. Drawn on a temporary full-viewport canvas (pointer-events: none) that removes itself when the
// last piece has fallen out of view; skipped when the person prefers reduced motion.

export type ButtonEffect = 'confetti';

const COLORS = ['#818cf8', '#e03e3e', '#dfab01', '#0f7b6c', '#a78bfa', '#fb923c', '#ad1a72', '#4dab9a'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  tilt: number;
  color: string;
}

export function fireConfetti(origin: HTMLElement | DOMRect | null, count = 90): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    /* ignore */
  }
  const rect = origin instanceof HTMLElement ? origin.getBoundingClientRect() : origin;
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;
  const canvas = document.createElement('canvas');
  canvas.className = 'nc-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '10000' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    // a fan that opens upwards (-150°…-30°)
    const a = (-150 + Math.random() * 120) * (Math.PI / 180);
    const speed = 6 + Math.random() * 9;
    pieces.push({
      x: cx + (Math.random() - 0.5) * (rect?.width ?? 40) * 0.6,
      y: cy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      w: 6 + Math.random() * 5,
      h: 3 + Math.random() * 4,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      tilt: Math.random() * Math.PI,
      color: COLORS[i % COLORS.length],
    });
  }
  const start = performance.now();
  let last = start;
  const step = (now: number) => {
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = 0;
    const fade = Math.max(0, 1 - Math.max(0, now - start - 1600) / 600);
    for (const p of pieces) {
      p.vy += 0.32 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.tilt += 0.12 * dt;
      if (p.y > window.innerHeight + 20) continue;
      alive++;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive && fade > 0 && now - start < 4000) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}
