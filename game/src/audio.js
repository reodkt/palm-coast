// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// WebAudio sound, synthesised: no files, no network. A lazy AudioContext (browsers
// require a user gesture first), a two-tone siren loop while the heat is on, an engine
// hum whose pitch follows the player's speed, and one-shot effects.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let siren = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // --- engine: a sawtooth whose frequency tracks speed, gain tracks throttle ---
  function startEngine() {
    if (!ensure() || engine) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 40;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    engine = { osc, gain };
  }

  function engineUpdate(speed, on) {
    if (!engine) return;
    const t = ctx.currentTime;
    const target = on ? Math.min(0.05, 0.012 + Math.abs(speed) / 330 * 0.04) : 0;
    engine.gain.gain.setTargetAtTime(muted ? 0 : target, t, 0.1);
    engine.osc.frequency.setTargetAtTime(40 + Math.abs(speed) * 0.45, t, 0.08);
  }

  // --- siren: two alternating tones while police are in pursuit ---
  function sirenSet(on) {
    if (!ensure()) return;
    if (on && !siren) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      gain.gain.value = muted ? 0 : 0.02;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      const t0 = ctx.currentTime;
      osc.frequency.setValueAtTime(660, t0);
      osc.frequency.setValueAtTime(880, t0 + 0.35);
      osc.frequency.setValueAtTime(660, t0 + 0.7);
      const loop = () => {
        if (!siren) return;
        const t = ctx.currentTime;
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(880, t + 0.35);
        osc.frequency.setValueAtTime(660, t + 0.7);
        setTimeout(loop, 700);
      };
      loop();
      siren = { osc, gain };
    } else if (!on && siren) {
      try {
        siren.osc.stop();
      } catch { /* already stopped */ }
      siren = null;
    }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  // --- music: called once per frame with the wanted level ---
  function musicUpdate(wanted) {
    const wantMood = wanted >= 2 ? 1 : 0;
    if (wantMood !== mood) mood = wantMood;
    musicStart();
    if (siren && wanted === 0) sirenSet(false);
  }

  // --- one-shot effects ---
  function blip(freq, dur, type, vol) {
    if (!ensure() || muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ensure() || muted) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function honk() {
    blip(370, 0.28, 'square', 0.07);
    blip(466, 0.28, 'square', 0.05);
  }

  function crash() {
    // crunchy metallic impact: fast noise burst + low thunk
    noise(0.18, 0.3, 2200);
    blip(95, 0.14, 'sawtooth', 0.14);
  }

  // --- screenshot mode has no audio clock; a no-op sentinel keeps autoplay happy ---
  function noop() {}

  // --- procedural music: 16-step bass + arp loop, mood shifts with the wanted level ---
  let musicTimer = null;
  let mood = 0; // 0 chill, 1 tense (2+ stars)
  const BASS_CHILL = [0, 0, 7, 0, 0, 0, 5, 0, 0, 0, 7, 0, 3, 0, 5, 0];
  const BASS_HEAT = [0, 0, 0, 6, 0, 0, 0, 6, 1, 0, 1, 0, 6, 0, 0, 0];
  const ARP = [12, 19, 16, 19, 12, 19, 15, 19, 12, 19, 16, 19, 14, 17, 12, 17];

  function musicNote(freq, dur, type, vol) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(); osc.stop(t + dur + 0.02);
  }

  function musicStart() {
    if (!ensure() || musicTimer) return;
    let step = 0;
    musicTimer = setInterval(() => {
      if (!ctx || muted) return;
      if (ctx.state === 'suspended') return;
      const bass = mood > 0 ? BASS_HEAT : BASS_CHILL;
      const root = mood > 0 ? 49 : 41.2; // G1 tense, E1 chill
      const tempo = mood > 0 ? 140 : 180;
      if (bass[step % 16] !== null && bass[step % 16] !== undefined) {
        const semi = bass[step % 16];
        musicNote(root * Math.pow(2, semi / 12) * 2, mood > 0 ? 0.16 : 0.3, 'sawtooth', 0.05);
      }
      if (step % 2 === 0 || mood > 0) {
        const semi = ARP[(step + (mood > 0 ? 4 : 0)) % 16];
        musicNote(root * Math.pow(2, semi / 12) * 4, 0.12, 'triangle', 0.028);
      }
      if (mood > 0 && step % 4 === 2) noiseTick(); // hi-hat when hunted
      step++;
      void tempo;
    }, 175);
  }

  function noiseTick() {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.03));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = muted ? 0 : 0.04;
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start();
  }

  return {
    resume,
    startEngine,
    engineUpdate,
    sirenSet,
    setMuted,
    crash,
    honk,
    noop,
    musicUpdate,
    get muted() {
      return muted;
    },
    shot() {
      noise(0.12, 0.25, 3200);
      blip(180, 0.06, 'square', 0.08);
    },
    explosion() {
      noise(0.7, 0.5, 900);
      blip(60, 0.5, 'sawtooth', 0.2);
    },
    pickup() {
      blip(660, 0.08, 'square', 0.1);
      setTimeout(() => blip(990, 0.1, 'square', 0.1), 70);
    },
    cash() {
      blip(880, 0.07, 'triangle', 0.12);
      setTimeout(() => blip(1320, 0.09, 'triangle', 0.12), 60);
    },
    hurt() {
      blip(160, 0.15, 'sawtooth', 0.15);
    },
    door() {
      blip(220, 0.05, 'triangle', 0.08);
    },
    honk() {
      blip(392, 0.18, 'square', 0.06);
      blip(494, 0.18, 'square', 0.05);
    },
    mission() {
      blip(523, 0.12, 'triangle', 0.14);
      setTimeout(() => blip(659, 0.12, 'triangle', 0.14), 120);
      setTimeout(() => blip(784, 0.2, 'triangle', 0.14), 240);
    },
  };
}
