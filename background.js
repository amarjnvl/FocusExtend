// FocusGuard Background Script - Core blocking and timer management

class FocusGuardCore {
  constructor() {
    this.ruleIdCounter = 1;
    this.init();
  }

  async init() {
    // Initialize storage structure
    const defaultSettings = {
      blockedSites: [],
      strictBlocks: {},
      whitelist: [],
      focusSessions: {},
      incognitoBlocked: false,
      disableUnlocked: false,
      disableChallenge: null,
    };

    const stored = await chrome.storage.local.get(Object.keys(defaultSettings));
    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
      if (stored[key] === undefined) {
        await chrome.storage.local.set({ [key]: defaultValue });
      }
    }

    this.setupEventListeners();
    this.loadBlockingRules();
    this.checkStrictTimers();
    this.monitorIncognito();
  }

  setupEventListeners() {
    // Handle window creation for incognito blocking
    chrome.windows.onCreated.addListener(this.handleWindowCreated.bind(this));

    // Handle alarms for timers
    chrome.alarms.onAlarm.addListener(this.handleAlarm.bind(this));

    // Handle storage changes
    chrome.storage.onChanged.addListener(this.handleStorageChange.bind(this));

    // Handle tab updates for focus mode
    chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
  }

  async handleWindowCreated(window) {
    const { incognitoBlocked } = await chrome.storage.local.get(
      "incognitoBlocked"
    );

    if (incognitoBlocked && window.incognito) {
      // Close incognito window immediately
      chrome.windows.remove(window.id);

      // Create a regular window with blocked page
      chrome.windows.create({
        url: chrome.runtime.getURL("blocked.html?reason=incognito"),
        type: "normal",
      });
    }
  }

  async handleAlarm(alarm) {
    if (alarm.name.startsWith("strict_")) {
      const siteUrl = alarm.name.replace("strict_", "");
      await this.removeStrictBlock(siteUrl);
    } else if (alarm.name.startsWith("focus_")) {
      const sessionId = alarm.name.replace("focus_", "");
      await this.endFocusSession(sessionId);
    }
  }

  async handleStorageChange(changes, namespace) {
    if (namespace === "local") {
      if (
        changes.blockedSites ||
        changes.strictBlocks ||
        changes.focusSessions
      ) {
        this.loadBlockingRules();
      }
    }
  }

  async handleTabUpdate(tabId, changeInfo, tab) {
    if (changeInfo.url) {
      const { focusSessions } = await chrome.storage.local.get("focusSessions");
      const activeSessions = Object.values(focusSessions).filter(
        (s) => s.active
      );

      if (activeSessions.length > 0) {
        const isAllowed = this.isUrlInWhitelist(
          changeInfo.url,
          activeSessions[0].whitelist
        );
        if (!isAllowed) {
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL("blocked.html?reason=focus"),
          });
        }
      }
    }
  }

  async loadBlockingRules() {
    const { blockedSites, strictBlocks, focusSessions } =
      await chrome.storage.local.get([
        "blockedSites",
        "strictBlocks",
        "focusSessions",
      ]);

    let rules = [];
    let ruleId = 1;

    // Add normal blocked sites
    for (const site of blockedSites) {
      if (!strictBlocks[site.url]) {
        rules.push({
          id: ruleId++,
          priority: 1,
          action: {
            type: "redirect",
            redirect: {
              url: chrome.runtime.getURL(
                "blocked.html?reason=normal&site=" +
                  encodeURIComponent(site.url)
              ),
            },
          },
          condition: {
            urlFilter: this.createUrlFilter(site.url),
            resourceTypes: ["main_frame"],
          },
        });
      }
    }

    // Add strict blocked sites
    for (const [url, blockData] of Object.entries(strictBlocks)) {
      if (blockData.active && new Date(blockData.expiry) > new Date()) {
        rules.push({
          id: ruleId++,
          priority: 2,
          action: {
            type: "redirect",
            redirect: {
              url: chrome.runtime.getURL(
                "blocked.html?reason=strict&site=" + encodeURIComponent(url)
              ),
            },
          },
          condition: {
            urlFilter: this.createUrlFilter(url),
            resourceTypes: ["main_frame"],
          },
        });
      }
    }

    // Add focus session rules
    const activeSessions = Object.values(focusSessions).filter((s) => s.active);
    if (activeSessions.length > 0) {
      const session = activeSessions[0];
      rules.push({
        id: ruleId++,
        priority: 3,
        action: {
          type: "redirect",
          redirect: { url: chrome.runtime.getURL("blocked.html?reason=focus") },
        },
        condition: {
          excludedDomains: session.whitelist,
          resourceTypes: ["main_frame"],
        },
      });
    }

    // Update declarative net request rules
    const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
    const currentRuleIds = currentRules.map((rule) => rule.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: currentRuleIds,
      addRules: rules,
    });
  }

  createUrlFilter(url) {
    // Create a comprehensive URL filter that catches the domain and all subdomains
    const cleanUrl = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    return `*://*.${cleanUrl}/*`;
  }

  isUrlInWhitelist(url, whitelist) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, "");

    return whitelist.some((allowedDomain) => {
      const cleanAllowed = allowedDomain.replace(/^www\./, "");
      return domain === cleanAllowed || domain.endsWith("." + cleanAllowed);
    });
  }

  async addStrictBlock(url, duration) {
    const expiry = new Date();
    expiry.setTime(expiry.getTime() + duration);

    const { strictBlocks } = await chrome.storage.local.get("strictBlocks");
    strictBlocks[url] = {
      active: true,
      expiry: expiry.toISOString(),
      created: new Date().toISOString(),
    };

    await chrome.storage.local.set({ strictBlocks });

    // Set alarm for when block expires
    chrome.alarms.create(`strict_${url}`, { when: expiry.getTime() });

    // Also store in IndexedDB as backup (persists even if extension is uninstalled)
    this.storeInIndexedDB("strictBlocks", strictBlocks);
  }

  async removeStrictBlock(url) {
    const { strictBlocks } = await chrome.storage.local.get("strictBlocks");
    if (strictBlocks[url]) {
      strictBlocks[url].active = false;
      await chrome.storage.local.set({ strictBlocks });
      chrome.alarms.clear(`strict_${url}`);
    }
  }

  async startFocusSession(duration, whitelist) {
    const sessionId = "session_" + Date.now();
    const expiry = new Date();
    expiry.setTime(expiry.getTime() + duration);

    const { focusSessions } = await chrome.storage.local.get("focusSessions");

    // End any existing sessions
    for (const id of Object.keys(focusSessions)) {
      if (focusSessions[id].active) {
        focusSessions[id].active = false;
        chrome.alarms.clear(`focus_${id}`);
      }
    }

    focusSessions[sessionId] = {
      active: true,
      expiry: expiry.toISOString(),
      whitelist: whitelist,
      created: new Date().toISOString(),
    };

    await chrome.storage.local.set({ focusSessions });
    chrome.alarms.create(`focus_${sessionId}`, { when: expiry.getTime() });

    return sessionId;
  }

  async endFocusSession(sessionId) {
    const { focusSessions } = await chrome.storage.local.get("focusSessions");
    if (focusSessions[sessionId]) {
      focusSessions[sessionId].active = false;
      await chrome.storage.local.set({ focusSessions });
      chrome.alarms.clear(`focus_${sessionId}`);
    }
  }

  async checkStrictTimers() {
    // Check for any strict blocks that should still be active (including after reinstall)
    const indexedDBBlocks = await this.getFromIndexedDB("strictBlocks");
    const { strictBlocks } = await chrome.storage.local.get("strictBlocks");

    let updated = false;
    for (const [url, blockData] of Object.entries(indexedDBBlocks || {})) {
      if (blockData.active && new Date(blockData.expiry) > new Date()) {
        strictBlocks[url] = blockData;
        chrome.alarms.create(`strict_${url}`, {
          when: new Date(blockData.expiry).getTime(),
        });
        updated = true;
      }
    }

    if (updated) {
      await chrome.storage.local.set({ strictBlocks });
    }
  }

  async monitorIncognito() {
    const { incognitoBlocked } = await chrome.storage.local.get(
      "incognitoBlocked"
    );
    if (incognitoBlocked) {
      // Check for existing incognito windows and close them
      const windows = await chrome.windows.getAll();
      for (const window of windows) {
        if (window.incognito) {
          chrome.windows.remove(window.id);
        }
      }
    }
  }

  // IndexedDB operations for persistence across reinstalls
  storeInIndexedDB(key, data) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FocusGuardDB", 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["settings"], "readwrite");
        const store = transaction.objectStore("settings");
        store.put({ id: key, data: data });
        transaction.oncomplete = () => resolve();
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("settings", { keyPath: "id" });
      };
    });
  }

  getFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FocusGuardDB", 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["settings"], "readonly");
        const store = transaction.objectStore("settings");
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          resolve(getRequest.result ? getRequest.result.data : null);
        };
      };
    });
  }
}

// Initialize the extension
new FocusGuardCore();