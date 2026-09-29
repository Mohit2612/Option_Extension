/**
 * TradeSight AI - Background Service Worker (Manifest V3)
 * Orchestrates tab management, screenshot capture, panel behavior, and message routing.
 */

// Enable side panel to open on toolbar action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn('[TradeSight AI SW] sidePanel behavior warning:', error));

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, payload } = request;

  if (action === 'CAPTURE_VISIBLE_TAB') {
    handleCaptureVisibleTab(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (action === 'GET_ACTIVE_TAB') {
    handleGetActiveTab(sendResponse);
    return true;
  }

  if (action === 'FORWARD_TO_ACTIVE_TAB') {
    handleForwardToActiveTab(payload, sendResponse);
    return true;
  }

  if (action === 'PING') {
    sendResponse({ status: 'ok', timestamp: Date.now() });
    return false;
  }
});

/**
 * Capture visible tab as high-definition PNG
 */
async function handleCaptureVisibleTab(sendResponse) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    if (!activeTab.url || !activeTab.url.includes('tradingview.com')) {
      sendResponse({
        success: false,
        error: 'Active tab is not a TradingView chart. Please switch to tradingview.com.'
      });
      return;
    }

    // Capture tab view
    const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
      format: 'png',
      quality: 100
    });

    sendResponse({ success: true, dataUrl, tabId: activeTab.id });
  } catch (error) {
    console.error('[TradeSight AI SW] Capture error:', error);
    sendResponse({
      success: false,
      error: `Screen capture failed: ${error.message || 'Check tab permissions'}`
    });
  }
}

/**
 * Retrieve active tab metadata
 */
async function handleGetActiveTab(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sendResponse({ success: true, tab });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Forward message to content script in the active tab (with auto re-injection check)
 */
async function handleForwardToActiveTab(payload, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Attempt sending directly to content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, payload);
      sendResponse({ success: true, data: response });
    } catch (msgErr) {
      // Content script might not be injected yet if page was open prior to extension reload
      console.warn('[TradeSight AI SW] Content script unreachable, attempting injection:', msgErr.message);

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/chart-detector.js', 'content/overlay-renderer.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content/overlay.css']
      });

      // Retry sending message after injection
      const retryResponse = await chrome.tabs.sendMessage(tab.id, payload);
      sendResponse({ success: true, data: retryResponse });
    }
  } catch (err) {
    console.error('[TradeSight AI SW] Forwarding error:', err);
    sendResponse({ success: false, error: err.message });
  }
}
