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

    const levels = data.levels;
    if (!levels) return;

    // Anchor prices relative to current visible bounds
    const prices = [levels.entryPrice, levels.stopLoss, levels.target1, levels.target2].filter(Boolean);
    const minPx = Math.min(...prices) - 25;
    const maxPx = Math.max(...prices) + 25;
    const range = Math.max(10, maxPx - minPx);

    const getY = (p) => {
      const normalized = (p - minPx) / range;
      const y = rect.height * (1.0 - normalized);
      return Math.max(30, Math.min(rect.height - 30, y));
    };

    // Entry Line (Cyan)
    if (levels.entryPrice) {
      drawHorizontalLine(svg, rect.width, getY(levels.entryPrice), '#00D4FF', `ENTRY: ${levels.entryPrice}`, 'dashed');
    }

    // Stop Loss Line (Red)
    if (levels.stopLoss) {
      drawHorizontalLine(svg, rect.width, getY(levels.stopLoss), '#FF3B69', `SL: ${levels.stopLoss}`, 'solid');
    }

    // Target 1 Line (Green)
    if (levels.target1) {
      drawHorizontalLine(svg, rect.width, getY(levels.target1), '#00E676', `TP1: ${levels.target1} [1:2.0]`, 'dashed');
    }

    // Target 2 Line (Green)
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
