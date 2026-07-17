// ============================================================
// Neon Spinner: Ultimate Arena — main app
// ============================================================
'use strict';

// ---------------- Persistence ----------------
const DEFAULT_SAVE = {
    coins: 150,
    wins: 0, losses: 0, streak: 0, bestStreak: 0,
    cleared: [],
    unlocked: {
        blade: ['triad', 'guard'],
        weight: ['light', 'std'],
        tip: ['needle', 'ball']
    },
    build: { blade: 'triad', weight: 'std', tip: 'ball' },
    color: '#00f3ff',
    drawing: null,
    settings: { sound: true, music: true, haptics: true, fx: true },
    tutorialDone: false,
    launches: 0, perfects: 0
};

const Save = {
    data: null,
    load: function() {
        try {
            const raw = JSON.parse(localStorage.getItem('beygame2') || 'null');
            this.data = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SAVE)), raw || {});
            this.data.unlocked = Object.assign({}, DEFAULT_SAVE.unlocked, (raw && raw.unlocked) || {});
            this.data.settings = Object.assign({}, DEFAULT_SAVE.settings, (raw && raw.settings) || {});
        } catch (e) { this.data = JSON.parse(JSON.stringify(DEFAULT_SAVE)); }
        AudioSys.enabled = this.data.settings.sound;
        AudioSys.musicEnabled = this.data.settings.music;
        Haptics.enabled = this.data.settings.haptics;
    },
    write: function() { localStorage.setItem('beygame2', JSON.stringify(this.data)); }
};

// ---------------- Global state ----------------
const ARENA_RADIUS = 42;
const BOWL_RADIUS = ARENA_RADIUS * 1.6;
const MAX_SPIN = 0.9;
const PHYS = { restitution: 0.8, forceMult: 0.95, gravity: 1.0, maxSpeed: 2.4, ringOutSpeed: 1.25, maxImpulseDv: 2.1 };

const state = {
    screen: 'HOME',        // HOME | GARAGE | LEVELS | LAUNCH | PLAY | WAIT | RESULT
    level: 0,              // current opponent index
    roundStartTime: 0,
    lastRating: null,
    lastResult: null
};

// ---------------- Three.js core ----------------
let scene, camera, renderer, arenaMesh, barrierMesh;
let playerGroups = null, enemyGroups = null;
let previewGroups = null;
let particles = [], flashMeshes = [], objects = [];
let trailBuffers = [[], []];
let shakeIntensity = 0, cameraZoomOffset = 0;
let timeScale = 1.0, timeScaleTarget = 1.0;
let arenaTilt = { x: 0, z: 0 }, tiltStamina = 100, tiltActive = false;
let faceTexture = null;

function initThreeJS() {
    const container = document.getElementById('game-canvas');
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050510, 0.012);
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 85, 120);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, Save.data.settings.fx ? 2 : 1.25));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x404040, 1.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 30, 10); scene.add(dirLight);
    const rimLight = new THREE.PointLight(0x00f3ff, 0.6, 150);
    rimLight.position.set(0, 40, 0); scene.add(rimLight);

    // Bowl arena
    const bowlGeo = new THREE.SphereGeometry(BOWL_RADIUS, 64, 32, 0, Math.PI * 2, 0, 0.35);
    const bowlMat = new THREE.MeshPhongMaterial({ color: 0x111116, emissive: 0x050510, specular: 0x444444, shininess: 40, side: THREE.DoubleSide });
    arenaMesh = new THREE.Mesh(bowlGeo, bowlMat);
    arenaMesh.rotation.x = Math.PI;
    arenaMesh.position.y = BOWL_RADIUS - 2.0;
    scene.add(arenaMesh);

    const grid = new THREE.PolarGridHelper(ARENA_RADIUS, 16, 8, 64, 0x00f3ff, 0x222232);
    grid.position.y = 0.1; scene.add(grid);

    const wallGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 8, 64, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    barrierMesh = new THREE.Mesh(wallGeo, wallMat);
    barrierMesh.position.y = 4.0;
    scene.add(barrierMesh);

    const ringGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.3, 16, 100);
    scene.add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x00f3ff })).rotateX(Math.PI / 2).translateY(8));
}

// ---------------- Top mesh construction ----------------
function makeBladeShape(blade) {
    const shape = new THREE.Shape();
    const R = blade.radius;
    if (!blade.sides) {
        shape.absarc(0, 0, R, 0, Math.PI * 2, false);
        return shape;
    }
    const n = blade.sides * 2;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = (i % 2 === 0) ? R : R * (1 - blade.spikiness);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
}

// Free GPU resources of a removed group (face texture is shared and kept alive)
function disposeGroup(root) {
    root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
    });
}

function createGroupStructure() {
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    const spin = new THREE.Group();
    root.add(tilt); tilt.add(spin);
    return { root, tilt, spin };
}

// Build a full top mesh from a parts build.
// opts: { color: hexString|number, texture: THREE.Texture|null }
function buildTopMesh(build, opts) {
    const stats = computeStats(build);
    const groups = createGroupStructure();
    const g = groups.spin;
    const color = new THREE.Color(opts.color);

    // --- tip ---
    const tipDef = stats.tip;
    let tipMesh;
    const tipMat = new THREE.MeshStandardMaterial({ color: tipDef.id === 'rubber' ? 0xcc4422 : 0x888899, metalness: 0.6, roughness: 0.35 });
    if (tipDef.shape === 'needle') tipMesh = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 16), tipMat);
    else if (tipDef.shape === 'ball') tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), tipMat);
    else if (tipDef.shape === 'flat') tipMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 20), tipMat);
    else tipMesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 16), tipMat);
    if (tipDef.shape === 'needle') tipMesh.rotation.x = Math.PI;
    tipMesh.position.y = 0.45;
    g.add(tipMesh);

    // --- base column ---
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 0.7, 1.0, 24),
        new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.7, roughness: 0.3 })
    );
    base.position.y = 1.2; g.add(base);

    // --- weight ring ---
    const wTube = stats.weight.id === 'light' ? 0.32 : stats.weight.id === 'std' ? 0.48 : 0.68;
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(stats.radius * 0.52, wTube, 12, 48),
        new THREE.MeshStandardMaterial({ color: 0xbb9944, metalness: 0.9, roughness: 0.25, emissive: 0x332200, emissiveIntensity: 0.3 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.75; g.add(ring);

    // --- blade layer ---
    const bladeShape = makeBladeShape(stats.blade);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { steps: 1, depth: 1.2, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.22, bevelSegments: 2 });
    bladeGeo.center();
    const bladeMesh = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({
        color: color, metalness: 0.55, roughness: 0.2,
        emissive: color, emissiveIntensity: 0.55
    }));
    bladeMesh.rotation.x = Math.PI / 2;
    bladeMesh.position.y = 2.3;
    g.add(bladeMesh);

    // --- face plate with player art ---
    if (opts.texture) {
        const faceR = stats.radius * 0.6;
        const faceGeo = new THREE.CylinderGeometry(faceR, faceR, 0.35, 48);
        const pos = faceGeo.attributes.position, uv = faceGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            if (Math.abs(pos.getY(i)) > 0.16) {
                uv.setXY(i, (pos.getX(i) / (faceR * 2)) + 0.5, (pos.getZ(i) / (faceR * 2)) + 0.5);
            }
        }
        const sideMat = new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.6, roughness: 0.3 });
        const faceMat = new THREE.MeshStandardMaterial({
            map: opts.texture, transparent: true, alphaTest: 0.05,
            emissive: 0xffffff, emissiveMap: opts.texture, emissiveIntensity: 0.5,
            color: 0x333340
        });
        const face = new THREE.Mesh(faceGeo, [sideMat, faceMat, faceMat]);
        face.position.y = 3.15;
        face.rotation.y = Math.PI;
        g.add(face);
    } else {
        // enemy core glow disc
        const core = new THREE.Mesh(
            new THREE.CylinderGeometry(stats.radius * 0.4, stats.radius * 0.4, 0.3, 32),
            new THREE.MeshStandardMaterial({ color: 0x111118, emissive: opts.color, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.2 })
        );
        core.position.y = 3.1; g.add(core);
    }
    groups.stats = stats;
    return groups;
}

function getFaceTexture() {
    if (!faceTexture) {
        faceTexture = new THREE.CanvasTexture(document.getElementById('draw-canvas'));
        faceTexture.minFilter = THREE.LinearFilter;
        faceTexture.magFilter = THREE.LinearFilter;
    }
    faceTexture.needsUpdate = true;
    return faceTexture;
}

function buildPlayerGroups() {
    return buildTopMesh(Save.data.build, { color: Save.data.color, texture: getFaceTexture() });
}

// ---------------- Paint (top face art) ----------------
const Paint = {
    canvas: null, ctx: null,
    color: '#00f3ff', tool: 'pen', brush: 10,
    drawing: false, lastX: 0, lastY: 0,

    init: function() {
        this.canvas = document.getElementById('draw-canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = this.brush; this.ctx.strokeStyle = this.color;
        this.color = Save.data.color;

        const d = this.canvas;
        d.addEventListener('mousedown', e => this.start(e));
        d.addEventListener('mousemove', e => this.move(e));
        d.addEventListener('mouseup', () => this.stop());
        d.addEventListener('mouseout', () => this.stop());
        d.addEventListener('touchstart', e => { e.preventDefault(); this.start(e.touches[0]); }, { passive: false });
        d.addEventListener('touchmove', e => { e.preventDefault(); this.move(e.touches[0]); }, { passive: false });
        d.addEventListener('touchend', () => this.stop());

        if (Save.data.drawing) {
            const img = new Image();
            img.onload = () => { this.ctx.drawImage(img, 0, 0); this.refresh(); };
            img.src = Save.data.drawing;
        } else {
            this.drawDefault();
        }
    },

    drawDefault: function() {
        const c = this.ctx;
        c.save();
        c.clearRect(0, 0, 300, 300);
        c.strokeStyle = this.color; c.lineWidth = 14; c.globalCompositeOperation = 'source-over';
        c.beginPath(); c.arc(150, 150, 92, 0, Math.PI * 2); c.stroke();
        c.lineWidth = 10;
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 - Math.PI / 2;
            c.beginPath();
            c.moveTo(150 + Math.cos(a) * 25, 150 + Math.sin(a) * 25);
            c.lineTo(150 + Math.cos(a) * 80, 150 + Math.sin(a) * 80);
            c.stroke();
        }
        c.fillStyle = this.color;
        c.beginPath(); c.arc(150, 150, 18, 0, Math.PI * 2); c.fill();
        c.restore();
        this.applyToolState();
    },

    getPos: function(e) {
        const r = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
        return { x: Math.floor((e.clientX - r.left) * sx), y: Math.floor((e.clientY - r.top) * sy) };
    },

    start: function(e) {
        const p = this.getPos(e);
        if (this.tool === 'fill') { this.floodFill(p.x, p.y, this.color); this.refresh(); return; }
        this.drawing = true; this.lastX = p.x; this.lastY = p.y;
        this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); this.ctx.lineTo(p.x, p.y); this.ctx.stroke();
    },
    move: function(e) {
        if (!this.drawing || this.tool === 'fill') return;
        const p = this.getPos(e);
        this.ctx.beginPath(); this.ctx.moveTo(this.lastX, this.lastY); this.ctx.lineTo(p.x, p.y); this.ctx.stroke();
        this.lastX = p.x; this.lastY = p.y;
    },
    stop: function() {
        if (this.drawing) { this.drawing = false; this.refresh(); }
    },

    refresh: function() {
        Save.data.drawing = this.canvas.toDataURL('image/png');
        Save.write();
        if (faceTexture) faceTexture.needsUpdate = true;
    },

    clearCanvas: function() {
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.clearRect(0, 0, 300, 300);
        this.ctx.restore();
        this.applyToolState();
        this.refresh();
    },

    setColor: function(hex, el) {
        this.color = hex;
        Save.data.color = hex; Save.write();
        if (this.tool === 'pen') this.ctx.strokeStyle = hex;
        document.querySelectorAll('.color-swatch').forEach(c => c.classList.remove('active'));
        if (el) el.classList.add('active');
        UI.refreshPreview();
    },
    setTool: function(tool) {
        this.tool = tool;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('tool-' + tool);
        if (btn) btn.classList.add('active');
        this.applyToolState();
    },
    applyToolState: function() {
        if (this.tool === 'eraser') this.ctx.globalCompositeOperation = 'destination-out';
        else { this.ctx.globalCompositeOperation = 'source-over'; this.ctx.strokeStyle = this.color; }
        this.ctx.lineWidth = this.brush;
    },
    setBrush: function(val) {
        this.brush = parseInt(val);
        document.getElementById('brush-size-val').innerText = val;
        this.ctx.lineWidth = this.brush;
    },

    floodFill: function(startX, startY, fillColor) {
        const width = 300, height = 300;
        const imgData = this.ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const bigint = parseInt(fillColor.slice(1), 16);
        const fr = (bigint >> 16) & 255, fg = (bigint >> 8) & 255, fb = bigint & 255;
        const getPx = (x, y) => (y * width + x) * 4;
        const startIdx = getPx(startX, startY);
        const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
        if (sr === fr && sg === fg && sb === fb && sa === 255) return;
        const match = (idx) =>
            Math.abs(data[idx] - sr) + Math.abs(data[idx + 1] - sg) + Math.abs(data[idx + 2] - sb) + Math.abs(data[idx + 3] - sa) < 50;
        const stack = [[startX, startY]];
        while (stack.length) {
            const [x, y] = stack.pop();
            const idx = getPx(x, y);
            if (match(idx)) {
                data[idx] = fr; data[idx + 1] = fg; data[idx + 2] = fb; data[idx + 3] = 255;
                if (x > 0) stack.push([x - 1, y]);
                if (x < width - 1) stack.push([x + 1, y]);
                if (y > 0) stack.push([x, y - 1]);
                if (y < height - 1) stack.push([x, y + 1]);
            }
        }
        this.ctx.putImageData(imgData, 0, 0);
    }
};

// ---------------- UI manager ----------------
const UI = {
    switchScreen: function(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('launch-overlay').classList.add('hidden');
        document.getElementById('boost-btn').classList.add('hidden');
        document.getElementById('tilt-indicator').style.display = 'none';
        AudioSys.stopSpinHum();
        if (id) document.getElementById(id).classList.remove('hidden');
    },

    goHome: function() {
        state.screen = 'HOME';
        this.switchScreen('screen-home');
        this.clearBattleMeshes();
        this.showPreview();
        this.refreshHome();
    },

    refreshHome: function() {
        const s = Save.data;
        const st = computeStats(s.build);
        document.getElementById('home-stats').innerHTML =
            `勝 ${s.wins}　敗 ${s.losses}　連勝 ${s.streak}<br>目前戰鬥力 <span style="color:var(--gold)">${st.cp}</span>　完美發射 ${s.perfects} 次`;
        document.getElementById('home-coins').innerText = '🪙 ' + s.coins;
    },

    goGarage: function() {
        state.screen = 'GARAGE';
        this.switchScreen('screen-garage');
        this.clearBattleMeshes();
        this.renderGarage();
        this.showPreview();
    },

    garageTab: function(tab) {
        document.getElementById('tab-parts').classList.toggle('active', tab === 'parts');
        document.getElementById('tab-paint').classList.toggle('active', tab === 'paint');
        document.getElementById('garage-parts').classList.toggle('hidden', tab !== 'parts');
        document.getElementById('garage-paint').classList.toggle('hidden', tab !== 'paint');
    },

    renderGarage: function() {
        document.getElementById('garage-coins').innerText = '🪙 ' + Save.data.coins;
        ['blade', 'weight', 'tip'].forEach(cat => {
            const row = document.getElementById('row-' + cat);
            row.innerHTML = '';
            PARTS[cat].forEach(p => {
                const unlocked = Save.data.unlocked[cat].includes(p.id);
                const active = Save.data.build[cat] === p.id;
                const card = document.createElement('div');
                card.className = 'part-card' + (active ? ' active' : '') + (unlocked ? '' : ' locked');
                const icon = cat === 'blade' ? PartIcons.blade(p, active ? '#00f3ff' : '#8899aa')
                    : cat === 'weight' ? PartIcons.weight(p) : PartIcons.tip(p);
                card.innerHTML = icon +
                    `<div class="part-name">${p.name}</div><div class="part-tag">${p.tag}</div>` +
                    (unlocked ? '' : `<div class="part-price">🪙 ${p.price}</div><div class="part-lock">🔒</div>`);
                card.title = p.desc;
                card.onclick = () => UI.selectPart(cat, p);
                row.appendChild(card);
            });
        });
        this.renderStats();
    },

    selectPart: function(cat, p) {
        const s = Save.data;
        if (!s.unlocked[cat].includes(p.id)) {
            if (s.coins >= p.price) {
                s.coins -= p.price;
                s.unlocked[cat].push(p.id);
                s.build[cat] = p.id;
                Save.write();
                AudioSys.playUnlock(); Haptics.win();
                showMsg('解鎖 ' + p.name + '!', 1200, 'var(--gold)');
            } else {
                AudioSys.playDeny();
                showMsg('金幣不足 (需要 🪙' + p.price + ')', 1200, 'var(--secondary)');
                return;
            }
        } else {
            s.build[cat] = p.id;
            Save.write();
            AudioSys.playClick(); Haptics.tap();
        }
        this.renderGarage();
        this.refreshPreview();
    },

    renderStats: function() {
        const st = computeStats(Save.data.build);
        [['atk', st.atk], ['def', st.def], ['sta', st.sta], ['spd', st.spd]].forEach(([k, v]) => {
            document.getElementById('sb-' + k).style.width = v + '%';
            document.getElementById('sn-' + k).innerText = v;
        });
        document.getElementById('garage-cp').innerText = st.cp;
    },

    // ----- 3D preview -----
    showPreview: function() {
        this.clearPreview();
        previewGroups = buildPlayerGroups();
        previewGroups.root.position.set(0, 6, 0);
        scene.add(previewGroups.root);
    },
    refreshPreview: function() {
        if (state.screen === 'GARAGE' || state.screen === 'HOME') this.showPreview();
    },
    clearPreview: function() {
        if (previewGroups) { scene.remove(previewGroups.root); disposeGroup(previewGroups.root); previewGroups = null; }
    },
    clearBattleMeshes: function() {
        if (playerGroups) { scene.remove(playerGroups.root); disposeGroup(playerGroups.root); playerGroups = null; }
        if (enemyGroups) { scene.remove(enemyGroups.root); disposeGroup(enemyGroups.root); enemyGroups = null; }
        objects = [];
    },

    // ----- Level select -----
    goLevels: function() {
        if (!Save.data.tutorialDone) { this.startTutorial(); return; }
        state.screen = 'LEVELS';
        this.switchScreen('screen-levels');
        this.clearBattleMeshes();
        this.showPreview();
        document.getElementById('levels-coins').innerText = '🪙 ' + Save.data.coins;
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';
        OPPONENTS.forEach((op, idx) => {
            const cleared = Save.data.cleared.includes(idx);
            const locked = idx > 0 && !Save.data.cleared.includes(idx - 1);
            const st = computeStats(op.build);
            const cp = Math.floor(st.cp * op.mult);
            const card = document.createElement('div');
            card.className = 'level-card' + (cleared ? ' cleared' : '') + (locked ? ' locked' : '') + (op.boss ? ' boss' : '');
            card.innerHTML =
                `<div class="lv-num">LEVEL ${idx + 1}</div>` +
                `<div class="lv-name">${op.name}</div>` +
                `<div class="lv-desc">${op.desc}</div>` +
                `<div class="lv-cp">CP ${cp}</div>` +
                (cleared ? '<div class="lv-clear">✅</div>' : locked ? '<div class="lv-clear">🔒</div>' : '');
            card.onclick = () => { AudioSys.playClick(); Battle.goLaunch(idx); };
            grid.appendChild(card);
        });
    },

    // ----- Settings -----
    openSettings: function() {
        const s = Save.data.settings;
        document.getElementById('tg-sound').classList.toggle('on', s.sound);
        document.getElementById('tg-music').classList.toggle('on', s.music);
        document.getElementById('tg-haptics').classList.toggle('on', s.haptics);
        document.getElementById('tg-fx').classList.toggle('on', s.fx);
        const d = Save.data;
        const rate = d.launches > 0 ? Math.round(d.perfects / d.launches * 100) : 0;
        document.getElementById('settings-stats').innerHTML =
            `總對戰 ${d.wins + d.losses} 場｜勝率 ${(d.wins + d.losses) > 0 ? Math.round(d.wins / (d.wins + d.losses) * 100) : 0}%<br>` +
            `最佳連勝 ${d.bestStreak}｜完美發射率 ${rate}%`;
        document.getElementById('modal-settings').classList.remove('hidden');
    },
    closeSettings: function() { document.getElementById('modal-settings').classList.add('hidden'); },
    toggleSetting: function(key, el) {
        const s = Save.data.settings;
        s[key] = !s[key];
        el.classList.toggle('on', s[key]);
        Save.write();
        if (key === 'sound') AudioSys.enabled = s.sound;
        if (key === 'music') {
            AudioSys.musicEnabled = s.music;
            if (s.music) AudioSys.startMusic(); else AudioSys.stopMusic();
        }
        if (key === 'haptics') Haptics.enabled = s.haptics;
        if (key === 'fx') renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.fx ? 2 : 1.25));
        AudioSys.playClick();
    },

    // ----- Tutorial -----
    tutorialPage: 0,
    tutorialPages: [
        {
            title: '🔧 打造你的陀螺',
            body: '在<b>工坊</b>組合三種零件：<br>• <b>刃盤</b> — 決定攻擊力與形狀<br>• <b>配重環</b> — 決定重量與慣性<br>• <b>軸尖</b> — 決定移動方式與續航<br><br>贏得對戰賺取 <span class="em">🪙 金幣</span>，解鎖更強零件！還可以在塗裝區畫出專屬圖案。'
        },
        {
            title: '🚀 發射的技術',
            body: '發射不是隨便拉！<br><br>1. 按住發射器<b>往下拉</b> — 拉越長力道越大<br>2. 左右移動<b>瞄準</b>進場角度<br>3. 把力道拉進<span class="em">綠色甜蜜區</span>，並在最後<b>快速甩開手指</b><br><br>甜蜜區＋快甩 = <span class="em">PERFECT 發射</span>（+15% 轉速）。拉過頭會暴衝失控！多練習就會越來越準。'
        },
        {
            title: '⚔️ 戰鬥技巧',
            body: '對戰中你不是觀眾：<br><br>• <b>拖曳場地</b> — 傾斜整個戰鬥碗，操控走位<br>• <b>⚡ 爆發鍵</b> — 3 次衝刺機會，抓準時機撞擊！<br>• 注意<span class="em">橘色爆裂條</span> — 被打滿會直接<b>爆裂敗北</b><br><br>讓對手轉速歸零、撞出場外、或打爆對方就獲勝！'
        }
    ],
    startTutorial: function() {
        this.tutorialPage = 0;
        this.renderTutorial();
        document.getElementById('modal-tutorial').classList.remove('hidden');
    },
    renderTutorial: function() {
        const p = this.tutorialPages[this.tutorialPage];
        document.getElementById('tut-title').innerText = p.title;
        document.getElementById('tut-body').innerHTML = p.body;
        document.getElementById('tut-btn').innerText = this.tutorialPage < this.tutorialPages.length - 1 ? '下一步' : '開始戰鬥！';
    },
    tutorialNext: function() {
        AudioSys.playClick();
        this.tutorialPage++;
        if (this.tutorialPage >= this.tutorialPages.length) {
            document.getElementById('modal-tutorial').classList.add('hidden');
            Save.data.tutorialDone = true;
            Save.write();
            this.goLevels();
            return;
        }
        this.renderTutorial();
    }
};

// ---------------- Launch system (skill-based) ----------------
const Launch = {
    charging: false,
    startX: 0, startY: 0,
    power: 0, angle: 0,
    overPulled: false,
    samples: [],
    MAX_PULL: 250,
    SWEET_LO: 0.78, SWEET_HI: 0.95,

    setup: function() {
        const handle = document.getElementById('launch-handle-zone');
        const arrow = document.getElementById('launch-arrow');
        const pmFill = document.getElementById('pm-fill');
        const cord = document.getElementById('ripcord-line');

        const start = (e) => {
            if (state.screen !== 'LAUNCH') return;
            this.charging = true;
            const t = e.touches ? e.touches[0] : e;
            this.startX = t.clientX; this.startY = t.clientY;
            this.power = 0; this.angle = 0; this.overPulled = false;
            this.samples = [{ y: t.clientY, t: performance.now() }];
            arrow.style.opacity = '0.85';
            cord.style.opacity = '0.8';
            AudioSys.init();
            Haptics.tap();
        };
        const move = (e) => {
            if (!this.charging) return;
            e.preventDefault();
            const t = e.touches ? e.touches[0] : e;
            const now = performance.now();
            this.samples.push({ y: t.clientY, t: now });
            if (this.samples.length > 24) this.samples.shift();

            const dy = Math.max(0, t.clientY - this.startY);
            const dx = t.clientX - this.startX;
            this.power = dy / this.MAX_PULL;
            this.overPulled = this.power > 1.02;
            this.angle = Math.max(-1.1, Math.min(1.1, dx / 150));

            handle.style.transform = `translateY(${Math.min(dy * 0.55, 160)}px) scale(${1 + Math.min(this.power, 1) * 0.18})`;
            cord.style.height = Math.min(dy * 0.55, 160) + 'px';
            cord.style.transform = `translateX(-50%) translateY(${Math.min(dy * 0.55, 160)}px) scaleY(-1)`;
            arrow.style.transform = `translateX(-50%) rotate(${this.angle * 40}deg)`;
            arrow.style.height = `${40 + Math.min(this.power, 1) * 70}px`;

            pmFill.style.height = Math.min(this.power * 100, 100) + '%';
            pmFill.classList.toggle('over', this.overPulled);
            if (Math.random() > 0.85) AudioSys.playCharge(Math.min(this.power, 1) * 100);
        };
        const end = () => {
            if (!this.charging) return;
            this.charging = false;
            handle.style.transform = 'translateY(0) scale(1)';
            cord.style.opacity = '0'; cord.style.height = '0';
            arrow.style.opacity = '0';
            pmFill.style.height = '0%';
            this.release();
        };

        handle.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        handle.addEventListener('touchstart', start, { passive: false });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', end);
    },

    // Flick speed: px/ms over the last ~90ms of the gesture
    flickSpeed: function() {
        const s = this.samples;
        if (s.length < 2) return 0;
        const endT = s[s.length - 1].t;
        let i = s.length - 2;
        while (i > 0 && endT - s[i].t < 90) i--;
        const dt = endT - s[i].t;
        if (dt <= 0) return 0;
        return (s[s.length - 1].y - s[i].y) / dt;
    },

    release: function() {
        if (this.power < 0.18) return; // too short: cancel, no launch

        const flick = Math.max(0, Math.min(this.flickSpeed() / 2.2, 1)); // 0-1
        const inSweet = this.power >= this.SWEET_LO && this.power <= this.SWEET_HI;
        let rating, bonus = 1.0, angleError = 0, color;

        if (this.overPulled) {
            rating = 'OVERPOWER!'; color = '#ff5522';
            bonus = 0.95;
            angleError = (Math.random() - 0.5) * 0.32; // wild launch
        } else if (inSweet && flick > 0.5) {
            rating = 'PERFECT!'; color = '#ffdd00';
            bonus = 1.15;
            Save.data.perfects++;
            AudioSys.playPerfect();
        } else if (inSweet) {
            rating = 'GREAT!'; color = '#00ff88';
            bonus = 1.08;
        } else if (this.power > 0.5) {
            rating = 'GOOD'; color = '#00f3ff';
            bonus = 1.0;
        } else {
            rating = 'WEAK...'; color = '#8899aa';
            bonus = 0.9;
        }

        Save.data.launches++;
        Save.write();
        state.lastRating = rating;

        const effPower = Math.min(this.power, 1);
        const ratingEl = document.getElementById('rating-overlay');
        ratingEl.innerText = rating;
        ratingEl.style.color = color;
        ratingEl.style.textShadow = `0 0 20px ${color}`;
        ratingEl.classList.remove('show');
        void ratingEl.offsetWidth;
        ratingEl.classList.add('show');

        Haptics.launch();
        Battle.startRound(effPower, this.angle * 0.55 + angleError, bonus, flick);
    }
};

// ---------------- Battle ----------------
const Battle = {
    boostCharges: 3,
    boostCooldown: 0,
    reward: 0,

    goLaunch: function(levelIdx) {
        state.level = levelIdx;
        state.screen = 'LAUNCH';
        UI.switchScreen(null);
        UI.clearPreview();
        UI.clearBattleMeshes();

        const op = OPPONENTS[levelIdx];
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('hud-enemy-name').innerText = op.name;
        document.getElementById('spin-bar-p').style.width = '100%';
        document.getElementById('spin-bar-e').style.width = '100%';
        document.getElementById('burst-bar-p').style.width = '0%';
        document.getElementById('burst-bar-e').style.width = '0%';
        document.getElementById('launch-overlay').classList.remove('hidden');

        // Build meshes
        playerGroups = buildPlayerGroups();
        enemyGroups = buildTopMesh(op.build, { color: op.color });
        scene.add(playerGroups.root); scene.add(enemyGroups.root);
        playerGroups.root.position.set(0, 9, 24);
        enemyGroups.root.position.set(0, 9, -24);

        barrierMesh.material.opacity = 0.3;
        AudioSys.startMusic();
        showMsg('READY', 900, 'white');
    },

    startRound: function(power, angle, spinBonus, flick) {
        const op = OPPONENTS[state.level];
        document.getElementById('launch-overlay').classList.add('hidden');
        document.getElementById('boost-btn').classList.remove('hidden');
        document.getElementById('tilt-indicator').style.display = 'block';
        showMsg('GO SHOOT!', 800, 'var(--primary)');
        AudioSys.playGo();

        state.screen = 'PLAY';
        state.roundStartTime = Date.now();
        objects = [];
        trailBuffers = [[], []];
        timeScale = 1.0; timeScaleTarget = 1.0;
        shakeIntensity = 0; cameraZoomOffset = 0;
        tiltStamina = 100; tiltActive = false;
        arenaTilt.x = 0; arenaTilt.z = 0;
        this.boostCharges = 3; this.boostCooldown = 0;
        this.updateBoostUI();

        scene.children.slice().forEach(c => { if (c.userData.isTrail) scene.remove(c); });

        const pStats = playerGroups.stats;
        const startDist = 22;
        const effPower = Math.max(0.4, power);
        const spdFactor = 0.8 + (pStats.spd / 100) * 0.5;
        const launchSpeed = (0.45 + effPower * 0.42) * spdFactor + flick * 0.1;

        // Player launches from the bottom of the screen (+z) toward the enemy (-z)
        objects.push({
            groups: playerGroups, x: angle * 8, z: startDist,
            vx: launchSpeed * Math.sin(angle), vz: -launchSpeed * Math.cos(angle),
            mass: pStats.mass, radius: pStats.radius,
            friction: pStats.friction,
            atk: pStats.atk, def: pStats.def, spd: pStats.spd,
            tip: pStats.tip,
            burst: 0, burstMax: 100,
            isPlayer: true,
            spin: MAX_SPIN * (0.55 + effPower * 0.45) * spinBonus,
            precessionAngle: 0, nutation: 0
        });

        // Enemy scaled by level multiplier
        const eBase = computeStats(op.build);
        const m = op.mult;
        let eSta = Math.min(eBase.sta * m, 108);
        if (op.boss) eSta = Math.max(eSta, 68); // bosses never run dry early
        objects.push({
            groups: enemyGroups, x: 0, z: -startDist, vx: 0, vz: 0.62,
            mass: eBase.mass * Math.sqrt(m), radius: eBase.radius,
            friction: 0.9972 + (eSta / 100) * 0.0022,
            atk: Math.min(eBase.atk * m, 110), def: Math.min(eBase.def * m, 110), spd: Math.min(eBase.spd * m, 110),
            tip: eBase.tip,
            burst: 0, burstMax: 100,
            isPlayer: false,
            spin: -MAX_SPIN * Math.min(0.7 + 0.28 * m, 1.08),
            moveSpeed: 0.028 + (eBase.spd * m / 100) * 0.028,
            precessionAngle: 0, nutation: 0,
            aiType: op.ai, aiBurstCooldown: 0
        });

        camera.position.set(0, 85, 120);
        camera.lookAt(0, 0, 0);
    },

    useBoost: function() {
        if (state.screen !== 'PLAY' || this.boostCharges <= 0 || this.boostCooldown > 0) return;
        const p = objects[0], e = objects[1];
        if (!p || !e) return;
        this.boostCharges--;
        this.boostCooldown = 50;
        const dx = e.x - p.x, dz = e.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        const force = 1.05 + (p.spd / 100) * 0.75;
        p.vx += (dx / d) * force;
        p.vz += (dz / d) * force;
        p.spin *= 0.975; // costs a little spin
        AudioSys.playBoost();
        Haptics.buzz([10, 20, 30]);
        createSparks(p.x - (dx / d) * p.radius, p.z - (dz / d) * p.radius, 10, 0xffaa00);
        this.updateBoostUI();
    },

    updateBoostUI: function() {
        const btn = document.getElementById('boost-btn');
        document.getElementById('boost-charges').innerText = '●'.repeat(this.boostCharges) + '○'.repeat(3 - this.boostCharges);
        btn.classList.toggle('empty', this.boostCharges <= 0);
        btn.classList.toggle('cooldown', this.boostCooldown > 0);
    },

    retry: function() { AudioSys.playClick(); this.goLaunch(state.level); },
    nextLevel: function() { AudioSys.playClick(); this.goLaunch(Math.min(state.level + 1, OPPONENTS.length - 1)); },

    roundOver: function(result, type) {
        if (state.screen === 'WAIT') return;
        state.screen = 'WAIT';
        AudioSys.stopSpinHum();
        const s = Save.data;
        let subText = '';
        if (type === 'SPIN') subText = result === 'WIN' ? '對手停止旋轉 — Spin Finish' : '轉速耗盡 — Spin Finish';
        else if (type === 'RING') subText = result === 'WIN' ? '擊飛對手 — Over Finish' : '被擊出場外 — Over Finish';
        else subText = result === 'WIN' ? '打爆對手 — Burst Finish!' : '陀螺爆裂 — Burst Finish';

        const battleSecs = Math.floor((Date.now() - state.roundStartTime) / 1000);
        let reward = 0;
        if (result === 'WIN') {
            showMsg('VICTORY', 1600, 'var(--primary)');
            AudioSys.playWin(); Haptics.win();
            createConfetti();
            s.wins++; s.streak++;
            if (s.streak > s.bestStreak) s.bestStreak = s.streak;
            reward = 60 + state.level * 30;
            if (type === 'BURST') reward += 40;
            if (!s.cleared.includes(state.level)) {
                s.cleared.push(state.level);
                reward += 150; // first-clear bonus
            }
            if (s.streak >= 3) reward = Math.floor(reward * 1.2);
        } else {
            showMsg('DEFEAT', 1600, 'var(--secondary)');
            AudioSys.playLose(); Haptics.buzz([80]);
            s.losses++; s.streak = 0;
            reward = 15;
        }
        s.coins += reward;
        this.reward = reward;
        Save.write();

        state.lastResult = { result, subText, battleSecs, firstClear: result === 'WIN' && reward >= 150 };
        setTimeout(() => this.showResult(), 2100);
    },

    showResult: function() {
        state.screen = 'RESULT';
        const r = state.lastResult;
        UI.switchScreen('screen-result');
        const title = document.getElementById('result-title');
        if (r.result === 'WIN') { title.innerText = 'VICTORY'; title.style.color = 'var(--primary)'; title.style.textShadow = '0 0 20px var(--primary)'; }
        else { title.innerText = 'DEFEAT'; title.style.color = 'var(--secondary)'; title.style.textShadow = '0 0 20px var(--secondary)'; }
        document.getElementById('result-sub').innerText = r.subText;
        document.getElementById('result-reward').innerHTML = `+🪙 ${this.reward}` + (r.firstClear ? ' <span style="font-size:0.7rem">(含首勝獎勵)</span>' : '');
        const s = Save.data;
        document.getElementById('result-stats').innerHTML =
            `發射評價 ${state.lastRating || '--'}｜對戰 ${r.battleSecs}s<br>勝 ${s.wins}｜連勝 ${s.streak}｜🪙 ${s.coins}`;
        const nextBtn = document.getElementById('result-next-btn');
        const hasNext = r.result === 'WIN' && state.level < OPPONENTS.length - 1;
        nextBtn.style.display = hasNext ? '' : 'none';
        AudioSys.playCoin();
    }
};

// ---------------- Arena tilt control ----------------
function setupArenaTiltControls() {
    const canvas = document.getElementById('game-canvas');
    let tiltTouchActive = false;
    const onStart = () => { if (state.screen === 'PLAY') tiltTouchActive = true; };
    const onMove = (e) => {
        if (state.screen !== 'PLAY' || !tiltTouchActive) return;
        if (tiltStamina <= 0) { arenaTilt.x = 0; arenaTilt.z = 0; return; }
        const touch = e.touches ? e.touches[0] : e;
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const maxTilt = 0.006;
        arenaTilt.x = ((touch.clientY - cy) / cy) * maxTilt;
        arenaTilt.z = ((touch.clientX - cx) / cx) * maxTilt;
        tiltActive = true;
    };
    const onEnd = () => { tiltTouchActive = false; tiltActive = false; arenaTilt.x = 0; arenaTilt.z = 0; };
    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: true });
    canvas.addEventListener('touchend', onEnd);
}

// ---------------- Physics ----------------
function getArenaHeight(x, z) {
    const distSq = x * x + z * z;
    if (distSq >= BOWL_RADIUS * BOWL_RADIUS) return BOWL_RADIUS;
    return BOWL_RADIUS - Math.sqrt(BOWL_RADIUS * BOWL_RADIUS - distSq);
}

function physicsStep(frameScale) {
    if (state.screen !== 'PLAY') return;

    timeScale += (timeScaleTarget - timeScale) * 0.05;
    const ts = timeScale * frameScale;

    const timeElapsed = Date.now() - state.roundStartTime;
    const safetyPhase = timeElapsed < 1500;
    barrierMesh.material.opacity = safetyPhase ? 0.3 : 0.05;

    // Boost cooldown
    if (Battle.boostCooldown > 0) {
        Battle.boostCooldown -= ts;
        if (Battle.boostCooldown <= 0) Battle.updateBoostUI();
    }

    // Tilt stamina
    if (tiltActive && tiltStamina > 0) tiltStamina = Math.max(0, tiltStamina - 0.6 * ts);
    else if (!tiltActive && tiltStamina < 100) tiltStamina = Math.min(100, tiltStamina + 0.25 * ts);
    if (tiltStamina <= 0) { arenaTilt.x = 0; arenaTilt.z = 0; }

    const tiltDot = document.getElementById('tilt-dot');
    const tiltRing = document.getElementById('tilt-stamina-ring');
    if (tiltDot) {
        const maxOff = 20;
        tiltDot.style.left = (50 + arenaTilt.z / 0.006 * maxOff) + '%';
        tiltDot.style.top = (50 + arenaTilt.x / 0.006 * maxOff) + '%';
    }
    if (tiltRing) tiltRing.style.opacity = tiltStamina / 100;

    const secs = Math.floor(timeElapsed / 1000);
    document.getElementById('battle-timer').innerText = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');

    const avgSpin = objects.length >= 2 ? (Math.abs(objects[0].spin) + Math.abs(objects[1].spin)) / 2 : 0;
    AudioSys.updateSpinHum(avgSpin);

    objects.forEach((obj, idx) => {
        obj.x += obj.vx * ts; obj.z += obj.vz * ts;

        // Bowl slope force toward center (tip centerBias affects how much it settles)
        const dist = Math.sqrt(obj.x * obj.x + obj.z * obj.z);
        if (dist > 0.5) {
            const bias = obj.tip.centerBias || 1.0;
            const slopeForce = (dist / BOWL_RADIUS) * 0.08 * PHYS.gravity * bias;
            obj.vx -= (obj.x / dist) * slopeForce * ts;
            obj.vz -= (obj.z / dist) * slopeForce * ts;
        }

        // Flat tip: tangential self-drive -> aggressive circling, saturating at orbit speed
        if (obj.tip.drive && dist > 3) {
            const spinDir = Math.sign(obj.spin) || 1;
            const curSpeed = Math.sqrt(obj.vx * obj.vx + obj.vz * obj.vz);
            const saturate = Math.max(0, 1 - curSpeed / 1.15);
            const driveF = obj.tip.drive * (Math.abs(obj.spin) / MAX_SPIN) * saturate;
            obj.vx += (-obj.z / dist) * driveF * spinDir * ts;
            obj.vz += (obj.x / dist) * driveF * spinDir * ts;
        }

        // Arena tilt gravity bias
        obj.vx += arenaTilt.x * ts;
        obj.vz += arenaTilt.z * ts;

        if (dist > ARENA_RADIUS * 0.85 && !safetyPhase && Math.random() > 0.95) AudioSys.playEdgeWarn();

        // Arena wall: bounces unless the OUTWARD radial speed is smash-level (rides over the rim).
        // Tangential circling along the wall never rings out.
        if (dist > (ARENA_RADIUS - 1.5)) {
            const nx = -obj.x / dist, nz = -obj.z / dist;
            const dot = obj.vx * nx + obj.vz * nz; // negative = moving outward
            if (dot < 0 && (safetyPhase || -dot < PHYS.ringOutSpeed)) {
                obj.vx -= (1 + PHYS.restitution * 0.85) * dot * nx;
                obj.vz -= (1 + PHYS.restitution * 0.85) * dot * nz;
                obj.x += nx * 0.5; obj.z += nz * 0.5;
                AudioSys.playWall();
                createSparks(obj.x + nx * 2, obj.z + nz * 2, 6, 0x00f3ff);
            }
        }

        const spinMag = Math.abs(obj.spin);
        if (spinMag < 0.05) Battle.roundOver(obj.isPlayer ? 'LOSE' : 'WIN', 'SPIN');

        // Movement friction (grip tips slow movement more)
        const speed = Math.sqrt(obj.vx * obj.vx + obj.vz * obj.vz);
        const rollingFric = (0.002 + (obj.tip.grip || 0) * 0.0012) / (spinMag + 0.1);
        const airDrag = 0.001 * speed;
        const totalDecel = (rollingFric + airDrag) * ts;
        if (speed > 0.001) {
            const factor = Math.max(0, 1 - totalDecel / speed);
            obj.vx *= factor; obj.vz *= factor;
        }
        // Global speed cap keeps the fight readable
        if (speed > PHYS.maxSpeed) {
            const capF = PHYS.maxSpeed / speed;
            obj.vx *= capF; obj.vz *= capF;
        }

        // Gyroscopic wobble
        const spinRatio = spinMag / MAX_SPIN;
        obj.precessionAngle += (0.15 / (spinRatio + 0.05)) * ts;
        const precAmp = Math.pow(1 - Math.min(spinRatio, 1), 2) * 0.7;
        let wobbleX = Math.sin(obj.precessionAngle) * precAmp;
        let wobbleZ = Math.cos(obj.precessionAngle) * precAmp;
        if (spinMag < 0.15) {
            const nutAmp = (0.15 - spinMag) * 3.0;
            obj.nutation += 0.3 * ts;
            wobbleX += Math.sin(obj.nutation * 7) * nutAmp;
            wobbleZ += Math.cos(obj.nutation * 7) * nutAmp;
        }
        if (spinMag < 0.08) {
            const toppleFactor = (0.08 - spinMag) * 15;
            wobbleX *= (1 + toppleFactor);
            wobbleZ *= (1 + toppleFactor);
        }

        const maxTiltV = 0.8;
        const targetTiltX = Math.max(-maxTiltV, Math.min(maxTiltV, obj.vz * 0.6));
        const targetTiltZ = Math.max(-maxTiltV, Math.min(maxTiltV, -obj.vx * 0.6));
        const curTiltX = targetTiltX + wobbleX;
        const curTiltZ = targetTiltZ + wobbleZ;
        const tiltMag = Math.sqrt(curTiltX * curTiltX + curTiltZ * curTiltZ);

        // Spin decay (tilt worsens it)
        const tiltFactor = 1 + tiltMag * 0.5;
        const spinDecay = 1 - (1 - obj.friction) * tiltFactor;
        obj.spin *= Math.pow(spinDecay, ts);

        // Slow-mo on finishing spiral
        if (spinMag < 0.12 && spinMag > 0.05 && timeScaleTarget === 1.0) {
            timeScaleTarget = 0.35;
            setTimeout(() => { timeScaleTarget = 1.0; }, 2500);
        }

        const floorY = getArenaHeight(obj.x, obj.z);
        const tiltLift = Math.max(0, tiltMag * obj.radius * 0.6 - 0.5);
        obj.groups.root.position.set(obj.x, floorY + tiltLift - 0.6, obj.z);
        obj.groups.spin.rotation.y -= obj.spin * ts;
        obj.groups.tilt.rotation.x = curTiltX;
        obj.groups.tilt.rotation.z = curTiltZ;

        if (trailBuffers[idx]) {
            trailBuffers[idx].push({ x: obj.x, y: floorY + 1.5, z: obj.z });
            if (trailBuffers[idx].length > 15) trailBuffers[idx].shift();
        }
    });

    // ----- Collision & AI -----
    const p = objects[0], e = objects[1];
    if (!p || !e || state.screen !== 'PLAY') return;
    const dx = p.x - e.x, dz = p.z - e.z;
    const colDist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    const hitDist = p.radius + e.radius;

    if (colDist > hitDist) {
        runEnemyAI(p, e, dx, dz, colDist, ts);
        // Grinding sparks when close
        if (colDist < hitDist * 1.3) {
            const relSurf = Math.abs(p.spin * p.radius - e.spin * e.radius);
            if (relSurf > 0.5 && Math.random() > 0.7) {
                createSparks((p.x + e.x) / 2, (p.z + e.z) / 2, 2, 0xff8800);
                AudioSys.playGrind(relSurf);
            }
        }
    } else {
        const nx = dx / colDist, nz = dz / colDist;
        const tx = -nz, tz = nx;
        const rvx = p.vx - e.vx, rvz = p.vz - e.vz;
        const impact = rvx * nx + rvz * nz;

        if (impact < 0) {
            const surfP = p.spin * p.radius, surfE = e.spin * e.radius;
            const relSurf = surfP - surfE;
            const contactFriction = 0.4;
            const tangentialImpulse = contactFriction * relSurf * Math.abs(impact) * 0.1;

            // Impulse is instantaneous (no ts) and applied once per contact:
            // full overlap separation below prevents repeated same-contact impulses.
            const impulse = -(1 + PHYS.restitution) * impact * PHYS.forceMult;
            const pRatio = e.mass / (p.mass + e.mass);
            const eRatio = p.mass / (p.mass + e.mass);
            const pResist = 1 - (p.tip.knockResist || 0);
            const eResist = 1 - (e.tip.knockResist || 0);
            // Cap per-collision velocity change so hits stay powerful but never eject wildly
            const dvCap = Math.min(1, PHYS.maxImpulseDv / (impulse * Math.max(pRatio, eRatio) + 0.001));
            const imp = impulse * dvCap;
            // Opponent's attack stat amplifies the knockback you take
            const pKnock = 1 + e.atk / 260;
            const eKnock = 1 + p.atk / 260;

            p.vx += imp * pRatio * nx * pResist * pKnock;
            p.vz += imp * pRatio * nz * pResist * pKnock;
            e.vx -= imp * eRatio * nx * eResist * eKnock;
            e.vz -= imp * eRatio * nz * eResist * eKnock;

            p.vx += tangentialImpulse * tx * pRatio;
            p.vz += tangentialImpulse * tz * pRatio;
            e.vx -= tangentialImpulse * tx * eRatio;
            e.vz -= tangentialImpulse * tz * eRatio;

            // Angular momentum transfer
            const spinTransfer = contactFriction * relSurf * 0.04 * ts;
            const pInertia = p.mass * p.radius * p.radius;
            const eInertia = e.mass * e.radius * e.radius;
            p.spin -= spinTransfer / (pInertia + 0.1);
            e.spin += spinTransfer / (eInertia + 0.1);

            // Collision spin loss: opponent's attack strips your spin, defense resists
            const impactStr = Math.abs(impact);
            const impactSat = Math.min(impactStr, 2);
            p.spin *= 1 - 0.016 * impactSat * ((e.atk + 40) / (p.def + 90));
            e.spin *= 1 - 0.016 * impactSat * ((p.atk + 40) / (e.def + 90));

            // Burst gauge: attack vs defense (defense weighs heavily — burst is the attack-type win path)
            e.burst += impactStr * ((p.atk + 25) / (e.def * 1.7 + 55)) * 11;
            p.burst += impactStr * ((e.atk + 25) / (p.def * 1.7 + 55)) * 11;
            e.burst = Math.min(e.burst, e.burstMax);
            p.burst = Math.min(p.burst, p.burstMax);

            const sparkCount = Math.min(20, Math.floor(4 + impactStr * 8));
            const sparkColor = impactStr > 1.5 ? 0xffffff : impactStr > 0.8 ? 0xffaa44 : 0xffffaa;
            createSparks((p.x + e.x) / 2, (p.z + e.z) / 2, sparkCount, sparkColor);
            createImpactFlash((p.x + e.x) / 2, (p.z + e.z) / 2, impactStr);
            AudioSys.playHit(impactStr);
            Haptics.hit(impactStr);
            triggerShake(1.5 * impactStr);
            if (impactStr > 1.0) cameraZoomOffset = -15 * Math.min(impactStr, 3);

            // Burst finish check
            if (p.burst >= p.burstMax || e.burst >= e.burstMax) {
                const burstObj = p.burst >= p.burstMax ? p : e;
                doBurstFinish(burstObj);
                return;
            }

            // Fully separate so the same contact never applies impulse twice
            const overlap = hitDist - colDist;
            if (overlap > 0) {
                const sep = overlap * 0.5 + 0.06;
                p.x += nx * sep; p.z += nz * sep;
                e.x -= nx * sep; e.z -= nz * sep;
            }
        }
    }

    // HUD bars
    updateHudBars(p, e);

    // Arena tilt visual
    if (arenaMesh) arenaMesh.rotation.z += (arenaTilt.z * 8 - arenaMesh.rotation.z) * 0.1;

    // Ring out
    if (!safetyPhase) {
        const limit = ARENA_RADIUS + 4;
        if (Math.sqrt(p.x * p.x + p.z * p.z) > limit) Battle.roundOver('LOSE', 'RING');
        else if (Math.sqrt(e.x * e.x + e.z * e.z) > limit) Battle.roundOver('WIN', 'RING');
    }
}

function runEnemyAI(p, e, dx, dz, colDist, ts) {
    const eSpin = Math.abs(e.spin), pSpin = Math.abs(p.spin);
    const aiForce = e.moveSpeed * 0.7 * (eSpin / MAX_SPIN) * ts;
    if (e.aiBurstCooldown > 0) e.aiBurstCooldown -= ts;

    switch (e.aiType) {
        case 'aggressive':
            e.vx += (dx / colDist) * aiForce;
            e.vz += (dz / colDist) * aiForce;
            break;
        case 'defensive': {
            const cDist = Math.sqrt(e.x * e.x + e.z * e.z);
            if (cDist > 8) {
                e.vx -= (e.x / (cDist + 0.1)) * aiForce * 0.6;
                e.vz -= (e.z / (cDist + 0.1)) * aiForce * 0.6;
            }
            const pSpeed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
            if (pSpin < eSpin * 0.7 || pSpeed > 1.5) {
                e.vx += (dx / colDist) * aiForce * 0.8;
                e.vz += (dz / colDist) * aiForce * 0.8;
            } else {
                e.vx += (-dz / colDist) * aiForce * 0.4;
                e.vz += (dx / colDist) * aiForce * 0.4;
            }
            break;
        }
        case 'strategic': {
            if (eSpin > pSpin) {
                e.vx += (dx / colDist) * aiForce;
                e.vz += (dz / colDist) * aiForce;
            } else {
                const cDist = Math.sqrt(e.x * e.x + e.z * e.z);
                if (cDist > 5) {
                    e.vx -= (e.x / (cDist + 0.1)) * aiForce * 0.8;
                    e.vz -= (e.z / (cDist + 0.1)) * aiForce * 0.8;
                }
            }
            break;
        }
        case 'boss': {
            if (eSpin > pSpin * 0.8) {
                e.vx += (dx / colDist) * aiForce * 1.2;
                e.vz += (dz / colDist) * aiForce * 1.2;
            } else {
                const cDist = Math.sqrt(e.x * e.x + e.z * e.z);
                if (cDist > 5) {
                    e.vx -= (e.x / (cDist + 0.1)) * aiForce;
                    e.vz -= (e.z / (cDist + 0.1)) * aiForce;
                }
            }
            if (e.aiBurstCooldown <= 0 && colDist < 25 && Math.random() > 0.994) {
                e.vx += (dx / colDist) * 0.8;
                e.vz += (dz / colDist) * 0.8;
                e.aiBurstCooldown = 60;
                createSparks(e.x, e.z, 8, 0xff0055);
            }
            break;
        }
    }
}

function updateHudBars(p, e) {
    const pSpinPct = Math.max(0, Math.abs(p.spin) / MAX_SPIN * 100);
    const eSpinPct = Math.max(0, Math.abs(e.spin) / MAX_SPIN * 100);
    const pBar = document.getElementById('spin-bar-p');
    const eBar = document.getElementById('spin-bar-e');
    pBar.style.width = Math.min(pSpinPct, 100) + '%';
    pBar.classList.toggle('critical', pSpinPct < 20);
    eBar.style.width = Math.min(eSpinPct, 100) + '%';
    eBar.classList.toggle('critical', eSpinPct < 20);
    document.getElementById('burst-bar-p').style.width = Math.min(p.burst, 100) + '%';
    document.getElementById('burst-bar-e').style.width = Math.min(e.burst, 100) + '%';
}

function doBurstFinish(burstObj) {
    AudioSys.playBurst();
    Haptics.burst();
    triggerShake(6);
    timeScaleTarget = 0.25;
    setTimeout(() => { timeScaleTarget = 1.0; }, 1500);

    // explode into fragments
    const color = burstObj.isPlayer ? new THREE.Color(Save.data.color).getHex() : OPPONENTS[state.level].color;
    for (let i = 0; i < 16; i++) {
        const geo = new THREE.BoxGeometry(0.9, 0.4, 1.4);
        const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(burstObj.x, 2.5, burstObj.z);
        mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * 1.0 + 0.4;
        particles.push({
            mesh, vx: Math.cos(angle) * spd, vy: Math.random() * 0.9 + 0.4, vz: Math.sin(angle) * spd,
            life: 1.6, startColor: color, spin: (Math.random() - 0.5) * 0.5
        });
        scene.add(mesh);
    }
    createImpactFlash(burstObj.x, burstObj.z, 3);
    createSparks(burstObj.x, burstObj.z, 24, 0xffffff);
    burstObj.groups.root.visible = false;
    burstObj.spin = 0.001;
    Battle.roundOver(burstObj.isPlayer ? 'LOSE' : 'WIN', 'BURST');
}

// ---------------- FX ----------------
function triggerShake(intensity) { shakeIntensity = Math.max(shakeIntensity, intensity); }

function createSparks(x, z, count, color) {
    count = count || 8; color = color || 0xffffaa;
    if (!Save.data.settings.fx) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
        const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
        const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 1.5, z);
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * 0.8 + 0.2;
        particles.push({ mesh, vx: Math.cos(angle) * spd, vy: Math.random() * 0.6 + 0.3, vz: Math.sin(angle) * spd, life: 1.0, startColor: color });
        scene.add(mesh);
    }
}

function createImpactFlash(x, z, intensity) {
    const size = Math.min(intensity * 3, 8);
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 2, z);
    scene.add(mesh);
    flashMeshes.push({ mesh, life: 1.0 });
}

function createConfetti() {
    const colors = [0x00f3ff, 0xff0055, 0xffff00, 0x00ff88, 0xffffff, 0xff8800];
    for (let i = 0; i < 30; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const geo = new THREE.BoxGeometry(0.4, 0.4, 0.1);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20);
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * 0.4 + 0.3;
        particles.push({ mesh, vx: Math.cos(angle) * spd, vy: Math.random() * 0.8 + 0.5, vz: Math.sin(angle) * spd, life: 2.0, startColor: color });
        scene.add(mesh);
    }
}

function updateParticles(frameScale) {
    const tsc = timeScale * frameScale;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx * tsc; p.mesh.position.y += p.vy * tsc; p.mesh.position.z += p.vz * tsc;
        if (p.spin) { p.mesh.rotation.x += p.spin; p.mesh.rotation.z += p.spin; }
        p.vy -= 0.03 * tsc; p.life -= 0.04 * tsc;
        p.mesh.scale.setScalar(Math.max(0.1, Math.min(p.life, 1)));
        p.mesh.material.opacity = Math.min(p.life, 1);
        if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); particles.splice(i, 1); }
    }
    for (let i = flashMeshes.length - 1; i >= 0; i--) {
        const f = flashMeshes[i];
        f.life -= 0.15;
        f.mesh.scale.setScalar(1 + (1 - f.life) * 2);
        f.mesh.material.opacity = Math.max(0, f.life);
        if (f.life <= 0) { scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); flashMeshes.splice(i, 1); }
    }
}

function updateTrails() {
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const c = scene.children[i];
        if (c.userData.isTrail) { scene.remove(c); c.geometry.dispose(); c.material.dispose(); }
    }
    if (state.screen !== 'PLAY' && state.screen !== 'WAIT') return;
    const colors = [new THREE.Color(Save.data.color).getHex(), OPPONENTS[state.level] ? OPPONENTS[state.level].color : 0xff0055];
    trailBuffers.forEach((buf, idx) => {
        if (buf.length < 3) return;
        const points = buf.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z));
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: colors[idx], transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
        const line = new THREE.Line(geo, mat);
        line.userData.isTrail = true;
        scene.add(line);
    });
}

// ---------------- Messages ----------------
function showMsg(t, d, c) {
    const el = document.getElementById('msg-overlay');
    el.innerText = t; el.style.color = c; el.style.opacity = 1;
    if (d) setTimeout(() => el.style.opacity = 0, d);
}

// ---------------- Main loop ----------------
let lastFrameTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const frameScale = Math.min((now - lastFrameTime) / 16.667, 2.5);
    lastFrameTime = now;

    physicsStep(frameScale);
    updateParticles(frameScale);
    updateTrails();

    shakeIntensity *= 0.85;
    cameraZoomOffset *= 0.92;

    if (state.screen === 'PLAY' || state.screen === 'WAIT') {
        const cx = ((objects[0] ? objects[0].x : 0) + (objects[1] ? objects[1].x : 0)) / 2;
        const cz = ((objects[0] ? objects[0].z : 0) + (objects[1] ? objects[1].z : 0)) / 2;
        const targetY = 85 + cameraZoomOffset;
        const targetZ = cz * 0.5 + 40;
        camera.position.x += (cx * 0.5 - camera.position.x) * 0.05;
        camera.position.y += (targetY - camera.position.y) * 0.08;
        camera.position.z += (targetZ - camera.position.z) * 0.05;
        if (shakeIntensity > 0.1) {
            camera.position.x += (Math.random() - 0.5) * shakeIntensity;
            camera.position.z += (Math.random() - 0.5) * shakeIntensity;
            camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.3;
        }
        camera.lookAt(cx, 0, cz);
    } else if (state.screen === 'LAUNCH') {
        camera.position.x += (0 - camera.position.x) * 0.05;
        camera.position.y += (70 - camera.position.y) * 0.05;
        camera.position.z += (105 - camera.position.z) * 0.05;
        camera.lookAt(0, 0, 0);
        if (playerGroups) playerGroups.spin.rotation.y -= 0.04;
        if (enemyGroups) enemyGroups.spin.rotation.y += 0.04;
    } else if (state.screen === 'GARAGE') {
        const t = Date.now() * 0.0005;
        camera.position.x += (Math.sin(t) * 26 - camera.position.x) * 0.06;
        camera.position.z += (Math.cos(t) * 26 - camera.position.z) * 0.06;
        camera.position.y += (17 - camera.position.y) * 0.06;
        camera.lookAt(0, 7, 0);
        if (previewGroups) previewGroups.spin.rotation.y -= 0.02;
    } else { // HOME / LEVELS / RESULT
        const t = Date.now() * 0.0002;
        camera.position.x = Math.sin(t) * 52;
        camera.position.z = Math.cos(t) * 52;
        camera.position.y = 48;
        camera.lookAt(0, 2, 0);
        if (previewGroups) previewGroups.spin.rotation.y -= 0.06;
    }

    renderer.render(scene, camera);
}

// ---------------- Boot ----------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('load', () => {
    Save.load();
    initThreeJS();
    Paint.init();
    Launch.setup();
    setupArenaTiltControls();
    document.getElementById('boost-btn').addEventListener('pointerdown', () => Battle.useBoost());
    document.querySelectorAll('button, .tool-btn, .tab').forEach(el =>
        el.addEventListener('click', () => AudioSys.playClick()));
    // First user interaction: unlock audio + start music
    const unlockAudio = () => {
        AudioSys.init();
        AudioSys.startMusic();
        window.removeEventListener('pointerdown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);

    UI.goHome();
    animate();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});
