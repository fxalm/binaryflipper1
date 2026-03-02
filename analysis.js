/**
 * analysis.js — BINARYFLIPPER TOOL
 * Prediction algorithms: RSI, streak analysis, digit frequency,
 * momentum, and composite scoring for Rise/Fall, Over/Under, Even/Odd.
 */

'use strict';

// ─── RSI (Relative Strength Index) ────────────────────────────────────────────
function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

// ─── SMA (Simple Moving Average) ──────────────────────────────────────────────
function computeSMA(arr, period) {
  if (arr.length < period) return null;
  const slice = arr.slice(arr.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─── Momentum: slope of recent prices ─────────────────────────────────────────
function computeMomentum(prices, lookback = 10) {
  if (prices.length < lookback) return 0;
  const recent = prices.slice(prices.length - lookback);
  const n = recent.length;
  // Least-squares slope
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += recent[i];
    sumXY += i * recent[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return parseFloat(slope.toFixed(6));
}

// ─── Rise /Fall analysis ──────────────────────────────────────────────────────
function analyzeRiseFall(prices) {
  if (prices.length < 20) {
    return {
      signal: 'WAIT', risePct: 50, fallPct: 50, confidence: 0,
      rsi: null, streak: 0, momentum: 0
    };
  }

  // Count direction changes
  let rises = 0, falls = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) rises++;
    else if (prices[i] < prices[i - 1]) falls++;
  }
  const total = rises + falls || 1;

  // RSI
  const rsi = computeRSI(prices, Math.min(14, Math.floor(prices.length / 3)));

  // Momentum
  const momentum = computeMomentum(prices, Math.min(15, prices.length));

  // Current streak
  let streak = 0;
  let streakDir = prices[prices.length - 1] > prices[prices.length - 2] ? 'RISE' : 'FALL';
  for (let i = prices.length - 1; i > 0; i--) {
    const dir = prices[i] > prices[i - 1] ? 'RISE' : 'FALL';
    if (dir === streakDir) streak++;
    else break;
  }

  // Composite score (higher = more RISE)
  let score = 50;

  // RSI weight
  if (rsi !== null) {
    if (rsi < 35) score += 18;
    else if (rsi < 45) score += 8;
    else if (rsi > 65) score -= 18;
    else if (rsi > 55) score -= 8;
  }

  // Historical ratio weight
  const riseRatio = rises / total;
  score += (riseRatio - 0.5) * 30;

  // Momentum weight
  if (momentum > 0) score += Math.min(12, momentum * 1e4);
  else score -= Math.min(12, Math.abs(momentum) * 1e4);

  // Streak reversal: if streak is long, favour opposite
  if (streak >= 5) {
    if (streakDir === 'RISE') score -= 12;
    else score += 12;
  }

  score = Math.max(5, Math.min(95, score));

  const risePct = Math.round(score);
  const fallPct = 100 - risePct;

  let signal, confidence;
  if (risePct >= 70) { signal = 'STRONG RISE'; confidence = risePct; }
  else if (risePct >= 58) { signal = 'RISE'; confidence = risePct; }
  else if (fallPct >= 70) { signal = 'STRONG FALL'; confidence = fallPct; }
  else if (fallPct >= 58) { signal = 'FALL'; confidence = fallPct; }
  else { signal = 'NEUTRAL'; confidence = Math.max(risePct, fallPct); }

  return { signal, risePct, fallPct, confidence, rsi, streak, momentum };
}

// ─── Over / Under analysis ────────────────────────────────────────────────────
function analyzeOverUnder(digits, barrier) {
  if (digits.length < 10) {
    return {
      signal: 'WAIT', overPct: 50, underPct: 50, confidence: 0,
      freq: 0, streak: 0
    };
  }

  // Frequency: how often digit <= barrier
  const underCount = digits.filter(d => d <= barrier).length;
  const overCount = digits.length - underCount;
  const n = digits.length;

  const underFreq = underCount / n;    // historical prob of UNDER
  const overFreq = overCount / n;    // historical prob of OVER

  // Current streak
  let streak = 0;
  const lastOver = digits[digits.length - 1] > barrier;
  let streakDir = lastOver ? 'OVER' : 'UNDER';
  for (let i = digits.length - 1; i >= 0; i--) {
    const isOver = digits[i] > barrier;
    if ((isOver && streakDir === 'OVER') || (!isOver && streakDir === 'UNDER')) streak++;
    else break;
  }

  // Score: start from historical freq
  let overScore = overFreq * 100;

  // Streak reversal logic
  const expectedStreakLen = 1 / Math.max(overFreq, underFreq, 0.1);
  if (streak > expectedStreakLen * 1.5) {
    // Streak is unusually long — reversion likely
    if (streakDir === 'OVER') overScore -= 15;
    else overScore += 15;
  }

  // Recent 20 bias
  if (digits.length >= 20) {
    const recent20 = digits.slice(-20);
    const r20Under = recent20.filter(d => d <= barrier).length / 20;
    overScore = overScore * 0.6 + (1 - r20Under) * 100 * 0.4;
  }

  overScore = Math.max(5, Math.min(95, overScore));
  const underScore = 100 - overScore;

  let signal, confidence;
  const overPct = Math.round(overScore);
  const underPct = 100 - overPct;

  if (overPct >= 68) { signal = 'OVER'; confidence = overPct; }
  else if (underPct >= 68) { signal = 'UNDER'; confidence = underPct; }
  else { signal = 'NEUTRAL'; confidence = Math.max(overPct, underPct); }

  return {
    signal, overPct, underPct, confidence,
    freq: Math.round(underFreq * 100), streak
  };
}

// ─── Even / Odd analysis ──────────────────────────────────────────────────────
function analyzeEvenOdd(digits) {
  if (digits.length < 10) {
    return {
      signal: 'WAIT', evenPct: 50, oddPct: 50, confidence: 0,
      evenCount: 0, oddCount: 0, streak: 0
    };
  }

  const evenCount = digits.filter(d => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  const n = digits.length;

  const evenFreq = evenCount / n;

  // Current streak
  let streak = 0;
  const lastEven = digits[digits.length - 1] % 2 === 0;
  const streakType = lastEven ? 'EVEN' : 'ODD';
  for (let i = digits.length - 1; i >= 0; i--) {
    const isEven = digits[i] % 2 === 0;
    if ((isEven && streakType === 'EVEN') || (!isEven && streakType === 'ODD')) streak++;
    else break;
  }

  // Start from historical rate
  let evenScore = evenFreq * 100;

  // Recent 20 adjustment
  if (digits.length >= 20) {
    const recent20 = digits.slice(-20);
    const r20Even = recent20.filter(d => d % 2 === 0).length / 20;
    evenScore = evenScore * 0.5 + r20Even * 100 * 0.5;
  }

  // Long streak reversion
  if (streak >= 5) {
    if (streakType === 'EVEN') evenScore -= 12;
    else evenScore += 12;
  }

  evenScore = Math.max(5, Math.min(95, evenScore));
  const oddScore = 100 - evenScore;

  const evenPct = Math.round(evenScore);
  const oddPct = 100 - evenPct;

  let signal, confidence;
  if (evenPct >= 62) { signal = 'EVEN'; confidence = evenPct; }
  else if (oddPct >= 62) { signal = 'ODD'; confidence = oddPct; }
  else { signal = 'NEUTRAL'; confidence = Math.max(evenPct, oddPct); }

  return { signal, evenPct, oddPct, confidence, evenCount, oddCount, streak };
}

// ─── Digit frequency table ────────────────────────────────────────────────────
function digitFrequency(digits) {
  const freq = new Array(10).fill(0);
  digits.forEach(d => freq[d]++);
  return freq;
}

// ─── Pattern cycle detector (runs within last N digits) ───────────────────────
function detectCycle(digits, windowSize = 50) {
  if (digits.length < windowSize) return null;
  const recent = digits.slice(-windowSize);
  const freq = digitFrequency(recent);
  const max = Math.max(...freq);
  const min = Math.min(...freq);
  const hotDigit = freq.indexOf(max);
  const coldDigit = freq.indexOf(min);
  const evenRate = recent.filter(d => d % 2 === 0).length / recent.length;
  return {
    hotDigit,
    coldDigit,
    hotCount: max,
    coldCount: min,
    evenRate: (evenRate * 100).toFixed(1),
    oddRate: ((1 - evenRate) * 100).toFixed(1)
  };
}

// ─── Streak analysis per outcome ─────────────────────────────────────────────
function computeStreaks(digits) {
  const streaks = {
    currentEven: 0, maxEven: 0,
    currentOdd: 0, maxOdd: 0,
    currentHigh: 0, maxHigh: 0,   // digits 5-9
    currentLow: 0, maxLow: 0,   // digits 0-4
  };
  digits.forEach(d => {
    if (d % 2 === 0) { streaks.currentEven++; streaks.currentOdd = 0; }
    else { streaks.currentOdd++; streaks.currentEven = 0; }
    if (d >= 5) { streaks.currentHigh++; streaks.currentLow = 0; }
    else { streaks.currentLow++; streaks.currentHigh = 0; }
    streaks.maxEven = Math.max(streaks.maxEven, streaks.currentEven);
    streaks.maxOdd = Math.max(streaks.maxOdd, streaks.currentOdd);
    streaks.maxHigh = Math.max(streaks.maxHigh, streaks.currentHigh);
    streaks.maxLow = Math.max(streaks.maxLow, streaks.currentLow);
  });
  return streaks;
}

// ─── Matches / Differs analysis ───────────────────────────────────────────────
/**
 * Predicts which digit is most / least likely to appear next (Matches/Differs).
 * Returns:
 *   matchDigit   – the digit to BET MATCHES on (highest probability)
 *   differsDigit – the digit to BET DIFFERS on (lowest probability / coldest)
 *   digitScores  – score[0..9] composite probability
 *   confidence   – 0-100
 *   signal       – 'MATCHES <d>' | 'DIFFERS <d>' | 'NEUTRAL'
 *   targetDigit  – the single digit the signal refers to
 *   lastGaps     – how many ticks since each digit last appeared
 */
function analyzeMatchesDiffers(digits, targetDigit = null) {
  if (digits.length < 20) {
    return {
      signal: 'WAIT', matchDigit: null, differsDigit: null,
      digitScores: new Array(10).fill(10), confidence: 0, targetDigit: null, lastGaps: new Array(10).fill(0)
    };
  }

  const n = digits.length;
  const recent = digits.slice(-Math.min(200, n));

  // --- Frequency score (last 100 ticks) ---
  const freq100 = new Array(10).fill(0);
  const sample100 = digits.slice(-100);
  sample100.forEach(d => freq100[d]++);

  // --- Recency score (last 20 ticks, exponentially weighted) ---
  const recency = new Array(10).fill(0);
  const last20 = digits.slice(-20);
  last20.forEach((d, i) => { recency[d] += (i + 1) / 20; }); // newer = higher weight

  // --- Gap score: ticks since each digit last appeared (longer gap = more due) ---
  const lastGaps = new Array(10).fill(recent.length);
  for (let d = 0; d <= 9; d++) {
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === d) { lastGaps[d] = recent.length - 1 - i; break; }
    }
  }

  // --- Current streak per digit ---
  const streakBoost = new Array(10).fill(0);
  const lastD = digits[digits.length - 1];
  let streakLen = 0;
  for (let i = digits.length - 1; i >= 0 && digits[i] === lastD; i--) streakLen++;
  // If a digit has a long streak, slightly reduce its score (reversion)
  if (streakLen >= 3) streakBoost[lastD] = -streakLen * 2;

  // --- Composite score [0..9] ---
  const scores = new Array(10).fill(0);
  for (let d = 0; d <= 9; d++) {
    const freqPct = (freq100[d] / 100) * 100;            // 0-10 normally
    const gapScore = Math.min(lastGaps[d] * 1.5, 25);     // longer gap → higher
    const recScore = recency[d] * 30;                      // 0-30
    scores[d] = freqPct * 2 + gapScore + recScore + streakBoost[d];
  }

  // Normalise to 0-100 range
  const maxS = Math.max(...scores);
  const minS = Math.min(...scores);
  const range = maxS - minS || 1;
  const normScores = scores.map(s => Math.max(2, Math.min(98, ((s - minS) / range) * 96 + 2)));

  // Best match digit (highest score)
  const matchDigit = normScores.indexOf(Math.max(...normScores));
  // Best differs digit (lowest score = least likely to appear)
  const differsDigit = normScores.indexOf(Math.min(...normScores));

  // Confidence: how far apart the top digit is from the average
  const avg = normScores.reduce((a, b) => a + b, 0) / 10;
  const confidence = Math.min(95, Math.round(normScores[matchDigit] - avg));

  // If a specific targetDigit was selected, report match/differs for it
  let signal, sigTarget;
  if (targetDigit !== null) {
    const tScore = normScores[targetDigit];
    if (tScore >= 65) { signal = `MATCHES ${targetDigit}`; sigTarget = targetDigit; }
    else if (tScore <= 35) { signal = `DIFFERS ${targetDigit}`; sigTarget = targetDigit; }
    else { signal = 'NEUTRAL'; sigTarget = targetDigit; }
  } else {
    // Auto: recommend the hottest digit for MATCHES
    const confScore = normScores[matchDigit];
    if (confScore >= 65) { signal = `MATCHES ${matchDigit}`; sigTarget = matchDigit; }
    else { signal = `DIFFERS ${differsDigit}`; sigTarget = differsDigit; }
  }

  return {
    signal, matchDigit, differsDigit,
    digitScores: normScores.map(s => Math.round(s)),
    confidence,
    targetDigit: sigTarget,
    lastGaps
  };
}

// ─── Accumulators signal analysis ─────────────────────────────────────────────
/**
 * Accumulators: bet on price staying within a barrier range.
 * We score market conditions: low volatility + stable trend = BUY ACCUMULATORS
 * High volatility or strong trend = WAIT / CAUTION.
 *
 * Returns:
 *   signal         – 'BUY' | 'CAUTION' | 'WAIT'
 *   growthRate     – recommended growth rate % (1,2,3,4,5)
 *   safeTicks      – estimated safe ticks before knock-out risk rises
 *   volatilityScore – 0-100 (lower = calmer)
 *   trendStrength  – 0-100 (lower = more ranging)
 *   confidence     – 0-100
 *   reason         – short human-readable rationale
 */
function analyzeAccumulators(prices, digits) {
  if (prices.length < 30) {
    return {
      signal: 'WAIT', growthRate: 1, safeTicks: 0,
      volatilityScore: 50, trendStrength: 50, confidence: 0,
      reason: 'Need more data'
    };
  }

  const recent = prices.slice(-50);
  const n = recent.length;

  // --- Volatility: normalised std-dev of price changes ---
  const changes = [];
  for (let i = 1; i < n; i++) changes.push(Math.abs(recent[i] - recent[i - 1]));
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const meanPrice = recent.reduce((a, b) => a + b, 0) / n;
  const volatilityRaw = (avgChange / (meanPrice || 1)) * 1e5; // normalised pips
  const volatilityScore = Math.min(100, Math.round(volatilityRaw * 10));

  // --- Trend strength: compare SMA20 vs SMA5 divergence ---
  const sma5 = computeSMA(prices, 5) || 0;
  const sma20 = computeSMA(prices, 20) || 0;
  const smaDivPct = Math.abs(sma5 - sma20) / (meanPrice || 1) * 1e4;
  const trendStrength = Math.min(100, Math.round(smaDivPct * 5));

  // --- RSI distance from 50 (how directional is the market) ---
  const rsi = computeRSI(prices, Math.min(14, Math.floor(prices.length / 2))) || 50;
  const rsiExtremeScore = Math.abs(rsi - 50) * 2; // 0 at 50, 100 at 0 or 100

  // --- Even/Odd balance (stable market tends toward equilibrium) ---
  const eoBalance = Math.abs(50 - digits.slice(-50).filter(d => d % 2 === 0).length * 2); // 0=balanced

  // --- Composite calm score (higher = calmer = good for accumulators) ---
  const calmScore = 100
    - volatilityScore * 0.4
    - trendStrength * 0.3
    - rsiExtremeScore * 0.2
    - eoBalance * 0.1;

  const finalCalm = Math.max(0, Math.min(100, Math.round(calmScore)));

  // --- Recommendation ---
  let signal, growthRate, safeTicks, reason;

  if (finalCalm >= 65) {
    signal = 'BUY';
    growthRate = finalCalm >= 80 ? 5 : finalCalm >= 72 ? 4 : 3;
    safeTicks = Math.round(finalCalm * 0.6);
    reason = 'Low volatility · Ranging market · Safe entry';
  } else if (finalCalm >= 45) {
    signal = 'CAUTION';
    growthRate = 2;
    safeTicks = Math.round(finalCalm * 0.3);
    reason = 'Moderate conditions · Reduce stake · Short hold';
  } else {
    signal = 'WAIT';
    growthRate = 1;
    safeTicks = 0;
    reason = 'High volatility or strong trend · Avoid entry';
  }

  return {
    signal, growthRate, safeTicks,
    volatilityScore,
    trendStrength,
    confidence: finalCalm,
    rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
    reason
  };
}

// ─── Higher / Lower analysis ──────────────────────────────────────────────────
/**
 * Predicts whether the price at the end of N ticks will be HIGHER or LOWER
 * than the current price (entry).
 *
 * Signals: 'STRONG HIGHER' | 'HIGHER' | 'STRONG LOWER' | 'LOWER' | 'NEUTRAL' | 'WAIT'
 */
function analyzeHigherLower(prices) {
  if (prices.length < 25) {
    return {
      signal: 'WAIT', higherPct: 50, lowerPct: 50,
      confidence: 0, rsi: null, smaTrend: 'FLAT', momentum: 0
    };
  }

  const n = prices.length;

  // ── SMA trend (5 vs 20) ──
  const sma5 = computeSMA(prices, 5);
  const sma20 = computeSMA(prices, 20);
  const smaTrend = sma5 > sma20 ? 'UP' : sma5 < sma20 ? 'DOWN' : 'FLAT';

  // ── RSI ──
  const rsi = computeRSI(prices, Math.min(14, Math.floor(n / 3)));

  // ── Momentum (linear slope) ──
  const momentum = computeMomentum(prices, Math.min(20, n));

  // ── Higher/Lower ratio over recent window ──
  const window = Math.min(50, n - 1);
  const entry = prices[n - 1 - window];
  let higherCount = 0, lowerCount = 0;
  for (let i = n - window; i < n; i++) {
    if (prices[i] > entry) higherCount++;
    else if (prices[i] < entry) lowerCount++;
  }
  const total = higherCount + lowerCount || 1;
  const historicalHigherRate = higherCount / total;

  // ── Composite score (50 = neutral, >50 = HIGHER favoured) ──
  let score = 50;

  // SMA trend weight
  if (smaTrend === 'UP') score += 15;
  if (smaTrend === 'DOWN') score -= 15;

  // RSI weight
  if (rsi !== null) {
    if (rsi < 30) score += 18;   // oversold → higher likely
    else if (rsi < 45) score += 8;
    else if (rsi > 70) score -= 18;   // overbought → lower likely
    else if (rsi > 55) score -= 8;
  }

  // Historical ratio weight
  score += (historicalHigherRate - 0.5) * 25;

  // Momentum weight
  if (momentum > 0) score += Math.min(12, momentum * 1e4);
  else score -= Math.min(12, Math.abs(momentum) * 1e4);

  // Recent price vs SMA20 (price above SMA20 → bullish)
  if (sma20) {
    const priceVsSma = (prices[n - 1] - sma20) / sma20 * 1e4;
    score += Math.max(-10, Math.min(10, priceVsSma));
  }

  score = Math.max(5, Math.min(95, score));

  const higherPct = Math.round(score);
  const lowerPct = 100 - higherPct;

  let signal, confidence;
  if (higherPct >= 72) { signal = 'STRONG HIGHER'; confidence = higherPct; }
  else if (higherPct >= 58) { signal = 'HIGHER'; confidence = higherPct; }
  else if (lowerPct >= 72) { signal = 'STRONG LOWER'; confidence = lowerPct; }
  else if (lowerPct >= 58) { signal = 'LOWER'; confidence = lowerPct; }
  else { signal = 'NEUTRAL'; confidence = Math.max(higherPct, lowerPct); }

  return {
    signal, higherPct, lowerPct, confidence,
    rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
    smaTrend, momentum
  };
}

// ─── Prediction time estimator ─────────────────────────────────────────────────
/**
 * Converts a confidence score into a human-readable prediction timeframe.
 *
 * @param {number} confidence  – 0-100
 * @param {string} symbol      – e.g. 'R_10', '1HZ10V', 'JD50'
 * @returns {{ ticks: number, display: string }}
 *
 * Tick intervals:
 *   1HZ* (1-second markets) → 1 s/tick
 *   R_*  (standard vol)     → 2 s/tick
 *   JD*  (Jump indices)     → 2 s/tick
 */
function estimatePredictionTime(confidence, symbol) {
  // Tick count scales with confidence
  let ticks;
  if (confidence >= 80) ticks = Math.round(10 + (confidence - 80) * 0.5);
  else if (confidence >= 65) ticks = Math.round(5 + (confidence - 65) * 0.33);
  else if (confidence >= 50) ticks = Math.round(2 + (confidence - 50) * 0.2);
  else ticks = 2;

  // Seconds per tick by market type
  let secPerTick = 2;
  if (typeof symbol === 'string' && symbol.startsWith('1HZ')) secPerTick = 1;

  const totalSec = ticks * secPerTick;

  let display;
  if (totalSec < 60) {
    display = `~${totalSec}s`;
  } else if (totalSec < 3600) {
    const mins = Math.round(totalSec / 60);
    display = `~${mins} min`;
  } else {
    const hrs = (totalSec / 3600).toFixed(1);
    display = `~${hrs} hr`;
  }

  return { ticks, display };
}

// Export to global scope (no module system in plain HTML)
window.DerivAnalysis = {
  computeRSI, computeSMA, computeMomentum,
  analyzeRiseFall, analyzeOverUnder, analyzeEvenOdd,
  digitFrequency, detectCycle, computeStreaks,
  analyzeMatchesDiffers, analyzeAccumulators,
  analyzeHigherLower, estimatePredictionTime
};
