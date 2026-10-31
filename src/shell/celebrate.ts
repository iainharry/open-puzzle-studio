/**
 * Noticing that somebody finished.
 *
 * Carried across from Open Jigsaw Studio M24 unchanged except for the piece shapes. The
 * flash-safety work, the reduced-motion rule and the three-setting argument were all
 * settled there and re-deriving them here would be a way of getting them wrong.
 *
 * Until now the whole of it was one line of text in the status bar: *Complete in 14m 02s*.
 * For an adult that is enough. For the child this app is largely aimed at it is nothing at
 * all — and the request that produced this file was not "add confetti", it was *"he likes
 * to see that his success is noticed"*, which is a different and better specification.
 *
 * ## What it is not
 *
 * **It is not a flash.** Flashing is the one genuinely dangerous thing a celebration can
 * do: WCAG 2.3.1 puts the limit at three general flashes a second, and a children's app
 * is exactly the wrong place to go near it. There is no full-screen flash, no inversion,
 * no strobe. Pieces are thrown, they fall, they fade. The brightness of the screen as a
 * whole barely changes.
 *
 * **It does not cover the picture.** The thing a person most wants to look at the instant
 * they finish is the finished picture. The banner sits at the top of the board rather than
 * across the middle, the particles fall past rather than settle, and the whole overlay is
 * `pointer-events: none` so it cannot swallow a tap.
 *
 * **It does not run on a timer forever.** The overlay is created on completion and removed
 * when it is done. A celebration that leaves a canvas on top of the board is a celebration
 * that eventually gets blamed for a rendering bug.
 *
 * ## Three settings, not two
 *
 * Off / Quiet / Full, rather than a single on-off. The missing middle is the one a
 * classroom actually needs: twenty-five tablets that all chime at different moments is a
 * reason to turn the whole thing off, and turning the whole thing off is how the feature
 * ends up not existing. Quiet keeps what the child sees and drops what the room hears.
 *
 * `prefers-reduced-motion` removes the particles regardless of the setting, and keeps the
 * banner. Somebody who has asked their device for less movement has not asked to be left
 * out of the part that says well done.
 *
 * ## The sound is generated, not shipped
 *
 * A three-note rise from oscillators, a few hundred bytes of code. This project has zero
 * runtime dependencies and ships no binary assets it does not have to; an audio file for
 * one chime would be the largest single asset in the build after the pictures.
 */

export type CelebrationLevel = 'off' | 'quiet' | 'full';

export interface CelebrationPlan {
  /** How many pieces to throw. */
  readonly particles: number;
  /** How long the thrown pieces live. */
  readonly durationMs: number;
  /** False under `prefers-reduced-motion`: banner only. */
  readonly animate: boolean;
  readonly sound: boolean;
}

/** Nothing at all for 'off'. The caller then does not build an overlay. */
export function celebrationPlan(
  pieceCount: number,
  level: CelebrationLevel,
  reducedMotion: boolean,
): CelebrationPlan | null {
  if (level === 'off') return null;
  return {
    // Scaled to the achievement. Nine pieces and five hundred should not get the same
    // fanfare, and the piece count is the only honest measure of effort the app holds.
    // Capped, because a 2,000-piece finish on a tablet should be a celebration and not a
    // reason for the frame rate to collapse at the moment of victory.
    particles: Math.max(24, Math.min(160, Math.round(24 + pieceCount * 0.6))),
    durationMs: 2600,
    animate: !reducedMotion,
    // Deliberately *not* suppressed by reduced motion: that preference is about movement
    // on screen, and silencing somebody's chime because they get motion sick is a
    // conclusion the setting does not support.
    sound: level === 'full',
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  hue: number;
}

/**
 * Jigsaw-piece colours rather than party confetti.
 *
 * Hues spread around the wheel at a saturation that reads on both the dark and the light
 * table without anything becoming invisible on either.
 */
const HUES = [8, 40, 95, 150, 200, 265, 320];

/**
 * Throw some pieces across the screen.
 *
 * Returns a function that stops it early — used when a new puzzle is cut mid-celebration,
 * which otherwise leaves pieces raining over a board they have nothing to do with.
 */
export function runCelebration(
  canvas: HTMLCanvasElement,
  plan: CelebrationPlan,
  now: () => number = () => performance.now(),
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !plan.animate) return () => undefined;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.scale(dpr, dpr);

  const particles: Particle[] = [];
  for (let i = 0; i < plan.particles; i++) {
    // Launched from two points rather than one. A single fountain reads as a jet of
    // something; two reads as a celebration, and it is one extra line.
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -Math.PI / 3 : (-Math.PI * 2) / 3) + (Math.random() - 0.5) * 0.9;
    const speed = 420 + Math.random() * 380;
    particles.push({
      x: fromLeft ? w * 0.18 : w * 0.82,
      y: h * 0.82,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 7 + Math.random() * 9,
      spin: (Math.random() - 0.5) * 9,
      angle: Math.random() * Math.PI,
      hue: HUES[Math.floor(Math.random() * HUES.length)]!,
    });
  }

  const started = now();
  let frame = 0;
  let last = started;
  let stopped = false;

  const step = (): void => {
    if (stopped) return;
    const t = now();
    // Clamped, because a backgrounded tab resumes with a gap of seconds and an unclamped
    // step would teleport every particle off the screen in one frame.
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const elapsed = t - started;
    if (elapsed > plan.durationMs) {
      ctx.clearRect(0, 0, w, h);
      stopped = true;
      return;
    }

    ctx.clearRect(0, 0, w, h);
    const fade = Math.max(0, 1 - elapsed / plan.durationMs);
    for (const p of particles) {
      p.vy += 980 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = fade;
      ctx.fillStyle = `hsl(${p.hue} 85% 62%)`;
      // Plain rounded squares here, not jigsaw pieces: these are the squares of the grid
      // that was just filled in, thrown into the air.
      ctx.beginPath();
      ctx.roundRect(-p.size / 2, -p.size / 2, p.size, p.size, p.size * 0.22);
      ctx.fill();
      ctx.restore();
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, w, h);
  };
}

/**
 * Three notes going up.
 *
 * Wrapped in a try/catch that swallows everything, because audio is the single most
 * likely thing in this app to be unavailable for a reason outside its control — a
 * permissions policy, a muted device, an autoplay rule, a browser that has not been
 * touched since the page loaded. None of those is worth a message, and none of them
 * should stop the pieces flying.
 */
export function playFanfare(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    // C5, E5, G5 — a major triad, which is the least annoying thing three notes can be.
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const at = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      // Ramped rather than switched: a gain that jumps to full produces an audible click
      // on every note, which on a tablet speaker is most of what you hear.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
    // Closed after the last note, so a session of twenty puzzles does not leave twenty
    // audio contexts open — some browsers cap them and then silently refuse the next.
    setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch {
    /* no audio available; the visible half of the celebration is unaffected */
  }
}

/** A longer, patterned buzz than a piece landing gets. Silent where unsupported. */
export function celebrationBuzz(): void {
  try {
    navigator.vibrate?.([40, 60, 40, 60, 140]);
  } catch {
    /* not supported, or blocked by a permissions policy */
  }
}
