/**
 * app.js — BINARYFLIPPER TOOL
 * WebSocket connection, tick processing, chart rendering, UI updates.
 * Connects to Deriv's public WebSocket API (no auth needed for ticks).
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';
const MAX_HISTORY = 1000;  // keep last N ticks in memory
const CHART_LEN = 80;    // visible points on mini chart

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    ws: null,
    symbol: 'R_10',
    symbolName: 'Volatility 10',
    prices: [],       // raw prices
    digits: [],       // last digit of each price
    tickCount: 0,
    high: null,
    low: null,
    lastPrice: null,
    ouBarrier: 4,        // Over/Under barrier digit
    mdTarget: null,      // Matches/Differs target digit (null = auto)
    analysisN: 100,      // ticks used for analysis
    reconnectTimer: null,
    pingTimer: null,
    candles: [],         // array of {epoch, open, high, low, close}
    candleTimeframe: 60, // 1m default
    // Circle Analysis
    circleRotation: 0,
    lastCircleDigit: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
    statusDot: $('statusDot'),
    statusLabel: $('statusLabel'),
    cpMarket: $('cpMarket'),
    cpPrice: $('cpPrice'),
    cpDigit: $('cpDigit'),
    cpChange: $('cpChange'),
    tickStrip: $('tickStrip'),
    statTicks: $('statTicks'),
    statHigh: $('statHigh'),
    statLow: $('statLow'),
    statSpread: $('statSpread'),
    digitGrid: $('digitGrid'),
    heatmapGrid: $('heatmapGrid'),
    streakGrid: $('streakGrid'),
    cycleInfo: $('cycleInfo'),
    digitSubLabel: $('digitSubLabel'),
    // Rise/Fall
    rfBadge: $('rfBadge'), rfRisePct: $('rfRisePct'),
    rfFallPct: $('rfFallPct'), rfRiseFill: $('rfRiseFill'),
    rfFallFill: $('rfFallFill'), rfSignal: $('rfSignal'),
    rfArrow: $('rfArrow'), rfText: $('rfText'),
    rfConf: $('rfConf'), rfRsi: $('rfRsi'),
    rfStreak: $('rfStreak'), rfMomentum: $('rfMomentum'),
    // Over/Under
    ouBadge: $('ouBadge'), ouOverPct: $('ouOverPct'),
    ouUnderPct: $('ouUnderPct'), ouOverFill: $('ouOverFill'),
    ouUnderFill: $('ouUnderFill'), ouSignal: $('ouSignal'),
    ouArrow: $('ouArrow'), ouText: $('ouText'),
    ouConf: $('ouConf'), ouFreq: $('ouFreq'),
    ouStreak: $('ouStreak'),
    // Even/Odd
    eoBadge: $('eoBadge'), eoEvenPct: $('eoEvenPct'),
    eoOddPct: $('eoOddPct'), eoEvenFill: $('eoEvenFill'),
    eoOddFill: $('eoOddFill'), eoSignal: $('eoSignal'),
    eoArrow: $('eoArrow'), eoText: $('eoText'),
    eoConf: $('eoConf'), eoEvenCount: $('eoEvenCount'),
    eoOddCount: $('eoOddCount'), eoStreak: $('eoStreak'),
    // Matches/Differs
    mdBadge: $('mdBadge'), mdArrow: $('mdArrow'),
    mdText: $('mdText'), mdConf: $('mdConf'),
    mdMatchChip: $('mdMatchChip'), mdDiffChip: $('mdDiffChip'),
    mdGapChip: $('mdGapChip'), mdDigitGrid: $('mdDigitGrid'),
    // Accumulators
    accBadge: $('accBadge'), accArrow: $('accArrow'),
    accText: $('accText'), accConf: $('accConf'),
    accCalmPct: $('accCalmPct'), accCalmFill: $('accCalmFill'),
    accGrowthRate: $('accGrowthRate'), accSafeTicks: $('accSafeTicks'),
    accRsi: $('accRsi'), accVolChip: $('accVolChip'),
    accTrendChip: $('accTrendChip'), accReasonChip: $('accReasonChip'),
    // Higher/Lower
    hlBadge: $('hlBadge'), hlHigherPct: $('hlHigherPct'),
    hlLowerPct: $('hlLowerPct'), hlHigherFill: $('hlHigherFill'),
    hlLowerFill: $('hlLowerFill'), hlSignal: $('hlSignal'),
    hlArrow: $('hlArrow'), hlText: $('hlText'),
    hlConf: $('hlConf'), hlRsi: $('hlRsi'),
    hlSma: $('hlSma'), hlMomentum: $('hlMomentum'),
    // Time badges
    rfTime: $('rfTime'), ouTime: $('ouTime'), eoTime: $('eoTime'),
    mdTime: $('mdTime'), accTime: $('accTime'), hlTime: $('hlTime'),
    // Candlestick Chart
    candleChart: $('candleChart'),
    candleOHLC: $('candleOHLC'),
    tfBtns: document.querySelectorAll('.tf-btn'),
    // Prediction Tabs
    ptabs: document.querySelectorAll('.ptab'),
    tabContents: document.querySelectorAll('.tab-content'),
    // Circle Analysis
    circleCursor: $('circleCursor'),
    hotDigit: $('hotDigit'),
    circleDigits: document.querySelectorAll('.c-digit'),
};

// ─── Clock ───────────────────────────────────────────────────────────────────
function startClock() {
    const el = $('clockDisplay');
    setInterval(() => {
        const now = new Date();
        el.textContent = now.toUTCString().slice(17, 25) + ' UTC';
    }, 1000);
}

// ─── Background particles ─────────────────────────────────────────────────────
function initParticles() {
    const container = $('bgParticles');
    const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
    for (let i = 0; i < 25; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 180 + 40;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 20;
        const dur = Math.random() * 30 + 20;
        p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${left}%;
      background:${color};
      animation-duration:${dur}s;
      animation-delay:-${delay}s;
    `;
        container.appendChild(p);
    }
}

// ─── Market pill selection ────────────────────────────────────────────────────
function initMarketPills() {
    document.querySelectorAll('.pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.symbol = btn.dataset.symbol;
            state.symbolName = btn.dataset.name;
            resetState();
            subscribeToSymbol();
        });
    });
}

// ─── Over/Under barrier pills ─────────────────────────────────────────────────
function initBarrierPills() {
    document.querySelectorAll('#ouDigitPills .dpill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#ouDigitPills .dpill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.ouBarrier = parseInt(btn.dataset.d);
            runAnalysis();
        });
    });
}

// ─── Matches/Differs target digit pills ──────────────────────────────────────
function initMdPills() {
    // Set Auto as default active
    $('mdPillAuto').classList.add('active');
    document.querySelectorAll('.md-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.md-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const v = btn.dataset.d;
            state.mdTarget = v === 'auto' ? null : parseInt(v);
            runAnalysis();
        });
    });
}

// ─── Tick count selector ──────────────────────────────────────────────────────
function initTickCountSelector() {
    $('tickCountSelect').addEventListener('change', e => {
        state.analysisN = parseInt(e.target.value);
        dom.digitSubLabel.textContent = `Last ${state.analysisN} ticks`;
        runAnalysis();
    });
}

// ─── Canvas Mini Chart ────────────────────────────────────────────────────────
const canvas = $('priceChart');
const ctx = canvas.getContext('2d');

function drawChart() {
    const prices = state.prices.slice(-CHART_LEN);
    if (prices.length < 2) return;

    const W = canvas.offsetWidth || 380;
    const H = canvas.offsetHeight || 150;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const pad = { t: 15, b: 20, l: 8, r: 8 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(99,179,237,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }

    // Line gradient
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#8b5cf6');

    // Area fill
    const areaGrad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    areaGrad.addColorStop(0, 'rgba(59,130,246,0.2)');
    areaGrad.addColorStop(1, 'rgba(139,92,246,0.01)');

    const xStep = cW / (prices.length - 1);
    const toY = v => pad.t + cH - ((v - min) / range) * cH;
    const toX = i => pad.l + i * xStep;

    // Area
    ctx.beginPath();
    ctx.moveTo(toX(0), H - pad.b);
    prices.forEach((p, i) => ctx.lineTo(toX(i), toY(p)));
    ctx.lineTo(toX(prices.length - 1), H - pad.b);
    ctx.closePath();
    ctx.fillStyle = areaGrad; ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    prices.forEach((p, i) => {
        if (i === 0) ctx.moveTo(toX(i), toY(p));
        else ctx.lineTo(toX(i), toY(p));
    });
    ctx.stroke();

    // Last price dot
    const lastX = toX(prices.length - 1);
    const lastY = toY(prices[prices.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#6ee7b7'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
}

// ─── Tick strip ───────────────────────────────────────────────────────────────
function addToTickStrip(digit) {
    const strip = dom.tickStrip;
    const bubble = document.createElement('div');
    bubble.className = `tick-bubble digit-${digit % 2 === 0 ? 'even' : 'odd'}`;
    bubble.textContent = digit;
    strip.appendChild(bubble);
    // Keep only last 30
    while (strip.children.length > 30) strip.removeChild(strip.firstChild);
}

// ─── Digit grid ───────────────────────────────────────────────────────────────
function buildDigitGrid() {
    dom.digitGrid.innerHTML = '';
    for (let d = 0; d <= 9; d++) {
        const row = document.createElement('div');
        row.className = 'digit-row';
        row.innerHTML = `
      <div class="digit-num">${d}</div>
      <div class="digit-bar-track"><div class="digit-bar-fill dbar-${d}" id="dbar-${d}" style="width:10%"></div></div>
      <div class="digit-bar-val" id="dval-${d}">0%</div>
    `;
        dom.digitGrid.appendChild(row);
    }
}

function updateDigitGrid(digits) {
    const sample = digits.slice(-state.analysisN);
    const freq = DerivAnalysis.digitFrequency(sample);
    const total = sample.length || 1;
    const maxFreq = Math.max(...freq);

    for (let d = 0; d <= 9; d++) {
        const pct = ((freq[d] / total) * 100).toFixed(1);
        const barW = maxFreq > 0 ? (freq[d] / maxFreq) * 100 : 0;
        const bar = $(`dbar-${d}`);
        const val = $(`dval-${d}`);
        if (bar) bar.style.width = barW + '%';
        if (val) val.textContent = pct + '%';
    }
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
const DIGIT_COLORS = [
    '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e',
    '#06b6d4', '#facc15', '#a78bfa', '#ef4444', '#2dd4bf'
];

function buildHeatmap() {
    dom.heatmapGrid.innerHTML = '';
    // 20 cells representing last 20 ticks
    for (let i = 0; i < 40; i++) {
        const cell = document.createElement('div');
        cell.className = 'hmap-cell';
        cell.id = `hcell-${i}`;
        dom.heatmapGrid.appendChild(cell);
    }
}

function updateHeatmap(digits) {
    const recent = digits.slice(-40);
    for (let i = 0; i < 40; i++) {
        const cell = $(`hcell-${i}`);
        if (!cell) continue;
        const d = recent[i];
        if (d === undefined) {
            cell.style.background = 'rgba(255,255,255,0.03)';
            cell.textContent = '';
        } else {
            // opacity fades with age
            const alpha = 0.25 + (i / 40) * 0.75;
            cell.style.background = DIGIT_COLORS[d] + Math.round(alpha * 255).toString(16).padStart(2, '0');
            cell.textContent = d;
        }
    }
}

// ─── Streak section ───────────────────────────────────────────────────────────
function updateStreakGrid(digits) {
    const s = DerivAnalysis.computeStreaks(digits.slice(-state.analysisN));
    dom.streakGrid.innerHTML = `
    <div class="streak-item">
      <div class="streak-type" style="color:var(--even-color)">Even streak</div>
      <div class="streak-val" style="color:var(--even-color)">${s.currentEven}</div>
    </div>
    <div class="streak-item">
      <div class="streak-type" style="color:var(--odd-color)">Odd streak</div>
      <div class="streak-val" style="color:var(--odd-color)">${s.currentOdd}</div>
    </div>
    <div class="streak-item">
      <div class="streak-type" style="color:var(--over-color)">High (≥5)</div>
      <div class="streak-val" style="color:var(--over-color)">${s.currentHigh}</div>
    </div>
    <div class="streak-item">
      <div class="streak-type" style="color:var(--under-color)">Low (≤4)</div>
      <div class="streak-val" style="color:var(--under-color)">${s.currentLow}</div>
    </div>
  `;
}

// ─── Cycle info ───────────────────────────────────────────────────────────────
function updateCycleInfo(digits) {
    const c = DerivAnalysis.detectCycle(digits, Math.min(state.analysisN, digits.length));
    if (!c) { dom.cycleInfo.textContent = 'Need more data…'; return; }
    dom.cycleInfo.innerHTML =
        `🔥 Hot: <strong style="color:${DIGIT_COLORS[c.hotDigit]}">${c.hotDigit}</strong> (${c.hotCount}x) &nbsp;|&nbsp;
     ❄️ Cold: <strong style="color:${DIGIT_COLORS[c.coldDigit]}">${c.coldDigit}</strong> (${c.coldCount}x) &nbsp;|&nbsp;
     Even ${c.evenRate}% / Odd ${c.oddRate}%`;
}

// ─── Prediction UI updaters ───────────────────────────────────────────────────
const SIGNAL_ARROW = {
    'STRONG RISE': '⬆️', 'RISE': '↑', 'STRONG FALL': '⬇️', 'FALL': '↓',
    'OVER': '↑', 'UNDER': '↓', 'EVEN': '⊙', 'ODD': '⊗', 'NEUTRAL': '→', 'WAIT': '⌛'
};
const SIGNAL_CLASS = {
    'STRONG RISE': 'rise-text', 'RISE': 'rise-text', 'STRONG FALL': 'fall-text', 'FALL': 'fall-text',
    'OVER': 'over-text', 'UNDER': 'under-text', 'EVEN': 'even-text', 'ODD': 'odd-text',
    'NEUTRAL': '', 'WAIT': ''
};
const BADGE_CLASS = {
    'STRONG RISE': 'strong-rise', 'RISE': 'rise', 'STRONG FALL': 'strong-fall', 'FALL': 'fall',
    'OVER': 'over', 'UNDER': 'under', 'EVEN': 'even', 'ODD': 'odd',
    'NEUTRAL': 'neutral', 'WAIT': 'wait'
};

// ─── Prediction time helper ─────────────────────────────────────────────────────────
function predTime(confidence) {
    const t = DerivAnalysis.estimatePredictionTime(confidence, state.symbol);
    return `⏱ ${t.ticks}t (${t.display})`;
}

function updateRiseFall(prices) {
    const r = DerivAnalysis.analyzeRiseFall(prices.slice(-state.analysisN));
    dom.rfRisePct.textContent = r.risePct + '%';
    dom.rfFallPct.textContent = r.fallPct + '%';
    dom.rfRiseFill.style.width = r.risePct + '%';
    dom.rfFallFill.style.width = r.fallPct + '%';
    dom.rfArrow.textContent = SIGNAL_ARROW[r.signal] || '→';
    dom.rfText.textContent = r.signal;
    dom.rfText.className = 'signal-text ' + (SIGNAL_CLASS[r.signal] || '');
    dom.rfConf.textContent = r.confidence;
    dom.rfBadge.textContent = r.signal;
    dom.rfBadge.className = 'pred-badge ' + (BADGE_CLASS[r.signal] || '');
    dom.rfRsi.textContent = `RSI: ${r.rsi !== null ? r.rsi : '--'}`;
    dom.rfStreak.textContent = `Streak: ${r.streak}`;
    dom.rfMomentum.textContent = `Mom: ${r.momentum > 0 ? '+' : ''}${r.momentum}`;
    dom.rfTime.textContent = predTime(r.confidence);
}

function updateOverUnder(digits) {
    const r = DerivAnalysis.analyzeOverUnder(digits.slice(-state.analysisN), state.ouBarrier);
    dom.ouOverPct.textContent = r.overPct + '%';
    dom.ouUnderPct.textContent = r.underPct + '%';
    dom.ouOverFill.style.width = r.overPct + '%';
    dom.ouUnderFill.style.width = r.underPct + '%';
    dom.ouArrow.textContent = SIGNAL_ARROW[r.signal] || '→';
    dom.ouText.textContent = r.signal;
    dom.ouText.className = 'signal-text ' + (SIGNAL_CLASS[r.signal] || '');
    dom.ouConf.textContent = r.confidence;
    dom.ouBadge.textContent = r.signal;
    dom.ouBadge.className = 'pred-badge ' + (BADGE_CLASS[r.signal] || '');
    dom.ouFreq.textContent = `Freq(≤${state.ouBarrier}): ${r.freq}%`;
    dom.ouStreak.textContent = `Streak: ${r.streak}`;
    dom.ouTime.textContent = predTime(r.confidence);
}

function updateEvenOdd(digits) {
    const r = DerivAnalysis.analyzeEvenOdd(digits.slice(-state.analysisN));
    dom.eoEvenPct.textContent = r.evenPct + '%';
    dom.eoOddPct.textContent = r.oddPct + '%';
    dom.eoEvenFill.style.width = r.evenPct + '%';
    dom.eoOddFill.style.width = r.oddPct + '%';
    dom.eoArrow.textContent = SIGNAL_ARROW[r.signal] || '→';
    dom.eoText.textContent = r.signal;
    dom.eoText.className = 'signal-text ' + (SIGNAL_CLASS[r.signal] || '');
    dom.eoConf.textContent = r.confidence;
    dom.eoBadge.textContent = r.signal;
    dom.eoBadge.className = 'pred-badge ' + (BADGE_CLASS[r.signal] || '');
    dom.eoEvenCount.textContent = `Even: ${r.evenCount}`;
    dom.eoOddCount.textContent = `Odd: ${r.oddCount}`;
    dom.eoStreak.textContent = `Streak: ${r.streak}`;
    dom.eoTime.textContent = predTime(r.confidence);
}

// ─── Matches / Differs UI update ─────────────────────────────────────────────
const MD_SIGNAL_ARROW = { 'NEUTRAL': '⊙', 'WAIT': '⌛' };
const MD_SIGNAL_CLASS = { 'NEUTRAL': '', 'WAIT': '' };
const MD_BADGE_CLASS = { 'NEUTRAL': 'neutral', 'WAIT': 'wait' };

function buildMdDigitGrid(scores) {
    const grid = dom.mdDigitGrid;
    if (!grid) return;
    // Build once, update after
    if (!grid.children.length) {
        for (let d = 0; d <= 9; d++) {
            const col = document.createElement('div');
            col.className = 'md-digit-col';
            col.innerHTML = `
              <div class="md-digit-score" id="mdscore-${d}">--</div>
              <div class="md-bar-track"><div class="md-bar-fill md-bar-${d}" id="mdbar-${d}" style="height:4px"></div></div>
              <div class="md-digit-label">${d}</div>
            `;
            grid.appendChild(col);
        }
    }
    const maxS = Math.max(...scores);
    for (let d = 0; d <= 9; d++) {
        const scoreEl = $(`mdscore-${d}`);
        const barEl = $(`mdbar-${d}`);
        const pct = maxS > 0 ? Math.round((scores[d] / maxS) * 100) : 0;
        if (scoreEl) scoreEl.textContent = scores[d];
        if (barEl) barEl.style.height = Math.max(4, pct * 0.5) + 'px';
        // Highlight best match / differs
        const col = grid.children[d];
        col.classList.toggle('md-hot', scores[d] === maxS);
        col.classList.toggle('md-cold', scores[d] === Math.min(...scores));
    }
}

function updateMatchesDiffers(digits) {
    const r = DerivAnalysis.analyzeMatchesDiffers(digits.slice(-state.analysisN), state.mdTarget);
    buildMdDigitGrid(r.digitScores);

    // Signal
    const sig = r.signal;
    let arrow = '→', textClass = '', badgeClass = 'neutral';
    if (sig.startsWith('MATCHES')) { arrow = '🎯'; textClass = 'match-text'; badgeClass = 'match'; }
    else if (sig.startsWith('DIFFERS')) { arrow = '❌'; textClass = 'differs-text'; badgeClass = 'differs'; }
    else if (sig === 'WAIT') { arrow = '⌛'; }

    dom.mdArrow.textContent = arrow;
    dom.mdText.textContent = sig;
    dom.mdText.className = 'signal-text ' + textClass;
    dom.mdConf.textContent = r.confidence;
    dom.mdBadge.textContent = sig;
    dom.mdBadge.className = 'pred-badge ' + badgeClass;
    dom.mdMatchChip.textContent = `Best Match: ${r.matchDigit !== null ? r.matchDigit : '--'}`;
    dom.mdDiffChip.textContent = `Best Differs: ${r.differsDigit !== null ? r.differsDigit : '--'}`;
    dom.mdGapChip.textContent = r.targetDigit !== null
        ? `Gap(${r.targetDigit}): ${r.lastGaps[r.targetDigit]} ticks`
        : `Gap(${r.matchDigit}): ${r.matchDigit !== null ? r.lastGaps[r.matchDigit] : '--'} ticks`;
    dom.mdTime.textContent = predTime(r.confidence);
}

// ─── Accumulators UI update ───────────────────────────────────────────────────
const ACC_SIGNAL_ARROW = { 'BUY': '🟢', 'CAUTION': '🟡', 'WAIT': '🔴' };
const ACC_SIGNAL_CLASS = { 'BUY': 'rise-text', 'CAUTION': 'amber-text', 'WAIT': 'fall-text' };
const ACC_BADGE_CLASS = { 'BUY': 'rise', 'CAUTION': 'neutral', 'WAIT': 'fall' };

function updateAccumulators(prices, digits) {
    const r = DerivAnalysis.analyzeAccumulators(prices.slice(-state.analysisN), digits.slice(-state.analysisN));

    dom.accCalmPct.textContent = r.confidence + '%';
    dom.accCalmFill.style.width = r.confidence + '%';
    dom.accGrowthRate.textContent = r.growthRate + '%';
    dom.accSafeTicks.textContent = r.safeTicks;
    dom.accRsi.textContent = r.rsi !== null ? r.rsi : '--';

    const sig = r.signal;
    dom.accArrow.textContent = ACC_SIGNAL_ARROW[sig] || '→';
    dom.accText.textContent = sig;
    dom.accText.className = 'signal-text ' + (ACC_SIGNAL_CLASS[sig] || '');
    dom.accConf.textContent = r.confidence;
    dom.accBadge.textContent = sig;
    dom.accBadge.className = 'pred-badge ' + (ACC_BADGE_CLASS[sig] || '');
    dom.accVolChip.textContent = `Volatility: ${r.volatilityScore}`;
    dom.accTrendChip.textContent = `Trend: ${r.trendStrength}`;
    dom.accReasonChip.textContent = r.reason;

    // Color the calm fill based on signal
    dom.accCalmFill.className = 'signal-fill acc-calm acc-calm-' + sig.toLowerCase();
    dom.accTime.textContent = predTime(r.confidence);
}

// ─── Higher / Lower UI update ──────────────────────────────────────────────────
const HL_SIGNAL_ARROW = {
    'STRONG HIGHER': '⬆️', 'HIGHER': '↑',
    'STRONG LOWER': '⬇️', 'LOWER': '↓',
    'NEUTRAL': '→', 'WAIT': '⌛'
};
const HL_SIGNAL_CLASS = {
    'STRONG HIGHER': 'higher-text', 'HIGHER': 'higher-text',
    'STRONG LOWER': 'lower-text', 'LOWER': 'lower-text',
    'NEUTRAL': '', 'WAIT': ''
};
const HL_BADGE_CLASS = {
    'STRONG HIGHER': 'strong-higher', 'HIGHER': 'higher',
    'STRONG LOWER': 'strong-lower', 'LOWER': 'lower-hl',
    'NEUTRAL': 'neutral', 'WAIT': 'wait'
};

function updateHigherLower(prices) {
    const r = DerivAnalysis.analyzeHigherLower(prices.slice(-state.analysisN));
    dom.hlHigherPct.textContent = r.higherPct + '%';
    dom.hlLowerPct.textContent = r.lowerPct + '%';
    dom.hlHigherFill.style.width = r.higherPct + '%';
    dom.hlLowerFill.style.width = r.lowerPct + '%';
    dom.hlArrow.textContent = HL_SIGNAL_ARROW[r.signal] || '→';
    dom.hlText.textContent = r.signal;
    dom.hlText.className = 'signal-text ' + (HL_SIGNAL_CLASS[r.signal] || '');
    dom.hlConf.textContent = r.confidence;
    dom.hlBadge.textContent = r.signal;
    dom.hlBadge.className = 'pred-badge ' + (HL_BADGE_CLASS[r.signal] || '');
    dom.hlRsi.textContent = `RSI: ${r.rsi !== null ? r.rsi : '--'}`;
    dom.hlSma.textContent = `SMA: ${r.smaTrend}`;
    dom.hlMomentum.textContent = `Mom: ${r.momentum > 0 ? '+' : ''}${r.momentum}`;
    dom.hlTime.textContent = predTime(r.confidence);
}

// ─── Candlestick Chart Rendering ──────────────────────────────────────────────
function drawCandlestickChart() {
    const canvas = dom.candleChart;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Resize for DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    if (state.candles.length < 2) return;

    const count = state.candles.length;
    const padding = 30;
    const chartW = w - padding * 2;
    const chartH = h - padding * 2;

    const highs = state.candles.map(c => c.high);
    const lows = state.candles.map(c => c.low);
    const maxVal = Math.max(...highs);
    const minVal = Math.min(...lows);
    const range = maxVal - minVal || 1;

    const getY = (val) => padding + (1 - (val - minVal) / range) * chartH;
    const candleW = chartW / count;

    // Draw Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding + (i / 4) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(w - padding, y);
        ctx.stroke();
    }

    // Draw Candles
    state.candles.forEach((c, i) => {
        const x = padding + i * candleW;
        const oY = getY(c.open);
        const cY = getY(c.close);
        const hY = getY(c.high);
        const lY = getY(c.low);

        const isBull = c.close >= c.open;
        const color = isBull ? '#22c55e' : '#ef4444';

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + candleW / 2, hY);
        ctx.lineTo(x + candleW / 2, lY);
        ctx.stroke();

        // Body
        ctx.fillStyle = color;
        const bodyH = Math.max(1, Math.abs(cY - oY));
        ctx.fillRect(x + 2, Math.min(oY, cY), candleW - 4, bodyH);

        // Update OHLC display for last candle
        if (i === count - 1) {
            dom.candleOHLC.textContent = `O: ${c.open.toFixed(5)} H: ${c.high.toFixed(5)} L: ${c.low.toFixed(5)} C: ${c.close.toFixed(5)}`;
        }
    });
}

// ─── Digit Circle Analysis ──────────────────────────────────────────────────
// ─── Digit Circle Analysis (Deriv Style) ────────────────────────────────────
function updateCircleAnalysis(latestDigit) {
    if (!dom.circleCursor) return;

    // 1. Update Cursor Rotation (Continuous)
    const targetAngle = latestDigit * 36; // 0-9 -> 0-324deg

    if (state.lastCircleDigit === null) {
        state.circleRotation = targetAngle;
    } else {
        // Shortest path rotation
        let diff = targetAngle - (state.circleRotation % 360);
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        state.circleRotation += diff;
    }
    state.lastCircleDigit = latestDigit;
    dom.circleCursor.style.transform = `rotate(${state.circleRotation}deg)`;

    // 2. Highlight Active Digit (pointer position)
    dom.circleDigits.forEach(el => {
        el.classList.remove('active-tick');
        if (parseInt(el.dataset.d) === latestDigit) {
            el.classList.add('active-tick');
        }
    });

    // 3. Update Frequencies & Percentages
    if (state.digits.length === 0) return;

    const counts = new Array(10).fill(0);
    state.digits.forEach(d => counts[d]++);
    const total = state.digits.length;

    let maxPct = 0;
    let minPct = 100;

    // Update percentage labels and find extremes
    dom.circleDigits.forEach(el => {
        const d = parseInt(el.dataset.d);
        const pctEl = el.querySelector('.c-pct');
        const pct = (counts[d] / total * 100);

        if (pctEl) pctEl.textContent = pct.toFixed(1) + '%';

        if (pct > maxPct) maxPct = pct;
        if (pct < minPct) minPct = pct;

        // Reset classes
        el.classList.remove('hot', 'cold');
    });

    // Apply Hot/Cold classes based on extremes
    dom.circleDigits.forEach(el => {
        const d = parseInt(el.dataset.d);
        const pct = (counts[d] / total * 100);

        if (pct === maxPct && maxPct > 0) el.classList.add('hot');
        else if (pct === minPct && minPct < 100) el.classList.add('cold');
    });

    // 4. Update Center Label (Hot Digit)
    const hotDigits = [];
    counts.forEach((c, d) => {
        if ((c / total * 100) === maxPct && c > 0) hotDigits.push(d);
    });

    if (hotDigits.length > 0) {
        dom.hotDigit.textContent = hotDigits[0];
        dom.hotDigit.style.color = 'var(--green)';
    } else {
        dom.hotDigit.textContent = '-';
        dom.hotDigit.style.color = '#fff';
    }
}

// ─── Run all analysis ─────────────────────────────────────────────────────────
function runAnalysis() {
    if (state.prices.length < 5) return;
    updateRiseFall(state.prices);
    updateOverUnder(state.digits);
    updateEvenOdd(state.digits);
    updateMatchesDiffers(state.digits);
    updateAccumulators(state.prices, state.digits);
    updateHigherLower(state.prices);
    updateDigitGrid(state.digits);
    updateHeatmap(state.digits);
    updateStreakGrid(state.digits);
    updateCycleInfo(state.digits);
    drawChart();
}

// ─── Price update ─────────────────────────────────────────────────────────────
function onNewTick(price) {
    const prev = state.lastPrice;

    // Store
    state.prices.push(price);
    if (state.prices.length > MAX_HISTORY) state.prices.shift();

    // Last digit
    const priceStr = price.toString();
    const lastChar = priceStr.replace('.', '').slice(-1);
    const digit = parseInt(lastChar);
    state.digits.push(digit);
    if (state.digits.length > MAX_HISTORY) state.digits.shift();

    state.tickCount++;
    if (state.high === null || price > state.high) state.high = price;
    if (state.low === null || price < state.low) state.low = price;
    state.lastPrice = price;

    // UI — price display
    dom.cpMarket.textContent = state.symbolName;
    dom.cpPrice.textContent = price.toFixed(priceStr.includes('.') ? priceStr.split('.')[1].length : 2);
    dom.cpDigit.innerHTML = `Last digit: <strong>${digit}</strong>`;

    if (prev !== null) {
        const change = price - prev;
        const dir = change >= 0 ? '+' : '';
        dom.cpChange.textContent = dir + change.toFixed(5);
        dom.cpChange.className = change >= 0 ? 'cp-change positive' : 'cp-change negative';

        // Flash
        dom.cpPrice.classList.remove('flash-up', 'flash-down');
        void dom.cpPrice.offsetWidth; // reflow
        dom.cpPrice.classList.add(change >= 0 ? 'flash-up' : 'flash-down');
        setTimeout(() => dom.cpPrice.classList.remove('flash-up', 'flash-down'), 400);
    }

    // Stats
    dom.statTicks.textContent = state.tickCount;
    dom.statHigh.textContent = state.high ? state.high.toFixed(3) : '-';
    dom.statLow.textContent = state.low ? state.low.toFixed(3) : '-';
    dom.statSpread.textContent = (state.high && state.low)
        ? (state.high - state.low).toFixed(3) : '-';

    addToTickStrip(digit);
    updateCircleAnalysis(digit);

    // Run analysis every tick (throttled by requestAnimationFrame)
    requestAnimationFrame(runAnalysis);
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function setStatus(type, label) {
    dom.statusDot.className = 'status-dot ' + type;
    dom.statusLabel.textContent = label;
}

function sendJSON(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
    }
}

function subscribeToSymbol() {
    // Unsubscribe any active
    sendJSON({ forget_all: 'ticks' });

    // First fetch 500 historical ticks
    sendJSON({
        ticks_history: state.symbol,
        count: 500,
        end: 'latest',
        style: 'ticks'
    });

    // Subscribe live ticks
    sendJSON({
        ticks: state.symbol,
        subscribe: 1
    });

    // Subscribe to Candles
    sendJSON({
        ticks_history: state.symbol,
        end: 'latest',
        count: 100,
        granularity: state.candleTimeframe,
        style: 'candles',
        subscribe: 1
    });

    showToast(`Switched to ${state.symbolName}`);
}

function connectWS() {
    setStatus('', 'Connecting…');
    state.ws = new WebSocket(WS_URL);

    state.ws.onopen = () => {
        setStatus('connected', 'Connected');
        subscribeToSymbol();

        // Keep-alive ping every 25 s
        clearInterval(state.pingTimer);
        state.pingTimer = setInterval(() => {
            sendJSON({ ping: 1 });
        }, 25000);
    };

    state.ws.onmessage = evt => {
        const msg = JSON.parse(evt.data);
        if (msg.msg_type === 'history') {
            // Bulk load
            const prices = msg.history.prices;
            prices.forEach(p => {
                const pStr = p.toString();
                const lastCh = pStr.replace('.', '').slice(-1);
                state.prices.push(parseFloat(p));
                state.digits.push(parseInt(lastCh));
                state.tickCount++;
                const fp = parseFloat(p);
                if (state.high === null || fp > state.high) state.high = fp;
                if (state.low === null || fp < state.low) state.low = fp;
            });
            state.lastPrice = state.prices[state.prices.length - 1];
            const lastDigit = state.digits[state.digits.length - 1];
            updateCircleAnalysis(lastDigit);
            runAnalysis();
            showToast(`Loaded ${prices.length} history ticks`);
        } else if (msg.msg_type === 'tick') {
            onNewTick(parseFloat(msg.tick.quote));
        } else if (msg.msg_type === 'ohlc') {
            const o = msg.ohlc;
            const candle = {
                epoch: parseInt(o.open_time),
                open: parseFloat(o.open),
                high: parseFloat(o.high),
                low: parseFloat(o.low),
                close: parseFloat(o.close)
            };
            const idx = state.candles.findIndex(c => c.epoch === candle.epoch);
            if (idx !== -1) {
                state.candles[idx] = candle;
            } else {
                state.candles.push(candle);
                if (state.candles.length > 200) state.candles.shift();
            }
            requestAnimationFrame(drawCandlestickChart);
        } else if (msg.msg_type === 'candles') {
            state.candles = msg.candles.map(c => ({
                epoch: parseInt(c.epoch),
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close)
            }));
            requestAnimationFrame(drawCandlestickChart);
        }
    };

    state.ws.onerror = () => setStatus('disconnected', 'Error');

    state.ws.onclose = () => {
        setStatus('disconnected', 'Disconnected');
        clearInterval(state.pingTimer);
        // Reconnect after 3 s
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connectWS, 3000);
    };
}

// ─── State reset on symbol change ─────────────────────────────────────────────
function resetState() {
    state.prices = [];
    state.digits = [];
    state.tickCount = 0;
    state.high = null;
    state.low = null;
    state.lastPrice = null;
    dom.cpPrice.textContent = '-.----';
    dom.cpDigit.innerHTML = 'Last digit: <strong>-</strong>';
    dom.cpChange.textContent = '±0.00000';
    dom.tickStrip.innerHTML = '';
    dom.statTicks.textContent = '0';
    dom.statHigh.textContent = '-';
    dom.statLow.textContent = '-';
    dom.statSpread.textContent = '-';
}

// ─── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 400);
    }, duration);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initChartTf() {
    dom.tfBtns.forEach(btn => {
        btn.onclick = () => {
            const tf = parseInt(btn.dataset.tf);
            if (state.candleTimeframe === tf) return;

            state.candleTimeframe = tf;
            dom.tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            sendJSON({ forget_all: 'candles' });
            sendJSON({
                ticks_history: state.symbol,
                end: 'latest',
                count: 100,
                granularity: state.candleTimeframe,
                style: 'candles',
                subscribe: 1
            });
            showToast(`Timeframe changed to ${tf === 60 ? '1m' : '15m'}`);
        };
    });
}

// ─── Prediction Tabs Logic ──────────────────────────────────────────────────
function initPredTabs() {
    dom.ptabs.forEach(tab => {
        tab.onclick = () => {
            const target = tab.dataset.tab;

            // Update buttons
            dom.ptabs.forEach(b => b.classList.remove('active'));
            tab.classList.add('active');

            // Update content
            dom.tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `tab-${target}`) {
                    content.classList.add('active');
                }
            });

            showToast(`Switched to ${tab.textContent} prediction`);
        };
    });
}

function init() {
    startClock();
    initParticles();
    initMarketPills();
    initBarrierPills();
    initMdPills();
    initTickCountSelector();
    initChartTf();
    initPredTabs();
    buildDigitGrid();
    buildHeatmap();
    connectWS();

    window.onresize = () => {
        drawChart();
        drawCandlestickChart();
    };
}

document.addEventListener('DOMContentLoaded', init);
