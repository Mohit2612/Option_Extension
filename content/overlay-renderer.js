/**
 * TradeSight NIFTY 50 - Chart Overlay Renderer Content Script
 * Injects non-destructive SVG layers + Nifty Institutional Live HUD onto TradingView chart.
 */

(() => {
  if (window.__TradeSightNiftyOverlayLoaded) return;
  window.__TradeSightNiftyOverlayLoaded = true;

  let currentAnalysis = null;
  let activeLayers = {
    zones: true,
    lines: true,
    labels: true
  };

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'RENDER_OVERLAY' || request.action === 'RENDER_NIFTY_OVERLAY') {
      try {
        currentAnalysis = request.payload;
        renderFullOverlay(request.payload);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[TradeSight Nifty] Render failed:', err);
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (request.action === 'CLEAR_OVERLAY') {
      clearOverlay();
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'GET_OVERLAY_STATE') {
      sendResponse({ success: true, hasOverlay: !!currentAnalysis, activeLayers });
      return true;
    }
  });

  function getChartContainer() {
    return document.querySelector('.chart-container') ||
      document.querySelector('.chart-gui-wrapper') ||
      document.querySelector('.layout__area--center') ||
      document.body;
  }

  function ensureRoot() {
    let root = document.getElementById('tradesight-overlay-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'tradesight-overlay-root';
      root.className = 'tradesight-overlay-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function renderFullOverlay(data) {
    if (!data) return;

    const root = ensureRoot();
    root.innerHTML = ''; // reset previous layers

    const container = getChartContainer();
    const rect = container.getBoundingClientRect();

    root.style.top = `${Math.max(0, rect.top)}px`;
    root.style.left = `${Math.max(0, rect.left)}px`;
    root.style.width = `${rect.width}px`;
    root.style.height = `${rect.height}px`;

    // 1. Symbol Identification (Universal: Nifty, BankNifty, Stocks, Crypto, Forex)
    const activeSymbol = (data.symbol || extractActiveSymbol()).toUpperCase();
    const isNifty = isNiftySymbol(activeSymbol);

    // 2. Render Universal Live HUD
    renderLiveNiftyHud(root, data, activeSymbol, isNifty);

    // 2b. Render Scalp & Spike HUD if active
    if (data.scalpSetup && data.scalpSetup.isEnabled) {
      renderScalpHud(root, data.scalpSetup);
    }

    // 3. Render Top-Right Mini Control HUD
    renderControlHud(root, data);

    // 4. Render SVG Price Projections (1-Month S/R, Entry, SL, Targets, Key Levels)
    if (activeLayers.lines && (data.levels || data.srLevels || data.keyLevels || data.scalpSetup)) {
      renderSvgOverlay(root, rect, data);
    }

    // 5. Render Floating Candlestick Pattern On-Chart Label
    if (activeLayers.labels && (data.patternName || data.pattern)) {
      renderCandlePatternCallout(root, rect, data);
    }
  }

  function renderCandlePatternCallout(root, rect, data) {
    const patternName = data.patternName || data.pattern?.name || 'Candle Pattern';
    const signal = data.signal || 'WAIT';
    const isBuy = signal === 'BUY';
    const isSell = signal === 'SELL';

    const cardClass = isBuy ? 'buy-signal' : isSell ? 'sell-signal' : 'wait-signal';
    const tagClass = isBuy ? 'buy' : isSell ? 'sell' : 'wait';
    const arrow = isBuy ? '▲' : isSell ? '▼' : '●';

    const wrapper = document.createElement('div');
    wrapper.className = 'ts-candle-callout-wrapper';

    const srLocation = data.srLocation || (data.srLevels ? '1M Support/Resistance' : 'Key Level');
    const levels = data.levels;

    wrapper.innerHTML = `
      <div class="ts-candle-callout-card ${cardClass}">
        <div class="ts-candle-head">
          <div class="ts-candle-title ${tagClass}">
            <span class="ts-candle-pulse-dot"></span>
            <span>${arrow} ${patternName.toUpperCase()}</span>
          </div>
          <span class="ts-candle-action-tag ${tagClass}">${signal}</span>
        </div>
        <div class="ts-candle-body">
          <div class="ts-candle-confluence-badge">
            📍 ${srLocation}
          </div>
          <div style="font-size:10.5px; color:#94A3B8; margin-bottom:4px;">
            ${data.action || (isBuy ? 'Confirmed Institutional Buy at Support' : isSell ? 'Confirmed Institutional Sell at Resistance' : 'Pattern Forming (Wait for S/R)')}
          </div>
          ${levels ? `
            <div class="ts-candle-levels">
              <span>Entry: <strong>${levels.entryPrice}</strong></span>
              <span style="color:#FF3B69">SL: <strong>${levels.stopLoss}</strong></span>
              <span style="color:#00E676">TP1: <strong>${levels.target1}</strong></span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    root.appendChild(wrapper);
  }

  function isNiftySymbol(sym) {
    if (!sym) return false;
    const clean = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.includes('NIFTY') || clean.includes('CNXNIFTY') || clean.includes('INDIA50');
  }

  function extractActiveSymbol() {
    const symbolEl = document.querySelector('#header-toolbar-symbol-search') ||
      document.querySelector('[data-name="legend-series-item"] [data-name="legend-source-title"]') ||
      document.querySelector('button[id*="symbol-search"]');
    return symbolEl?.textContent?.trim()?.split(' ')?.[0] || 'CHART';
  }

  function renderLiveNiftyHud(root, data, activeSymbol, isNifty) {
    const hud = document.createElement('div');
    hud.className = 'tradesight-nifty-hud';

    const signal = data.signal || 'WAIT';
    const confidence = data.confidence || 0;
    const pressureScore = data.pressureScore !== undefined ? data.pressureScore : 0;
    const regimeLabel = data.regime?.label || '1-Month S/R Verified Scan';
    const strategyName = data.strategyName || (data.patternName ? `Pattern: ${data.patternName}` : 'Rule Engine Active');

    let signalClass = 'hud-signal-wait';
    if (signal === 'BUY') signalClass = 'hud-signal-buy';
    if (signal === 'SELL') signalClass = 'hud-signal-sell';

    const heroStatus = data.heroZeroStatus || { armed: false, locked: false };
    const countdown = data.countdown || { label: 'Active Pattern Scanner' };
    const srLocation = data.srLocation || (data.srLevels ? `Sup: ${data.srLevels.majorSupport?.price} | Res: ${data.srLevels.majorResistance?.price}` : '1-Month S/R Active');

    hud.innerHTML = `
      <div class="nifty-hud-header">
        <div class="hud-brand">
          <span class="hud-badge">${activeSymbol}</span>
          <span class="hud-regime">${regimeLabel}</span>
        </div>
        <div class="hud-pressure ${pressureScore > 15 ? 'bullish' : pressureScore < -15 ? 'bearish' : 'neutral'}">
          ${isNifty ? `Pressure: <strong>${pressureScore > 0 ? '+' : ''}${pressureScore}</strong>` : `S/R Verified`}
        </div>
      </div>

      <div class="nifty-hud-body">
        <div class="hud-next-move ${signalClass}">
          <div class="move-label">ACTION</div>
          <div class="move-action">${signal}</div>
          <div class="move-conf">${confidence > 0 ? confidence + '% Conviction' : 'Wait for S/R'}</div>
        </div>

        <div class="hud-meta-col">
          <div class="hud-metric">
            <span class="lbl">PATTERN</span>
            <span class="val" style="color:#00D4FF; font-weight:700;">${data.patternName ? data.patternName : 'Scanning Candles...'}</span>
          </div>
          <div class="hud-metric">
            <span class="lbl">1M S/R CONFLUENCE</span>
            <span class="val" style="color:#FBBF24;">${srLocation}</span>
          </div>
          ${data.levels ? `
          <div class="hud-metric">
            <span class="lbl">EXECUTION</span>
            <span class="val">Entry: <strong>${data.levels.entryPrice}</strong> | SL: <strong style="color:#FF3B69">${data.levels.stopLoss}</strong> | TP1: <strong style="color:#00E676">${data.levels.target1}</strong></span>
          </div>` : ''}
          ${data.invalidation ? `
          <div class="hud-invalidation">
            <strong>Invalidation:</strong> ${data.invalidation}
          </div>` : ''}
        </div>
      </div>

      <div class="hud-extra-row">
        <span class="hero-zero-badge ${isNifty ? (heroStatus.locked ? 'locked' : heroStatus.armed ? 'armed' : 'standby') : 'standby'}">
          ${isNifty ? (heroStatus.locked ? '🔒 HZ Locked' : heroStatus.armed ? '⚡ Hero-Zero Armed' : '⏳ HZ Standby') : '📊 1-Month S/R Confluence'}
        </span>
        <span class="window-countdown-pill">
          ⏱️ ${countdown.label}
        </span>
      </div>
    `;

    root.appendChild(hud);
  }

  function renderControlHud(root, data) {
    const hud = document.createElement('div');
    hud.className = 'tradesight-mini-hud';

    hud.innerHTML = `
      <div class="ts-hud-toggles">
        <button class="ts-hud-btn ${activeLayers.lines ? 'active' : ''}" id="ts-toggle-levels">Levels</button>
        <button class="ts-hud-btn ${activeLayers.labels ? 'active' : ''}" id="ts-toggle-labels">Badges</button>
        <button class="ts-hud-btn ts-hud-btn-danger" id="ts-clear-btn" title="Clear Overlay">✕</button>
      </div>
    `;

    root.appendChild(hud);

    hud.querySelector('#ts-toggle-levels').addEventListener('click', (e) => {
      e.stopPropagation();
      activeLayers.lines = !activeLayers.lines;
      renderFullOverlay(currentAnalysis);
    });

    hud.querySelector('#ts-toggle-labels').addEventListener('click', (e) => {
      e.stopPropagation();
      activeLayers.labels = !activeLayers.labels;
      renderFullOverlay(currentAnalysis);
    });

    hud.querySelector('#ts-clear-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearOverlay();
    });
  }

  function renderSvgOverlay(root, rect, data) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tradesight-svg-canvas');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const levels = data.levels || {};
    const keyLevels = data.keyLevels || {};
    const sr = data.srLevels || {};

    // Collect all visible price points for coordinate mapping
    const prices = [
      levels.entryPrice,
      levels.stopLoss,
      levels.target1,
      levels.target2,
      keyLevels.vwap,
      keyLevels.pdh,
      keyLevels.pdl,
      keyLevels.orh,
      keyLevels.orl,
      sr.majorResistance?.price,
      sr.majorSupport?.price,
      sr.intermediatePivot?.price,
      data.scalpSetup?.readiness?.compressionHigh,
      data.scalpSetup?.readiness?.compressionLow,
      data.scalpSetup?.entryPrice,
      data.scalpSetup?.stopLoss,
      data.scalpSetup?.target1
    ];

    if (data.indicators && data.indicators.masterEnabled && Array.isArray(data.indicators.drawings)) {
      data.indicators.drawings.forEach((d) => {
        if (typeof d.y1 === 'number') prices.push(d.y1);
        if (typeof d.y2 === 'number') prices.push(d.y2);
      });
    }

    const validPrices = prices.filter((p) => typeof p === 'number' && !isNaN(p));
    if (validPrices.length === 0) return;

    const minPx = Math.min(...validPrices) - 30;
    const maxPx = Math.max(...validPrices) + 30;
    const range = Math.max(10, maxPx - minPx);

    const getY = (p) => {
      const normalized = (p - minPx) / range;
      const y = rect.height * (1.0 - normalized);
      return Math.max(25, Math.min(rect.height - 25, y));
    };

    // 1. Draw 1-Month Major Support & Resistance Zones
    if (sr.majorResistance?.price) {
      drawHorizontalLine(svg, rect.width, getY(sr.majorResistance.price), '#FF3B69', `1M RES: ${sr.majorResistance.price} [Tested ${sr.majorResistance.testedCount || 3}x]`, 'dashed');
    }
    if (sr.majorSupport?.price) {
      drawHorizontalLine(svg, rect.width, getY(sr.majorSupport.price), '#00E676', `1M SUP: ${sr.majorSupport.price} [Tested ${sr.majorSupport.testedCount || 4}x]`, 'dashed');
    }
    if (sr.intermediatePivot?.price) {
      drawHorizontalLine(svg, rect.width, getY(sr.intermediatePivot.price), '#00D4FF', `1M PIVOT: ${sr.intermediatePivot.price}`, 'dashed');
    }

    // 2. Draw Opening Range Box (09:15 - 09:30 ORB)
    const orh = keyLevels.orh;
    const orl = keyLevels.orl;
    if (orh && orl && orh > orl) {
      const yHigh = getY(orh);
      const yLow = getY(orl);
      const boxHeight = Math.max(4, yLow - yHigh);

      const orbBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      orbBox.setAttribute('x', '60');
      orbBox.setAttribute('y', yHigh.toString());
      orbBox.setAttribute('width', (rect.width - 130).toString());
      orbBox.setAttribute('height', boxHeight.toString());
      orbBox.setAttribute('fill', 'rgba(0, 212, 255, 0.06)');
      orbBox.setAttribute('stroke', 'rgba(0, 212, 255, 0.3)');
      orbBox.setAttribute('stroke-width', '1');
      orbBox.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(orbBox);

      // ORB Midpoint line
      const orMid = (orh + orl) / 2;
      drawHorizontalLine(svg, rect.width, getY(orMid), '#64748B', `ORB MID: ${orMid.toFixed(1)}`, 'dashed');
      drawHorizontalLine(svg, rect.width, yHigh, '#00D4FF', `ORH: ${orh}`, 'solid');
      drawHorizontalLine(svg, rect.width, yLow, '#00D4FF', `ORL: ${orl}`, 'solid');
    }

    // 3. VWAP Line
    if (keyLevels.vwap) {
      drawHorizontalLine(svg, rect.width, getY(keyLevels.vwap), '#A855F7', `VWAP: ${keyLevels.vwap}`, 'dashed');
    }

    // 4. Execution Levels: Entry, SL, TP1, TP2
    if (levels.entryPrice) {
      drawHorizontalLine(svg, rect.width, getY(levels.entryPrice), '#00D4FF', `ENTRY: ${levels.entryPrice}`, 'dashed');
    }
    if (levels.stopLoss) {
      drawHorizontalLine(svg, rect.width, getY(levels.stopLoss), '#FF3B69', `SL: ${levels.stopLoss}`, 'solid');
    }
    if (levels.target1) {
      drawHorizontalLine(svg, rect.width, getY(levels.target1), '#00E676', `TP1: ${levels.target1} [1:2.0]`, 'dashed');
    }
    if (levels.target2) {
      drawHorizontalLine(svg, rect.width, getY(levels.target2), '#00E676', `TP2: ${levels.target2} [Runner]`, 'dashed');
    }

    // 5. Scalp Compression Zone Box & Watched Level
    if (data.scalpSetup && data.scalpSetup.isEnabled && data.scalpSetup.readiness) {
      const r = data.scalpSetup.readiness;
      if (r.compressionHigh && r.compressionLow && r.compressionHigh > r.compressionLow) {
        const yTop = getY(r.compressionHigh);
        const yBottom = getY(r.compressionLow);
        const compHeight = Math.max(4, yBottom - yTop);

        const compBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        compBox.setAttribute('x', '70');
        compBox.setAttribute('y', yTop.toString());
        compBox.setAttribute('width', (rect.width - 140).toString());
        compBox.setAttribute('height', compHeight.toString());
        compBox.setAttribute('fill', r.state === 'SPIKE_RISK_HIGH' ? 'rgba(255, 59, 105, 0.08)' : 'rgba(251, 191, 36, 0.08)');
        compBox.setAttribute('stroke', r.state === 'SPIKE_RISK_HIGH' ? '#FF3B69' : '#FBBF24');
        compBox.setAttribute('stroke-width', '1.5');
        compBox.setAttribute('stroke-dasharray', '3 3');
        svg.appendChild(compBox);

        drawHorizontalLine(svg, rect.width, (yTop + yBottom) / 2, r.state === 'SPIKE_RISK_HIGH' ? '#FF3B69' : '#FBBF24', `SPIKE WATCH ZONE (${r.compressionPts} pts)`, 'dashed');
      }
    }

    // 6. Technical Indicators (NSDT Auto S/R & Pivot Trendlines 30/30)
    if (data.indicators && data.indicators.masterEnabled && Array.isArray(data.indicators.drawings)) {
      const drawings = data.indicators.drawings;

      // Draw Cluster Zones
      drawings.filter((d) => d.type === 'ZONE_BOX' && d.y2 !== undefined).forEach((d) => {
        const yTop = getY(d.y1);
        const yBottom = getY(d.y2);
        const boxHeight = Math.max(3, yBottom - yTop);

        const rectBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rectBox.setAttribute('x', '60');
        rectBox.setAttribute('y', yTop.toString());
        rectBox.setAttribute('width', (rect.width - 130).toString());
        rectBox.setAttribute('height', boxHeight.toString());
        rectBox.setAttribute('fill', d.color);
        rectBox.setAttribute('stroke', '#FBBF24');
        rectBox.setAttribute('stroke-width', '1');
        rectBox.setAttribute('stroke-dasharray', '4 4');
        svg.appendChild(rectBox);
      });

      // Draw NSDT Lines
      drawings.filter((d) => d.type === 'HORIZONTAL_LINE').forEach((d) => {
        const y = getY(d.y1);
        drawHorizontalLine(svg, rect.width, y, d.color, d.label, d.style);
      });

      // Draw 30/30 Trendlines
      drawings.filter((d) => d.type === 'TRENDLINE' && d.y2 !== undefined).forEach((d) => {
        const yStart = getY(d.y1);
        const yEnd = getY(d.y2);
        const xStart = 80;
        const xEnd = rect.width - 80;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', xStart.toString());
        line.setAttribute('y1', yStart.toString());
        line.setAttribute('x2', xEnd.toString());
        line.setAttribute('y2', yEnd.toString());
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', (d.width || 2).toString());
        if (d.style === 'dashed') line.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(line);

        // Trendline Label Badge at termination
        if (d.label) {
          const badgeW = d.label.length * 6.5 + 14;
          const badgeX = xEnd - badgeW;
          const badgeY = yEnd - 10;

          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('x', badgeX.toString());
          bg.setAttribute('y', badgeY.toString());
          bg.setAttribute('width', badgeW.toString());
          bg.setAttribute('height', '20');
          bg.setAttribute('rx', '4');
          bg.setAttribute('fill', '#0B0F19');
          bg.setAttribute('stroke', d.color);
          bg.setAttribute('stroke-width', '1');
          svg.appendChild(bg);

          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', (badgeX + badgeW / 2).toString());
          txt.setAttribute('y', (badgeY + 14).toString());
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('fill', d.color);
          txt.setAttribute('font-size', '10');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
          txt.textContent = d.label;
          svg.appendChild(txt);
        }
      });
    }

    root.appendChild(svg);
  }

  function drawHorizontalLine(svg, width, y, color, labelText, style) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '50');
    line.setAttribute('y1', y.toString());
    line.setAttribute('x2', (width - 70).toString());
    line.setAttribute('y2', y.toString());
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    if (style === 'dashed') line.setAttribute('stroke-dasharray', '6 4');
    svg.appendChild(line);

    // Label Badge
    const badgeW = labelText.length * 7.5 + 16;
    const badgeX = width - 70 - badgeW;
    const badgeY = y - 11;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', badgeX.toString());
    bg.setAttribute('y', badgeY.toString());
    bg.setAttribute('width', badgeW.toString());
    bg.setAttribute('height', '22');
    bg.setAttribute('rx', '4');
    bg.setAttribute('fill', '#0B0F19');
    bg.setAttribute('stroke', color);
    bg.setAttribute('stroke-width', '1.5');
    svg.appendChild(bg);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', (badgeX + badgeW / 2).toString());
    txt.setAttribute('y', (badgeY + 15).toString());
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', color);
    txt.setAttribute('font-size', '11');
    txt.setAttribute('font-weight', '700');
    txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    txt.textContent = labelText;
    svg.appendChild(txt);
  }

  function renderScalpHud(root, scalpSetup) {
    const existing = document.getElementById('tradesight-scalp-spike-hud');
    if (existing) existing.remove();

    if (!scalpSetup || !scalpSetup.isEnabled) return;

    const readiness = scalpSetup.readiness || { score: 0, state: 'CALM', stateLabel: 'CALM', directionLean: 'UNCLEAR' };
    const trigger = scalpSetup.trigger || { isTriggered: false, direction: 'NONE', triggerType: 'NONE' };
    const isTriggered = scalpSetup.isActionable && trigger.isTriggered;

    let stateColor = '#94A3B8';
    let pulseClass = '';

    if (readiness.state === 'SPIKE_RISK_HIGH') {
      stateColor = '#FF3B69';
      pulseClass = 'tradesight-pulse-crimson';
    } else if (readiness.state === 'BUILDING') {
      stateColor = '#FBBF24';
      pulseClass = 'tradesight-pulse-amber';
    }

    const hud = document.createElement('div');
    hud.id = 'tradesight-scalp-spike-hud';
    hud.className = `tradesight-scalp-hud ${pulseClass}`;

    const topFactors = (readiness.factors || []).slice(0, 2).map((f) => `${f.name}: +${f.weightedScore.toFixed(0)}`).join(' • ');

    hud.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:5px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:11px; font-weight:800; color:#00D4FF;">⚡ SPIKE WATCH</span>
          <span style="font-size:9.5px; padding:1px 5px; border-radius:3px; font-weight:800; border:1px solid ${stateColor}; color:${stateColor};">
            ${readiness.stateLabel}
          </span>
        </div>
        <div style="font-size:12px; font-weight:900; color:${stateColor};">
          ${readiness.score}/100
        </div>
      </div>
      <div style="font-size:10px; color:#94A3B8; margin-bottom:4px; display:flex; justify-content:space-between;">
        <span>Watched: <strong>${readiness.watchedKeyLevel || 'Pivot'}</strong> (${(readiness.distanceToLevel || 0).toFixed(1)}p)</span>
        <span style="color:${readiness.directionLean === 'UP' ? '#00E676' : readiness.directionLean === 'DOWN' ? '#FF3B69' : '#CBD5E1'}; font-weight:700;">
          Lean: ${readiness.directionLean}
        </span>
      </div>
      ${topFactors ? `<div style="font-size:9px; color:#64748B; margin-bottom:5px;">Drivers: ${topFactors}</div>` : ''}
      ${isTriggered ? `
        <div style="background:rgba(0,230,118,0.12); border:1px solid #00E676; border-radius:6px; padding:6px 8px; margin-top:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:#00E676; font-size:11px;">🚀 SCALP ${scalpSetup.direction} TRIGGERED</strong>
            <span style="font-size:9px; color:#FBBF24; font-weight:800;">Net 1:${scalpSetup.costAnalysis?.netRR || '1.5'} R</span>
          </div>
          <div style="font-size:9.5px; color:#CBD5E1; margin-top:2px;">
            Entry: ${scalpSetup.entryPrice} | SL: ${scalpSetup.stopLoss} | T1: ${scalpSetup.target1}
          </div>
          <div style="font-size:8.5px; color:#94A3B8; margin-top:2px;">
            ${scalpSetup.costAnalysis?.summaryMessage || 'Friction charges factored.'}
          </div>
        </div>
      ` : `
        <div style="background:rgba(255,255,255,0.03); border:1px dashed #334155; border-radius:5px; padding:4px 6px; font-size:9px; color:#94A3B8; margin-top:4px;">
          Awaiting confirmation trigger: Breakout > 1.2x ATR with volume surge.
        </div>
      `}
    `;

    root.appendChild(hud);
  }

  function clearOverlay() {
    currentAnalysis = null;
    const root = document.getElementById('tradesight-overlay-root');
    if (root) root.remove();
  }

  console.info('[TradeSight Nifty] Overlay Renderer initialized on TradingView.');
})();
