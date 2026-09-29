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

    // 3. Render Top-Right Mini Control HUD
    renderControlHud(root, data);

    // 4. Render SVG Price Projections (1-Month S/R, Entry, SL, Targets, Key Levels)
    if (activeLayers.lines && (data.levels || data.srLevels || data.keyLevels)) {
      renderSvgOverlay(root, rect, data);
    }
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
      sr.intermediatePivot?.price
    ].filter((p) => typeof p === 'number' && !isNaN(p));

    if (prices.length === 0) return;

    const minPx = Math.min(...prices) - 30;
    const maxPx = Math.max(...prices) + 30;
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

  function clearOverlay() {
    currentAnalysis = null;
    const root = document.getElementById('tradesight-overlay-root');
    if (root) root.remove();
  }

  console.info('[TradeSight Nifty] Overlay Renderer initialized on TradingView.');
})();
