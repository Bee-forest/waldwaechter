// Haptisches und akustisches Feedback.
// Vibration API: Android/Chrome ja, iOS/Safari nein → dort Signalton + Bildschirmblitz.

const PATTERNS = {
  arrive: [250, 120, 250, 120, 400], // Rasterpunkt erreicht
  done: [80, 60, 80],                // Punkt abgeschlossen
  tick: [30],                        // Baum gezählt
};

let ctx;
export function unlockAudio() {
  // Muss in einer Nutzeraktion aufgerufen werden (iOS-Vorgabe)
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* kein Audio */ }
}

function beep(kind) {
  if (!ctx) return;
  const seq = kind === 'arrive' ? [880, 0, 880, 0, 1175] : kind === 'done' ? [660, 990] : [1200];
  let t = ctx.currentTime;
  for (const f of seq) {
    const dur = kind === 'tick' ? 0.04 : 0.16;
    if (f) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'square';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    t += dur + 0.06;
  }
}

function flash() {
  document.body.classList.remove('flash');
  void document.body.offsetWidth;
  document.body.classList.add('flash');
}

/** Löst Feedback aus. Gibt true zurück, wenn tatsächlich vibriert wurde. */
export function buzz(kind = 'arrive') {
  let vibrated = false;
  if ('vibrate' in navigator) {
    try { vibrated = navigator.vibrate(PATTERNS[kind]); } catch { vibrated = false; }
  }
  if (!vibrated && kind !== 'tick') { unlockAudio(); beep(kind); }
  if (kind === 'arrive') flash();
  return vibrated;
}

// Bildschirm während der Navigation anlassen (Screen Wake Lock API)
let lock = null, wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* nicht unterstützt oder verweigert */ }
}
document.addEventListener('visibilitychange', () => { if (wantLock && document.visibilityState === 'visible') keepAwake(true); });
