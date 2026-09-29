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

    // 1. Symbol Guard: Check if active chart is NIFTY
    const activeSymbol = data.symbol || extractActiveSymbol();
    const isNifty = isNiftySymbol(activeSymbol);

    if (!isNifty) {
      renderSymbolWarning(root, activeSymbol);
    }

    // 2. Render Live Institutional On-Chart HUD
    renderLiveNiftyHud(root, data, isNifty);

    // 3. Render Top-Right Mini Control HUD
    renderControlHud(root, data);

    // 4. Render SVG Price Projections (Entry, SL, Targets, Key Levels)
    if (activeLayers.lines && data.levels) {
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
      document.querySelector('[data-name="legend-series-item"] [data-name="legend-source-title"]');
    return symbolEl?.textContent?.trim()?.split(' ')?.[0] || 'NIFTY';
  }

  function renderSymbolWarning(root, sym) {
    const warning = document.createElement('div');
    warning.className = 'tradesight-symbol-warning';
    warning.innerHTML = `
      <div class="warning-pill">
        ⚠️ Non-Nifty Asset: "${sym}" — TradeSight AI is calibrated exclusively for <strong>NIFTY 50</strong>. Switch to NIFTY chart for accurate signals.
      </div>
    `;
    root.appendChild(warning);
  }

  function renderLiveNiftyHud(root, data, isNifty) {
    const hud = document.createElement('div');
    hud.className = 'tradesight-nifty-hud';

    const signal = data.signal || 'WAIT';
    const confidence = data.confidence || 0;
    const pressureScore = data.pressureScore !== undefined ? data.pressureScore : 0;
    const regimeLabel = data.regime?.label || 'Nifty 50 Strategy Engine';
    const strategyName = data.strategyName || 'Rule Engine Standing By';

    let signalClass = 'hud-signal-wait';
    if (signal === 'BUY') signalClass = 'hud-signal-buy';
    if (signal === 'SELL') signalClass = 'hud-signal-sell';

    const heroStatus = data.heroZeroStatus || { armed: false, locked: false };
    const countdown = data.countdown || { label: '09:30 ORB / 13:40 Afternoon' };

    hud.innerHTML = `
      <div class="nifty-hud-header">
        <div class="hud-brand">
          <span class="hud-badge">NIFTY 50</span>
          <span class="hud-regime">${regimeLabel}</span>
        </div>
        <div class="hud-pressure ${pressureScore > 15 ? 'bullish' : pressureScore < -15 ? 'bearish' : 'neutral'}">
          Pressure: <strong>${pressureScore > 0 ? '+' : ''}${pressureScore}</strong>
        </div>
      </div>

      <div class="nifty-hud-body">
        <div class="hud-next-move ${signalClass}">
          <div class="move-label">NEXT MOVE</div>
          <div class="move-action">${signal}</div>
          <div class="move-conf">${confidence > 0 ? confidence + '% Conviction' : 'Cash is a Position'}</div>
        </div>

        <div class="hud-meta-col">
          <div class="hud-metric">
            <span class="lbl">STRATEGY</span>
            <span class="val">${strategyName}</span>
          </div>
          ${data.vixSummary ? `
          <div class="hud-metric">
            <span class="lbl">INDIA VIX</span>
            <span class="val">${data.vixSummary}</span>
          </div>` : ''}
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
        <span class="hero-zero-badge ${heroStatus.locked ? 'locked' : heroStatus.armed ? 'armed' : 'standby'}">
          ${heroStatus.locked ? '🔒 HZ Locked' : heroStatus.armed ? '⚡ Hero-Zero Armed' : '⏳ HZ Standby'}
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
      keyLevels.orl
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

    // 1. Draw Opening Range Box (09:15 - 09:30 ORB)
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

    // 2. VWAP Line
    if (keyLevels.vwap) {
      drawHorizontalLine(svg, rect.width, getY(keyLevels.vwap), '#A855F7', `VWAP: ${keyLevels.vwap}`, 'dashed');
    }

    // 3. Day High / Low Lines
    if (keyLevels.pdh) {
      drawHorizontalLine(svg, rect.width, getY(keyLevels.pdh), '#F59E0B', `PDH: ${keyLevels.pdh}`, 'dashed');
    }
    if (keyLevels.pdl) {
      drawHorizontalLine(svg, rect.width, getY(keyLevels.pdl), '#EC4899', `PDL: ${keyLevels.pdl}`, 'dashed');
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
