/**
 * TradeSight AI - Storage Service
 * Manages configuration, API keys, preferences, and paper trading journal in chrome.storage.local
 */

const STORAGE_KEYS = {
  GEMINI_API_KEY: 'ts_gemini_api_key',
  GEMINI_MODEL: 'ts_gemini_model',
  ACCOUNT_BALANCE: 'ts_account_balance',
  RISK_PERCENT: 'ts_risk_percent',
  AUTO_DRAW_ENABLED: 'ts_auto_draw_enabled',
  TRADE_JOURNAL: 'ts_trade_journal',
  LAST_ANALYSIS: 'ts_last_analysis',
  CUSTOM_PROMPT_EXTRA: 'ts_custom_prompt_extra'
};

const DEFAULT_CONFIG = {
  [STORAGE_KEYS.GEMINI_API_KEY]: '',
  [STORAGE_KEYS.GEMINI_MODEL]: 'gemini-2.5-flash',
  [STORAGE_KEYS.ACCOUNT_BALANCE]: 10000,
  [STORAGE_KEYS.RISK_PERCENT]: 1.0,
  [STORAGE_KEYS.AUTO_DRAW_ENABLED]: true,
  [STORAGE_KEYS.TRADE_JOURNAL]: [],
  [STORAGE_KEYS.CUSTOM_PROMPT_EXTRA]: ''
};

export const StorageService = {
  KEYS: STORAGE_KEYS,

  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] : DEFAULT_CONFIG[key]);
      });
    });
  },

  async getAllConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => {
        resolve({
          apiKey: result[STORAGE_KEYS.GEMINI_API_KEY] || '',
          model: result[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-2.5-flash',
          accountBalance: parseFloat(result[STORAGE_KEYS.ACCOUNT_BALANCE]) || 10000,
          riskPercent: parseFloat(result[STORAGE_KEYS.RISK_PERCENT]) || 1.0,
          autoDrawEnabled: result[STORAGE_KEYS.AUTO_DRAW_ENABLED] !== false,
          customPromptExtra: result[STORAGE_KEYS.CUSTOM_PROMPT_EXTRA] || ''
        });
      });
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    });
  },

  async saveApiKey(key) {
    return this.set(STORAGE_KEYS.GEMINI_API_KEY, (key || '').trim());
  },

  async getApiKey() {
    return this.get(STORAGE_KEYS.GEMINI_API_KEY);
  },

  async saveModel(model) {
    return this.set(STORAGE_KEYS.GEMINI_MODEL, model);
  },

  async getModel() {
    return this.get(STORAGE_KEYS.GEMINI_MODEL);
  },

  async saveLastAnalysis(analysisData) {
    return this.set(STORAGE_KEYS.LAST_ANALYSIS, analysisData);
  },

  async getLastAnalysis() {
    return this.get(STORAGE_KEYS.LAST_ANALYSIS);
  },

  // Trade Journal Methods
  async getJournal() {
    const list = await this.get(STORAGE_KEYS.TRADE_JOURNAL);
    return Array.isArray(list) ? list : [];
  },

  async addJournalEntry(trade) {
    const journal = await this.getJournal();
    const entry = {
      id: 'trade_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      status: 'OPEN', // OPEN | WIN | LOSS | BREAKEVEN | CANCELLED
      outcomePnl: 0,
      notes: '',
      ...trade
    };
    journal.unshift(entry);
    await this.set(STORAGE_KEYS.TRADE_JOURNAL, journal);
    return entry;
  },

  async updateJournalEntry(id, updates) {
    const journal = await this.getJournal();
    const index = journal.findIndex((item) => item.id === id);
    if (index !== -1) {
      journal[index] = { ...journal[index], ...updates };
      await this.set(STORAGE_KEYS.TRADE_JOURNAL, journal);
      return journal[index];
    }
    return null;
  },

  async deleteJournalEntry(id) {
    const journal = await this.getJournal();
    const filtered = journal.filter((item) => item.id !== id);
    await this.set(STORAGE_KEYS.TRADE_JOURNAL, filtered);
    return filtered;
  },

  async clearJournal() {
    return this.set(STORAGE_KEYS.TRADE_JOURNAL, []);
  }
};
