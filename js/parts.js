// ============ Part System ============
// Every top = Blade (shape/attack) + Weight ring (mass) + Tip (movement/friction)
// Stats: atk / def / sta / spd, each roughly 0-100 after combining.

const PARTS = {
    blade: [
        {
            id: 'triad', name: '三刃 TRIAD', tag: '攻擊型', sides: 3, spikiness: 0.42,
            atk: 62, def: 18, sta: 22, spd: 34,
            radius: 5.0, massMult: 1.0, price: 0,
            desc: '三片重刃，撞擊力強'
        },
        {
            id: 'guard', name: '圓盾 GUARD', tag: '防禦型', sides: 0, spikiness: 0,
            atk: 10, def: 62, sta: 45, spd: 18,
            radius: 4.6, massMult: 1.1, price: 0,
            desc: '完美圓形，穩定耐打'
        },
        {
            id: 'hex', name: '六角 HEX', tag: '平衡型', sides: 6, spikiness: 0.18,
            atk: 34, def: 38, sta: 36, spd: 30,
            radius: 4.8, massMult: 1.0, price: 300,
            desc: '六角均衡，全能表現'
        },
        {
            id: 'nova', name: '星芒 NOVA', tag: '速攻型', sides: 5, spikiness: 0.5,
            atk: 48, def: 20, sta: 26, spd: 52,
            radius: 5.2, massMult: 0.9, price: 600,
            desc: '五芒星刃，快速游擊'
        },
        {
            id: 'buzz', name: '鋸刃 BUZZSAW', tag: '重攻型', sides: 10, spikiness: 0.34,
            atk: 72, def: 12, sta: 14, spd: 40,
            radius: 5.4, massMult: 1.05, price: 1200,
            desc: '鋸齒撕裂，攻擊最強'
        },
        {
            id: 'halo', name: '光環 HALO', tag: '持久型', sides: 0, spikiness: 0,
            atk: 14, def: 40, sta: 70, spd: 22,
            radius: 5.0, massMult: 1.15, price: 2000,
            desc: '外重環設計，超長續航'
        }
    ],
    weight: [
        {
            id: 'light', name: '輕量環', tag: '靈活', mass: 1.7,
            atk: 0, def: 0, sta: 4, spd: 22, price: 0,
            desc: '輕巧靈活，加速快'
        },
        {
            id: 'std', name: '標準環', tag: '均衡', mass: 2.4,
            atk: 8, def: 8, sta: 8, spd: 8, price: 0,
            desc: '標準配重'
        },
        {
            id: 'heavy', name: '重裝環', tag: '重壓', mass: 3.4,
            atk: 18, def: 20, sta: 10, spd: -14, price: 500,
            desc: '厚重金屬，撞擊沉重'
        }
    ],
    tip: [
        {
            id: 'needle', name: '尖針軸', tag: '持久', shape: 'needle',
            atk: 0, def: 6, sta: 26, spd: 0,
            centerBias: 1.5, drive: 0, grip: 0, price: 0,
            desc: '定點旋轉，消耗最少'
        },
        {
            id: 'ball', name: '圓球軸', tag: '平衡', shape: 'ball',
            atk: 6, def: 10, sta: 12, spd: 10,
            centerBias: 1.0, drive: 0, grip: 0.2, price: 0,
            desc: '滑順移動，攻守兼備'
        },
        {
            id: 'flat', name: '平底軸', tag: '暴走', shape: 'flat',
            atk: 20, def: 2, sta: -8, spd: 30,
            centerBias: 0.45, drive: 0.028, grip: 0.5, price: 400,
            desc: '場內暴走，主動衝撞'
        },
        {
            id: 'rubber', name: '橡膠軸', tag: '吸收', shape: 'rubber',
            atk: 4, def: 30, sta: -14, spd: 4,
            centerBias: 1.2, drive: 0, grip: 1.0, knockResist: 0.45, price: 900,
            desc: '橡膠抓地，吸收衝擊'
        }
    ]
};

// Compute combined stats for a build {blade, weight, tip} (part ids)
function computeStats(build) {
    const b = PARTS.blade.find(p => p.id === build.blade) || PARTS.blade[0];
    const w = PARTS.weight.find(p => p.id === build.weight) || PARTS.weight[1];
    const t = PARTS.tip.find(p => p.id === build.tip) || PARTS.tip[0];

    const atk = Math.max(2, Math.min(100, b.atk + w.atk + t.atk));
    const def = Math.max(2, Math.min(100, b.def + w.def + t.def));
    const sta = Math.max(2, Math.min(100, b.sta + w.sta + t.sta));
    const spd = Math.max(2, Math.min(100, b.spd + w.spd + t.spd));

    // physics params
    const mass = w.mass * b.massMult;
    const radius = b.radius;
    // spin decay per frame: sta 0-100 -> base match length roughly 20s ~ 90s
    const friction = 0.9972 + (sta / 100) * 0.0022;

    const cp = Math.floor(atk * 4.2 + def * 3.6 + sta * 4.4 + spd * 3.2 + mass * 30);

    return {
        atk, def, sta, spd, mass, radius, friction, cp,
        blade: b, weight: w, tip: t
    };
}

// ============ Opponents (10 levels) ============
const OPPONENTS = [
    { name: '訓練機甲', en: 'DRONE-01', build: { blade: 'guard', weight: 'light', tip: 'needle' }, color: 0x888899, ai: 'aggressive', mult: 0.6, desc: '入門訓練用機體' },
    { name: '疾風狼', en: 'GALE WOLF', build: { blade: 'triad', weight: 'light', tip: 'ball' }, color: 0x44aaff, ai: 'aggressive', mult: 0.72, desc: '直線衝撞的年輕好手' },
    { name: '鐵壁龜', en: 'IRON SHELL', build: { blade: 'guard', weight: 'heavy', tip: 'rubber' }, color: 0x44cc88, ai: 'defensive', mult: 0.84, desc: '守到你先力竭' },
    { name: '火焰鳥', en: 'BLAZE WING', build: { blade: 'nova', weight: 'std', tip: 'flat' }, color: 0xff7722, ai: 'aggressive', mult: 0.94, desc: '場內高速暴走' },
    { name: '幻影蛇', en: 'PHANTOM', build: { blade: 'hex', weight: 'std', tip: 'ball' }, color: 0xaa66ff, ai: 'strategic', mult: 1.04, desc: '看穿你的每一步' },
    { name: '雷霆犀', en: 'THUNDER HORN', build: { blade: 'buzz', weight: 'heavy', tip: 'flat' }, color: 0xffdd22, ai: 'aggressive', mult: 1.14, desc: '重量級的正面對決' },
    { name: '月蝕', en: 'ECLIPSE', build: { blade: 'halo', weight: 'heavy', tip: 'needle' }, color: 0x9999ff, ai: 'defensive', mult: 1.25, desc: '無盡旋轉的持久王' },
    { name: '獄炎將軍', en: 'INFERNO', build: { blade: 'buzz', weight: 'heavy', tip: 'rubber' }, color: 0xff3300, ai: 'strategic', mult: 1.36, desc: '攻防一體的強者' },
    { name: '虛空行者', en: 'VOID WALKER', build: { blade: 'nova', weight: 'std', tip: 'flat' }, color: 0x00ffcc, ai: 'boss', mult: 1.5, desc: '傳說中的四強選手', boss: true },
    { name: '王者・天龍', en: 'DRAGON KING', build: { blade: 'buzz', weight: 'heavy', tip: 'flat' }, color: 0xffffff, ai: 'boss', mult: 1.65, desc: '不敗的世界冠軍', boss: true }
];

// SVG icon builders for part cards
const PartIcons = {
    blade: function(p, color) {
        color = color || '#00f3ff';
        if (p.sides === 0) {
            const inner = p.id === 'halo'
                ? `<circle cx="24" cy="24" r="11" fill="none" stroke="${color}" stroke-width="4" opacity="0.85"/>`
                : `<circle cx="24" cy="24" r="8" fill="${color}" opacity="0.35"/>`;
            return `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="none" stroke="${color}" stroke-width="2.5"/>${inner}</svg>`;
        }
        const pts = [];
        const n = p.sides * 2;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const r = (i % 2 === 0) ? 19 : 19 * (1 - p.spikiness);
            pts.push((24 + Math.cos(a) * r).toFixed(1) + ',' + (24 + Math.sin(a) * r).toFixed(1));
        }
        return `<svg viewBox="0 0 48 48"><polygon points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="24" r="5" fill="${color}" opacity="0.5"/></svg>`;
    },
    weight: function(p) {
        const t = p.id === 'light' ? 3 : p.id === 'std' ? 5.5 : 8.5;
        return `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16" fill="none" stroke="#ffaa00" stroke-width="${t}" opacity="0.8"/></svg>`;
    },
    tip: function(p) {
        const c = '#aa66ff';
        if (p.shape === 'needle') return `<svg viewBox="0 0 48 48"><path d="M14 12 L34 12 L28 24 L24 40 L20 24 Z" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
        if (p.shape === 'ball') return `<svg viewBox="0 0 48 48"><path d="M14 10 L34 10 L30 24 L18 24 Z" fill="none" stroke="${c}" stroke-width="2.5"/><circle cx="24" cy="31" r="8" fill="none" stroke="${c}" stroke-width="2.5"/></svg>`;
        if (p.shape === 'flat') return `<svg viewBox="0 0 48 48"><path d="M14 10 L34 10 L31 26 L17 26 Z" fill="none" stroke="${c}" stroke-width="2.5"/><rect x="15" y="28" width="18" height="8" rx="2" fill="none" stroke="${c}" stroke-width="2.5"/></svg>`;
        return `<svg viewBox="0 0 48 48"><path d="M14 10 L34 10 L30 22 L18 22 Z" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M16 24 Q24 42 32 24 Z" fill="${c}" opacity="0.5"/></svg>`;
    }
};
