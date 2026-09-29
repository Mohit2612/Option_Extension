/**
 * TradeSight AI - Chart Detector Content Script
 * Extracts real-time symbol, timeframe, price, and active indicators from TradingView DOM.
 */

(() => {
  if (window.__TradeSightChartDetectorLoaded) return;
  window.__TradeSightChartDetectorLoaded = true;

  // Listen for extraction requests from Side Panel or Background SW
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_CHART_META') {
      try {
        const meta = extractChartMetadata();
        sendResponse({ success: true, meta });
      } catch (err) {
        console.error('[TradeSight AI] Metadata extraction failed:', err);
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
  });

  function extractChartMetadata() {
    // 1. Symbol Extraction
    let symbol = 'UNKNOWN';
    const symbolBtn = document.querySelector('#header-toolbar-symbol-search') ||
      document.querySelector('[data-name="legend-series-item"] [data-name="legend-source-title"]') ||
      document.querySelector('div[class*="symbolTitle-"]') ||
      document.querySelector('button[id*="symbol-search"]');

    if (symbolBtn && symbolBtn.textContent) {
      symbol = symbolBtn.textContent.trim().split(' ')[0].replace(/[^A-Za-z0-9_/.-]/g, '');
    } else {
      // Fallback: Check Document Title (e.g., "EURUSD 1.08450 — TradingView")
      const titleParts = document.title.split('—');
      if (titleParts.length > 0) {
        const candidate = titleParts[0].trim().split(' ')[0];
        if (candidate && candidate.length <= 15) {
          symbol = candidate;
        }
      }
    }

    // 2. Timeframe Extraction
    let timeframe = '15m'; // default fallback
    const intervalBtn = document.querySelector('#header-toolbar-intervals div[class*="isActive-"]') ||
      document.querySelector('div[data-name="intervals-dropdown"] button') ||
      document.querySelector('#header-toolbar-intervals button') ||
      document.querySelector('button[aria-label*="interval" i]');

    if (intervalBtn && intervalBtn.textContent) {
      timeframe = intervalBtn.textContent.trim();
    }

    // 3. Current Visible Price & Legend OHLC Extraction
    let currentPrice = null;
    let candleOHLC = extractLegendOHLC();

    const lastPriceEl = document.querySelector('div[class*="last-"] [class*="value-"]') ||
      document.querySelector('[data-name="legend-series-item"] [class*="value-"]') ||
      document.querySelector('div[class*="price-axis"] div[class*="highlighted-"]');

    if (lastPriceEl && lastPriceEl.textContent) {
      currentPrice = parseFloat(lastPriceEl.textContent.replace(/[^0-9.-]/g, ''));
    }

    if ((!currentPrice || isNaN(currentPrice)) && candleOHLC?.close) {
      currentPrice = candleOHLC.close;
    }

    // Fallback price from title
    if (!currentPrice || isNaN(currentPrice)) {
      const match = document.title.match(/([0-9]+[.,][0-9]+)/);
      if (match) {
        currentPrice = parseFloat(match[1].replace(',', '.'));
      }
    }

    // 4. Visible Indicators in Legend
    const indicators = [];
    const legendItems = document.querySelectorAll('div[data-name="legend-source-item"], div[class*="legendItem-"]');
    legendItems.forEach((item) => {
      const titleEl = item.querySelector('[data-name="legend-source-title"], div[class*="title-"]');
      if (titleEl && titleEl.textContent) {
        const text = titleEl.textContent.trim();
        if (text && !text.includes(symbol) && !indicators.includes(text)) {
          indicators.push(text);
        }
      }
    });

    // 5. Chart Viewport Geometry
    let chartRect = { top: 60, left: 60, width: window.innerWidth - 120, height: window.innerHeight - 100 };
    const chartContainer = document.querySelector('.chart-container') ||
      document.querySelector('.chart-gui-wrapper') ||
      document.querySelector('.layout__area--center');

    if (chartContainer) {
      const r = chartContainer.getBoundingClientRect();
      chartRect = {
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    }

    return {
      symbol: symbol || 'ACTIVE_CHART',
      timeframe: timeframe || '15m',
      currentPrice: currentPrice || null,
      candleOHLC: candleOHLC || null,
      indicators,
      chartRect,
      url: window.location.href,
      timestamp: Date.now()
    };
  }

  function extractLegendOHLC() {
    try {
      const seriesItem = document.querySelector('[data-name="legend-series-item"]');
      if (!seriesItem) return null;

      const valuesWrappers = seriesItem.querySelectorAll('[class*="value-"], [class*="valueValue-"], [class*="itemText-"]');
      const numbers = [];

      valuesWrappers.forEach((el) => {
        const text = el.textContent.trim().replace(/,/g, '');
        const val = parseFloat(text);
        if (!isNaN(val) && val > 0 && text.match(/^[0-9.]+/)) {
          numbers.push(val);
        }
      });

      // Usually TradingView presents O, H, L, C in order
      if (numbers.length >= 4) {
        return {
          open: numbers[0],
          high: numbers[1],
          low: numbers[2],
          close: numbers[3],
          volume: numbers[4] || 0
        };
      }
    } catch (e) {
      // DOM query fallback
    }
    return null;
  }

  console.info('[TradeSight AI] Chart Detector initialized on TradingView.');
})();
