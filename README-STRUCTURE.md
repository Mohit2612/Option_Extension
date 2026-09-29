# TradeSight AI — Structure & Confluence Module

> **Honesty disclaimer**: This module improves setup *selectivity*. It does not improve *certainty*. Every signal can fail. Always define your stop-loss before entering, and never risk more than you can afford to lose. This tool is not financial advice.

---

## Overview

The Structure & Confluence module adds three cooperating engines:

| File | Purpose |
|---|---|
| `indicators/trendlinePro.js` | Pivot-based trendline engine (Breakout, Retest, Sweep, Failed-Break events) |
| `indicators/levelsEngine.js` | Multi-tier S/R Zone engine (Swing pivots, PDH/PDL, ORH/ORL, Round Numbers, VWAP, OI) |
| `confluence/confluenceEngine.js` | Combines both + VWAP, regime, volume, pressure, session into a grade |

All three are **OFF by default**. When disabled they have zero computation footprint.

---

## Module 1 — Trendline Pro Engine

### Presets

| Preset | Left Bars | Right Bars | Use |
|---|---|---|---|
| `NIFTY_5M_FAST` | 10 | 10 | Fast scalp / small structure |
| `NIFTY_5M_STRUCTURE` *(default)* | 30 | 30 | Main intraday structure |
| `NIFTY_15M` | 15 | 15 | Swing / intermediate |

### What it does
- Detects pivot highs/lows using the Pine Script `pivothigh` / `pivotlow` convention.  
- Projects a ray from each confirmed pivot pair to the current bar.  
- Scores quality 0–100 (slope angle, touches, age, zone-band width).

### ⚠ Pivot Confirmation Lag
A pivot is only **confirmed** after `rightBars` additional closed candles. On a 5m chart with the Structure preset, that is **60 bars = 5 hours**. This delay is intentional — it eliminates repainting entirely.

### Event Codes

| Code | Meaning |
|---|---|
| `B▲` | Bullish break — candle **closes** above trendline + ATR buffer |
| `B▼` | Bearish break — candle **closes** below trendline + ATR buffer |
| `RT` | Retest — price revisits broken trendline within retest buffer |
| `FB` | Failed break — price closed through but reversed back inside within N bars |
| `SW` | Sweep — wick through trendline, candle body closed back inside |

Events are **immutable** once written. A reversal adds a new `FB` or `RT` event rather than modifying history.

---

## Module 2 — S/R Zones Engine

### Zone Sources (priority order)

1. **Swing Pivots** — 3 tiers: small (5), medium (10), large (20) bars
2. **Previous Day** — PDH, PDL, PDC
3. **Current Day** — CDH, CDL
4. **Opening Range** — ORH, ORL (first 15-min candle)
5. **Round Numbers** — every 100 pts within 4× ATR, every 50 pts within 4× ATR
6. **External / Order-Flow** — Session VWAP, Anchored VWAP, Call Max-OI, Put Max-OI, Weekly H/L

### Clustering
Candidates within `clusterAtr × ATR` (default 0.25) of each other are merged into a single zone. Zone width is at least `minZoneAtr × ATR`.

### Strength Score (0–100)
Each zone is scored by:
- Number of source types (source diversity bonus)
- Touch count and reaction magnitude
- Age decay (half-life 250 bars)
- Large-gap-open penalty (zones formed yesterday become less reliable after a >0.5% gap)

### Role Flipping
When price **closes beyond a zone + `breakBufferAtr × ATR`**, the zone's role flips: support becomes resistance and vice versa.

### Zone Event Codes

| Code | Meaning |
|---|---|
| `BREAK` | Candle closes beyond zone boundary |
| `RETEST_HOLD` | Price returns to flipped zone and holds |
| `SWEEP` | Wick through zone top/bottom, body closes back inside |
| `REJECTION` | Price bounces ≥ `reactionAtr × ATR` away from zone |

---

## Module 3 — Confluence Engine

### Required for direction ≠ `none`
At least **2 independent structural sources** must agree (trendline + zone, or zone + VWAP side, etc.).

### Scoring (0–100)

| Factor | Max Points |
|---|---|
| Support/Resistance zone confluence | 20 |
| Flipped zone bonus | 10 |
| Trendline confluence | 18 |
| VWAP side agreement | 12 |
| Regime / trend alignment | 12 |
| Volume / momentum | 10 |
| Market Pressure Score | 8 |
| Session time quality | 8 |
| Trendline event bonus (B/RT/SW) | 5 |
| R:R penalty (< minRrRatio) | −15 |
| Obstacle penalty (< 1.0 ATR clearance) | −18 |

### Grades

| Grade | Score | Behaviour |
|---|---|---|
| **A** | ≥ 80 pts | Always allowed |
| **B** | 65–79 pts | Allowed only if user enables Grade B; position size × 0.75 |
| **C** | < 65 pts | Blocked — "Skip this setup" |

> **Obstacle rule**: If an opposing zone sits within `obstacleAtrThreshold × ATR` (default 1.0) of current price, the setup has "no room to run". This incurs the −18 pt penalty and **strictly prevents Grade A**.

---

## Settings Reference

### Trendline Engine

| Setting | Default | Notes |
|---|---|---|
| `leftBars` | 30 | Pivot lookback (left side) |
| `rightBars` | 30 | Pivot confirmation delay (right side) |
| `breakoutAtrBuffer` | 0.10 | ATR multiplier for break confirmation |
| `retestAtrBuffer` | 0.20 | ATR multiplier for valid retest |
| `zoneBandAtr` | 0.20 | Drawing band width around trendline |
| `minTouches` | 2 | Minimum touches for a valid trendline |

### Levels Engine

| Setting | Default | Notes |
|---|---|---|
| `lookbackSmall` | 5 | Small pivot lookback (bars) |
| `lookbackMedium` | 10 | Medium pivot lookback |
| `lookbackLarge` | 20 | Large pivot lookback |
| `clusterAtr` | 0.25 | Merge distance (× ATR) |
| `reactionAtr` | 0.30 | Min bounce for REJECTION event |
| `breakBufferAtr` | 0.10 | Break confirmation buffer |
| `topNZones` | 6 | Max zones shown on panel |

### Confluence Engine

| Setting | Default | Notes |
|---|---|---|
| `gradeAThreshold` | 80 | Minimum score for Grade A |
| `gradeBThreshold` | 65 | Minimum score for Grade B |
| `minRrRatio` | 1.5 | R:R below this → −15 pt penalty |
| `obstacleAtrThreshold` | 1.0 | Opposing zone within this ATR → −18 pt + blocks A |

---

## Live Panel

The **Structure & Confluence** card in the **Next Move** tab shows:

- **TL / S/R toggles** — Enable/disable engines without leaving the tab
- **Confluence Score bar** — Colour-coded by grade (green A / amber B / red C)
- **Direction** — Long / Short / No Bias
- **Nearest Resistance** — Price, distance in pts and ATR multiples, strength score
- **Nearest Support** — Same
- **Active Trendline** — Direction, current projected price, touch count
- **Last Structure Event** — Most recent BREAK / RT / SWEEP event
- **Obstacle Alert** — Amber warning if opposing zone is too close
- **Score Breakdown accordion** — Shows exactly which factors earned/lost points
- **Pivot Lag Notice** — Reminds you of the confirmation delay

---

## Replay & Validation

`tests/structure-replay.test.js` covers:
1. **Event Immutability** — 670 bar-by-bar updates with zero mutations to previously recorded events
2. **Forward Realization Backtest** — Grade A/B/C 1R target performance with time-of-day split
3. **Parameter Sensitivity** — Walk-forward OOS split across Fast / Standard / Structure configs
4. **Schema Consistency** — All events conform to `{id, type, price, timestamp, quality}` schema

Run with:
```bash
node tests/structure-replay.test.js
```

---

## Honesty & Limitations

- **Synthetic backtest only**: The replay test uses algorithmically generated bars, not real tick data. Results show the *mechanics work*, not that they will be profitable in live markets.
- **Grade A is not "safe"**: The confluence score improves selectivity, not certainty. Grade A setups fail regularly.
- **Pivot lag is real**: On the Structure 30/30 preset, trendlines confirm 5 hours late on a 5m chart. This avoids repainting but means you will miss early moves.
- **No "averaging down"**: The engine never suggests adding to a losing position.
- **Not financial advice**: Use this as a decision-support tool only. Always use a hard stop-loss.
