/* Easyconvert sounds: classic, soft system-style chimes synthesized with Web Audio.
   No audio files, nothing downloaded. Sound is on by default with a remembered mute switch
   and volume, and nothing ever plays before you have clicked, tapped or pressed a key. */
(function (EC) {
  'use strict';
  var KEY_MUTE = 'easyconvert.muted', KEY_VOL = 'easyconvert.volume';
  var ctx = null, master = null, unlocked = false, log = [];
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var muted = read(KEY_MUTE) === '1';
  var volume = read(KEY_VOL) == null ? 0.7 : Math.max(0, Math.min(1, parseFloat(read(KEY_VOL)) || 0));

  function unlock() {
    unlocked = true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 6;
      master = ctx.createGain(); master.gain.value = volume;
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, unlock, { capture: true, passive: true }); });

  // one soft bell-like partial
  function tone(freq, start, dur, gain, type) {
    var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + start;
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function bell(freq, start, dur, gain) { tone(freq, start, dur, gain, 'sine'); tone(freq * 2, start, dur * 0.6, gain * 0.25, 'sine'); tone(freq * 3.01, start, dur * 0.3, gain * 0.08, 'triangle'); }

  var sounds = {
    // a little two-note "ding" for one file done
    file: function () { bell(1046.5, 0, 0.35, 0.18); bell(1568, 0.07, 0.45, 0.14); },
    // the big one: a warm rising arpeggio and a held chord, for "all files done"
    all: function () {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) { bell(f, i * 0.09, 0.9, 0.16); });
      [523.25, 783.99, 1046.5, 1568].forEach(function (f) { bell(f, 0.5, 1.6, 0.1); });
    },
    // low, gentle "bonk" for a file that failed
    error: function () { tone(220, 0, 0.32, 0.22, 'triangle'); tone(174.6, 0.14, 0.42, 0.2, 'triangle'); },
    // a soft tick for progress milestones
    tick: function () { tone(1760, 0, 0.05, 0.06, 'square'); },
    // export opened / loaded
    open: function () { bell(783.99, 0, 0.3, 0.14); bell(1174.7, 0.08, 0.5, 0.12); }
  };

  function play(name) {
    log.push({ sound: name, at: Math.round(performance.now()), played: !muted && unlocked });
    if (muted || !unlocked || !sounds[name]) return false;
    unlock();
    if (!ctx) return false;
    try { sounds[name](); } catch (e) { return false; }
    return true;
  }

  EC.sound = {
    play: play,
    log: log,
    isMuted: function () { return muted; },
    setMuted: function (m) { muted = !!m; store(KEY_MUTE, muted ? '1' : '0'); },
    getVolume: function () { return volume; },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, v)); store(KEY_VOL, String(volume)); if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02); }
  };
})(window.EC = window.EC || {});
