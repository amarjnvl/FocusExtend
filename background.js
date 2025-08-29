// FocusGuard Background Script - Core blocking and timer management

class FocusGuardCore {
  constructor() {
    this.ruleIdCounter = 1;
    this.temporaryUnblocks = new Map(); // Store temporary unblocks
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
      masterPassword: null, // Add password storage
      temporaryUnblocks: {}, // Store temporary unblocks with expiry
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
    this.setupMessageHandlers();
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

  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case "addStrictBlock":
          this.addStrictBlock(request.url, request.duration);
          break;
        case "startFocusSession":
          this.startFocusSession(request.duration, request.whitelist);
          break;
        case "requestTemporaryUnblock":
          this.handleTemporaryUnblockRequest(
            request.url,
            request.password
          ).then((result) => sendResponse(result));
          return true; // Keep message channel open for async response
        case "setMasterPassword":
          this.setMasterPassword(request.password).then((result) =>
            sendResponse(result)
          );
          return true;
      }
    });
  }

  async setMasterPassword(password) {
    if (!password || password.length < 4) {
      return {
        success: false,
        message: "Password must be at least 4 characters",
      };
    }

    // Hash password for basic security (simple hash for demo)
    const hashedPassword = btoa(password + "focusguard_salt");
    await chrome.storage.local.set({ masterPassword: hashedPassword });
    return { success: true, message: "Password set successfully" };
  }

  async verifyPassword(password) {
    const { masterPassword } = await chrome.storage.local.get("masterPassword");

    if (!masterPassword) {
      return false; // No password set
    }

    const hashedInput = btoa(password + "focusguard_salt");
    return hashedInput === masterPassword;
  }

  async handleTemporaryUnblockRequest(url, password) {
    const { masterPassword } = await chrome.storage.local.get("masterPassword");

    // If no password is set, prompt to set one
    if (!masterPassword) {
      return {
        success: false,
        message:
          "No master password set. Please set a password in the extension options first.",
        needsPasswordSetup: true,
      };
    }

    // Verify password
    const isValidPassword = await this.verifyPassword(password);
    if (!isValidPassword) {
      return { success: false, message: "Incorrect password" };
    }

    // Create temporary unblock (15 minutes)
    const expiry = new Date();
    expiry.setTime(expiry.getTime() + 15 * 60 * 1000); // 15 minutes

    const { temporaryUnblocks } = await chrome.storage.local.get(
      "temporaryUnblocks"
    );
    temporaryUnblocks[url] = {
      active: true,
      expiry: expiry.toISOString(),
      created: new Date().toISOString(),
    };

    await chrome.storage.local.set({ temporaryUnblocks });

    // Set alarm to remove temporary unblock
    chrome.alarms.create(`temp_unblock_${url}`, { when: expiry.getTime() });

    // Reload blocking rules
    await this.loadBlockingRules();

    return {
      success: true,
      message: "Site temporarily unblocked for 15 minutes",
    };
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
    } else if (alarm.name.startsWith("temp_unblock_")) {
      const url = alarm.name.replace("temp_unblock_", "");
      await this.removeTemporaryUnblock(url);
    }
  }

  async removeTemporaryUnblock(url) {
    const { temporaryUnblocks } = await chrome.storage.local.get(
      "temporaryUnblocks"
    );
    if (temporaryUnblocks[url]) {
      temporaryUnblocks[url].active = false;
      await chrome.storage.local.set({ temporaryUnblocks });
      await this.loadBlockingRules(); // Reload rules to re-enable blocking
    }
  }

  async handleStorageChange(changes, namespace) {
    if (namespace === "local") {
      if (
        changes.blockedSites ||
        changes.strictBlocks ||
        changes.focusSessions ||
        changes.temporaryUnblocks ||
        changes.whitelist ||
        changes.incognitoBlocked
      ) {
        this.loadBlockingRules();

        // Handle incognito monitoring changes
        if (changes.incognitoBlocked) {
          this.monitorIncognito();
        }
      }
    }
  }

  async handleTabUpdate(tabId, changeInfo, tab) {
    if (changeInfo.url) {
      // Dynamically check focus sessions and whitelist
      const { focusSessions, whitelist } = await chrome.storage.local.get([
        "focusSessions",
        "whitelist",
      ]);

      const activeSessions = Object.values(focusSessions).filter(
        (s) => s.active
      );

      if (activeSessions.length > 0) {
        // Always allow extension pages
        if (changeInfo.url.startsWith(chrome.runtime.getURL(""))) {
          return;
        }

        const isAllowed = this.isUrlInWhitelist(changeInfo.url, whitelist);
        if (!isAllowed) {
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL("blocked.html?reason=focus"),
          });
        }
      }
    }
  }

  async loadBlockingRules() {
    const {
      blockedSites,
      strictBlocks,
      focusSessions,
      temporaryUnblocks,
      whitelist,
    } = await chrome.storage.local.get([
      "blockedSites",
      "strictBlocks",
      "focusSessions",
      "temporaryUnblocks",
      "whitelist",
    ]);

    let rules = [];
    let ruleId = 1;

    // Add normal blocked sites (but skip if temporarily unblocked)
    for (const site of blockedSites) {
      const isTemporarilyUnblocked =
        temporaryUnblocks[site.url] &&
        temporaryUnblocks[site.url].active &&
        new Date(temporaryUnblocks[site.url].expiry) > new Date();

      if (!strictBlocks[site.url] && !isTemporarilyUnblocked) {
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

    // Add strict blocked sites (cannot be temporarily unblocked)
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
      // Get the current whitelist (dynamic)
      const currentWhitelist = [...whitelist];

      // Always include extension pages in whitelist
      const extensionUrl = chrome.runtime.getURL("").replace(/\/$/, "");
      currentWhitelist.push(new URL(extensionUrl).hostname);

      rules.push({
        id: ruleId++,
        priority: 3,
        action: {
          type: "redirect",
          redirect: { url: chrome.runtime.getURL("blocked.html?reason=focus") },
        },
        condition: {
          excludedDomains: currentWhitelist,
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
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace(/^www\./, "");

      return whitelist.some((allowedDomain) => {
        const cleanAllowed = allowedDomain.replace(/^www\./, "");
        return domain === cleanAllowed || domain.endsWith("." + cleanAllowed);
      });
    } catch (e) {
      return false;
    }
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
      created: new Date().toISOString(),
    };

    // Update both focus sessions and whitelist
    await chrome.storage.local.set({
      focusSessions,
      whitelist: whitelist,
    });

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
      try {
        const windows = await chrome.windows.getAll();
        for (const window of windows) {
          if (window.incognito) {
            chrome.windows.remove(window.id).catch(() => {
              // Ignore errors if window already closed
            });
          }
        }
      } catch (error) {
        console.error("Error monitoring incognito windows:", error);
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
