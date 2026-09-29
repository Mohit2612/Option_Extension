# TradeSight AI — Dedicated NIFTY 50 Institutional Engine

> **30-Year Veteran Indian Index Trader & Chrome Extension Engine (Manifest V3)**  
> Engineered exclusively for **NSE: NIFTY 50** (spot, futures, and weekly/monthly options). Continuous chart reading, mathematical pattern recognition, market driver synthesis (India VIX & cross-assets), and live on-chart NEXT MOVE (`BUY` / `SELL` / `WAIT`) signals.

---

## 📸 Extension Visual Previews

### 1. Injected TradingView Chart Overlay & Live Institutional HUD
![TradeSight TradingView Live Chart Overlay](screenshots/chart_overlay_preview.jpg)

### 2. Side Panel Interface — Next Move & Market Pressure Score
![TradeSight NIFTY 50 Side Panel](screenshots/sidepanel_preview.jpg)

---

## 🏛️ Architecture Overview & Folder Structure

```
c:\Mohit\Forex_Extension\
├── manifest.json                        # Manifest V3 declaration
├── config/
│   └── nifty-config.js                  # Master thresholds (VIX, IST market hours, Nifty lot size)
├── patterns/
│   └── pattern-engine.js                # Deterministic pattern detection (Single, Two, Three-candle)
├── drivers/
│   └── driver-engine.js                 # 9 market drivers & Market Pressure Score (-100 to +100)
├── strategies/
│   └── strategy-engine.js               # 7 Nifty strategies, regime classifier & no-trade filters
├── overlay/
│   └── nifty-overlay.js                 # TradingView on-chart live HUD, level projection & audio alerts
├── journal/
│   └── nifty-journal.js                 # Verified trade journal & historical candle backtesting simulator
├── content/
│   ├── chart-detector.js                # TradingView DOM extractor (Nifty symbol, interval, live price)
│   ├── overlay-renderer.js              # Injected SVG drawing canvas & non-repainting level plots
│   └── overlay.css                      # Injected HUD & non-Nifty warning styling
├── ui/
│   ├── sidepanel.html                   # 5-Tab Institutional Terminal (Next Move, Drivers, Strategies, Journal, Config)
│   ├── sidepanel.css                    # Bloomberg/TradingView dark theme with pressure meter
│   └── sidepanel.js                     # Side panel controller wiring all 5 engines
├── prompts/
│   └── trader-system-prompt.js          # Nifty 50 veteran trader system prompt for AI commentary
├── screenshots/
│   ├── chart_overlay_preview.jpg        # TradingView chart with live HUD and overlays
│   └── sidepanel_preview.jpg            # Side panel Next Move & Pressure Meter
├── tests/
│   ├── pattern-engine.test.js           # 11 unit tests for candlestick patterns & location filtering
│   └── strategy-engine.test.js          # Unit tests for ORB, Liquidity Sweep & no-trade filters
└── README.md
```

---

## 🧠 Core Modules

### 1. Module 1: NIFTY Driver Engine (Market Pressure Score)
Computes a **Market Pressure Score from -100 (Very Bearish) to +100 (Very Bullish)** by synthesizing:
1. **India VIX (`NSE:INDIAVIX`)**: Inverse correlation check, 20-day SMA spike alert, and complacency trap check.
2. **Global Cues**: GIFT Nifty pre-market gap, US S&P/Nasdaq futures, Nikkei & Hang Seng.
3. **Currency & Rates**: USD/INR stability and US 10Y Treasury yields (rising yields = FII outflow pressure).
4. **Brent Crude Oil**: Impact on India's import bill and inflation.
5. **Institutional Flow**: FII/DII net cash flow & FII index futures Long/Short ratio.
6. **Heavyweights**: HDFC Bank, Reliance, ICICI Bank, Infosys, TCS, ITC, L&T, Bharti Airtel + Bank Nifty relative strength.
7. **Options Chain**: PCR, Max Call OI resistance, Max Put OI support, Max Pain.

### 2. Module 2: Candlestick Pattern Engine
- Pure mathematical functions with body/wick ratios and ATR-relative thresholds.
- Single candle: Hammer, Inverted Hammer, Hanging Man, Shooting Star, Doji (Standard, Dragonfly, Gravestone, Long-Legged), Marubozu, Belt Hold, Spinning Top.
- Two candle: Bullish/Bearish Engulfing, Piercing Line, Dark Cloud Cover, Harami & Cross, Tweezer Top/Bottom, Inside/Outside Bar, Kicker.
- Three candle: Morning/Evening Star & Doji Star, Three White Soldiers, Three Black Crows, Three Inside Up/Down, Abandoned Baby.
- **Location Confluence Rule**: A pattern is actionable **only** within $0.25\%$ distance from key levels (VWAP, PDH, PDL, ORH, ORL, Max OI strikes). Patterns in the middle of nowhere are automatically filtered.

### 3. Module 3: Strategy Engine
- **Market Regime Classifier**: Trending Up, Trending Down, Range, High-Volatility Chop.
- **7 Defined Institutional Strategies**:
  1. Opening Range Breakout (ORB) (09:20 - 11:15 IST)
  2. VWAP Trend Pullback / Reversion
  3. 9/21 EMA Trend Momentum
  4. S/R & Liquidity Sweep Reversal (Sell-side / Buy-side trap)
  5. Breakout-Retest Confirmation
  6. Gap-and-Go Momentum Continuation
  7. Expiry Day Special (Thursdays - Max Pain magnetic pull)
- **Non-Negotiable No-Trade Filters**: First 5 minutes opening volatility (09:15-09:20), lunch-hour chop (11:30-13:30), 2 daily losses hard stop, and strict minimum 1:2 Risk:Reward.

### 4. Module 4: TradingView Chart Overlay
- Non-destructive injected SVG canvas layer.
- On-Chart Live Institutional HUD: NEXT MOVE (`BUY` / `SELL` / `WAIT`), Pressure Score, Strategy name, and Invalidation line.
- Symbol Guard: Automatically alerts if a non-Nifty chart is open.
- Audio Alert: Synthesizes audio chime upon fresh signal detection.

### 5. Module 5: Verified Journal & Backtest Simulator
- Paper-trading mode enabled by default.
- Tracks Win Rate %, Average R-multiple, Max Drawdown in R, and performance breakdown by Strategy and Time-of-Day.
- Historical Backtest Simulator to test strategy expectancy across historical Nifty bars.

---

### 6. Module A: Hero-Zero (Expiry-Day Gamma) Engine
- **Concept**: High-payoff, low-probability expiry day directional bet. Treated mathematically as a fixed, pre-accepted loss.
- **Activation Conditions**:
  1. Today is confirmed Nifty Expiry Day (dynamic check via `ExpiryCalendar`).
  2. Time window: 13:45 - 14:45 IST (peak gamma and institutional unwinding).
  3. Regime is NOT "Range/Chop". Must be directional momentum or breakout.
  4. At least 3 confluences: Day H/L breakout, momentum candle, VWAP hold, VIX confirmation, OI unwinding, heavyweight confirmation.
- **Strike Selection**: Premium range ₹5 to ₹40; prefers 1-3 strikes OTM with bid-ask liquidity; delta estimation; displays exact index points needed to double premium ($Pts_{2x} = Premium / Delta$).
- **Mandatory Risk Rules**: Max 0.5%–1% capital risk per trade; hard stop at 50% of premium or index trigger candle; partial profit taking at 2x premium; 15:15 IST time exit; hard lockout after 2 failed Hero-Zero trades.
- **Scoreboard**: Dedicated Hero-Zero scorecard in Journal tracking win rate, average win vs loss, and net expectancy with mandatory reality check banner.

### 7. Module B: 09:15 AM / First 15-Minute Candle Strategy
- **Opening Structure**: Synthesizes 09:15 - 09:30 IST candle. Analyzes gap classification (Gap & Go, Gap Fill, Gap Trap), body/wick ratios, and compression/exhaustion filters.
- **09:30 IST Sharp Day Plan**: Outputs directional bias, Key Levels (ORH, ORL, Midpoint, PDH, PDL, VWAP), and trigger conditions.
- **Sub-Setups**:
  1. Opening Range Breakout (ORB): 5m candle close beyond 15m range (not a wick). Stop Loss at Midpoint or Opposite range; Targets at 1x and 2x range.
  2. Failed-Breakout Reversal (Trap): 1-2 candle false break outside ORB closing back inside.
  3. Gap-Fill Setup: Rejection candle at opening extreme into previous day close.
- **Trade Management**: Move SL to cost after 1x range target; 45-minute time stop.

### 8. Module C: 1:40 PM Afternoon Strategy (Experimental)
- **Concept**: Captures the institutional positioning and post-lunch volume expansion between 13:40 - 14:30 IST.
- **Scenarios**:
  1. Compression Breakout: Tight consolidation between 12:00 - 13:40 (< ATR/points threshold) breaking out with volume.
  2. VWAP Trend Continuation: Pullback to VWAP/EMA in lunch phase followed by momentum confirmation.
  3. Extreme Reversal: Sweep of day high/low with rejection pattern and VIX/OI confirmation.
- **Hero-Zero Bridge**: Strong directional signals on expiry days feed directly into Module A as a confluence trigger.

---

## ⚙️ Foundation Services
1. `services/sessionClock.js`: Strict IST (`Asia/Kolkata`, UTC+5:30) conversion from exchange candle timestamps. Enforces market open, milestone alerts, and square-off rules.
2. `services/expiryCalendar.js`: Dynamic Thursday expiry schedule, holiday prepone resolution, monthly vs weekly expiry resolver, and lot size lookup.
3. `services/riskManager.js`: Daily loss circuit breaker, max trades limiter, Hero-Zero 2-loss lockout, and lot calculation based on pre-accepted premium risk.
4. `services/optionChain.js`: 1–3 step OTM strike selection within ₹5–₹40 premium band, delta estimation, required points to double ($Pts_{2x} = \frac{Premium}{\Delta}$), and liquidity rating.
5. `services/supportResistanceEngine.js`: 1-Month Historical Support & Resistance Verification Engine. Computes 30-day High, Low, Equilibrium Pivot, Major Resistance (R1 tested 3x), and Major Support (S1 tested 4x). Validates candlestick pattern location and confirms high-probability BUY/SELL trades strictly at S/R floors and ceilings.

---

## 🧪 Comprehensive Testing Suite

Run all test suites locally with Node.js:
```bash
# 1. Candlestick Pattern Engine Tests (11 Tests)
node tests/pattern-engine.test.js

# 2. Base Strategy Engine Tests
node tests/strategy-engine.test.js

# 3. Time-Aware Strategy Suite (Modules A, B, C & Foundation Services - 7 Tests)
node tests/time-strategies.test.js

# 4. 1-Month Support/Resistance & Pattern Verification Tests (5 Tests)
node tests/support-resistance.test.js
```

---

## 🛡️ 3-Phase Testing & Execution Plan
1. **Phase 1: Paper Trading (Minimum 30 Sessions)**
   - Run the extension live on TradingView in Paper Trading mode (`ts_nifty_journal_v2`).
   - Log all signals across morning ORB, 1:40 PM afternoon setups, and Thursday Hero-Zero gamma trades.
2. **Phase 2: Empirical Backtest & Expectancy Verification**
   - Review the verified Journal & Hero-Zero Scoreboard after 30+ sessions.
   - Verify that positive expectancy is sustained ($E = [Win\% \times AvgWin] - [Loss\% \times AvgLoss] > 0$) with Max Drawdown within acceptable bounds.
3. **Phase 3: Controlled Live Capital Deployment**
   - Only after Phase 2 proves positive expectancy, start with minimal risk (single lot, $\le 0.5\%$ capital risk per trade).
   - Strict stop for the day upon 2 consecutive losses or daily loss limit breach.

---

## ⚖️ Non-Financial Advice Disclaimer
TradeSight NIFTY 50 is a quantitative decision-support tool. Trading index derivatives involves substantial risk of capital loss. Past backtested performance is no guarantee of future results. Never risk capital you cannot afford to lose.

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select this directory (`c:\Mohit\Forex_Extension`).
4. Open [tradingview.com/chart](https://www.tradingview.com/chart/?symbol=NSE%3ANIFTY).
5. Click the TradeSight extension icon to open the Side Panel.
6. Click **EVALUATE NIFTY NEXT MOVE** to run the scan!

---

## 🧪 Automated Unit Test Suites

Run the test suites locally via Node:
```powershell
node tests/pattern-engine.test.js
node tests/strategy-engine.test.js
```
All 15 automated unit tests pass with 100% success.
