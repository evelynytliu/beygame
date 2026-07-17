// ============ Audio System (WebAudio, no assets) ============
const AudioSys = {
    ctx: null,
    enabled: true,
    musicEnabled: true,
    _musicTimer: null,
    _musicStep: 0,

    init: function() {
        if (!this.ctx) {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    playTone: function(freq, type, dur, vol = 0.1) {
        if (!this.ctx || !this.enabled) return;
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + dur);
    },

    playClick: function() { this.init(); this.playTone(600, 'sine', 0.08, 0.05); },
    playCharge: function(pitch) { this.playTone(200 + pitch * 3, 'sawtooth', 0.1, 0.08); },
    playGo: function() { this.playTone(800, 'square', 0.6, 0.1); },
    playPerfect: function() { [880, 1108, 1318, 1760].forEach((f, i) => setTimeout(() => this.playTone(f, 'triangle', 0.25, 0.15), i * 70)); },
    playBoost: function() {
        if (!this.ctx || !this.enabled) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + 0.25);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(t); osc.stop(t + 0.3);
    },
    playCoin: function() { [1318, 1760].forEach((f, i) => setTimeout(() => this.playTone(f, 'square', 0.12, 0.08), i * 80)); },
    playUnlock: function() { [523, 783, 1046, 1568].forEach((f, i) => setTimeout(() => this.playTone(f, 'triangle', 0.3, 0.12), i * 90)); },
    playDeny: function() { this.playTone(140, 'square', 0.2, 0.08); },

    playHit: function(intensity) {
        if (!this.ctx || !this.enabled) return;
        const vol = Math.min(Math.max(intensity * 0.1, 0.1), 0.5);
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 80 + Math.random() * 40;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(t); osc.stop(t + 0.2);
    },

    playBurst: function() {
        if (!this.ctx || !this.enabled) return;
        const t = this.ctx.currentTime;
        // noise blast
        const bufSize = this.ctx.sampleRate * 0.5;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        src.connect(gain); gain.connect(this.ctx.destination);
        src.start(t);
        // descending boom
        const osc = this.ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);
        const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.3, t);
        g2.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        osc.connect(g2); g2.connect(this.ctx.destination);
        osc.start(t); osc.stop(t + 0.5);
    },

    playWall: function() { this.playTone(300, 'sine', 0.1, 0.1); },
    playWin: function() { [523, 659, 783, 1046].forEach((f, i) => setTimeout(() => this.playTone(f, 'triangle', 0.4, 0.2), i * 150)); },
    playLose: function() { [440, 415, 392, 349].forEach((f, i) => setTimeout(() => this.playTone(f, 'sawtooth', 0.5, 0.15), i * 200)); },

    playGrind: function(intensity) {
        if (!this.ctx || !this.enabled) return;
        const t = this.ctx.currentTime;
        const bufSize = 2 * this.ctx.sampleRate;
        if (!this._noiseBuffer) {
            this._noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
            const d = this._noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer;
        const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 800 + intensity * 400; filt.Q.value = 2;
        const gain = this.ctx.createGain(); gain.gain.setValueAtTime(Math.min(intensity * 0.04, 0.08), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        src.connect(filt); filt.connect(gain); gain.connect(this.ctx.destination);
        src.start(t); src.stop(t + 0.15);
    },

    playEdgeWarn: function() { this.playTone(60, 'sine', 0.2, 0.06); },

    // Spinning hum
    _spinHum: null, _spinHumGain: null,
    updateSpinHum: function(spinMag) {
        if (!this.ctx || !this.enabled) { return; }
        if (!this._spinHum) {
            this._spinHum = this.ctx.createOscillator();
            this._spinHumGain = this.ctx.createGain();
            this._spinHum.type = 'sine';
            this._spinHum.frequency.value = 80;
            this._spinHumGain.gain.value = 0;
            this._spinHum.connect(this._spinHumGain);
            this._spinHumGain.connect(this.ctx.destination);
            this._spinHum.start();
        }
        const freq = 60 + spinMag * 200;
        const vol = Math.min(spinMag * 0.06, 0.04);
        this._spinHum.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
        this._spinHumGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
    },
    stopSpinHum: function() {
        if (this._spinHumGain && this.ctx) this._spinHumGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    },

    // ---------- Ambient music: slow minor arpeggio, very quiet ----------
    _musicNotes: [110, 130.8, 164.8, 220, 164.8, 130.8, 146.8, 174.6],
    startMusic: function() {
        if (this._musicTimer || !this.musicEnabled) return;
        this.init();
        const stepMs = 480;
        this._musicTimer = setInterval(() => {
            if (!this.enabled || !this.musicEnabled || !this.ctx) return;
            const n = this._musicNotes[this._musicStep % this._musicNotes.length];
            this._musicStep++;
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            osc.type = 'triangle'; osc.frequency.value = n;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.035, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(t); osc.stop(t + 1.0);
            // soft fifth above every 4 steps
            if (this._musicStep % 4 === 0) {
                const o2 = this.ctx.createOscillator(); const g2 = this.ctx.createGain();
                o2.type = 'sine'; o2.frequency.value = n * 1.5;
                g2.gain.setValueAtTime(0.0001, t);
                g2.gain.linearRampToValueAtTime(0.02, t + 0.08);
                g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
                o2.connect(g2); g2.connect(this.ctx.destination);
                o2.start(t); o2.stop(t + 1.3);
            }
        }, stepMs);
    },
    stopMusic: function() {
        if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    }
};

// ============ Haptics ============
const Haptics = {
    enabled: true,
    buzz: function(pattern) {
        if (!this.enabled) return;
        if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
    },
    hit: function(intensity) { this.buzz(Math.min(Math.round(10 + intensity * 20), 60)); },
    launch: function() { this.buzz([15, 30, 40]); },
    burst: function() { this.buzz([60, 40, 80]); },
    win: function() { this.buzz([30, 50, 30, 50, 60]); },
    tap: function() { this.buzz(8); }
};
