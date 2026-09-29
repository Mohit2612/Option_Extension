/**
 * TradeSight NIFTY 50 - Background Service Worker (Manifest V3)
 * Orchestrates time-aware alarms, session clock scheduler, screenshot captures, and tab messaging.
 */

import { SessionClock } from '../services/sessionClock.js';

// Enable side panel to open on toolbar action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn('[TradeSight AI SW] sidePanel behavior warning:', error));

// Set up 1-minute ticker alarm for IST Market Schedule
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('TRADESIGHT_IST_TICKER', {
    periodInMinutes: 1
  });
  console.info('[TradeSight SW] IST Ticker alarm created (1-min period).');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'TRADESIGHT_IST_TICKER') {
    handleMinuteTick();
  }
});

async function handleMinuteTick() {
  const ist = SessionClock.getIstParts();
  const { hour, minute } = ist;

  // Key Strategy Milestones in IST
  const milestones = [
    { h: 9, m: 15, event: 'MARKET_OPEN_0915' },
    { h: 9, m: 30, event: 'ORB_DAY_PLAN_0930' },
    { h: 13, m: 40, event: 'AFTERNOON_WINDOW_1340' },
    { h: 13, m: 45, event: 'HERO_ZERO_WINDOW_1345' },
    { h: 15, m: 15, event: 'SQUARE_OFF_1515' }
  ];

  const matched = milestones.find((m) => m.h === hour && m.m === minute);
  if (matched) {
    console.info(`[TradeSight SW] Reached IST milestone: ${matched.event}`);
    // Broadcast event to active TradingView tabs and side panel
    notifyTabsAndPanel({
      action: 'IST_MILESTONE_TRIGGER',
      event: matched.event,
      istTime: ist.formattedTime
    });
  }
}

async function notifyTabsAndPanel(message) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.tradingview.com/*' });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
    // Also notify sidepanel if open
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {
    // Ignore inactive message channels
  }
}

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

  if (action === 'GET_IST_CLOCK') {
    sendResponse({ success: true, ist: SessionClock.getIstParts() });
    return false;
  }

  if (action === 'PING') {
    sendResponse({ status: 'ok', timestamp: Date.now() });
    return false;
  }
});

async function handleCaptureVisibleTab(sendResponse) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

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

async function handleGetActiveTab(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sendResponse({ success: true, tab });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleForwardToActiveTab(payload, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, payload);
      sendResponse({ success: true, data: response });
    } catch (msgErr) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/chart-detector.js', 'content/overlay-renderer.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content/overlay.css']
      });

      const retryResponse = await chrome.tabs.sendMessage(tab.id, payload);
      sendResponse({ success: true, data: retryResponse });
    }
  } catch (err) {
    console.error('[TradeSight AI SW] Forwarding error:', err);
    sendResponse({ success: false, error: err.message });
  }
}
