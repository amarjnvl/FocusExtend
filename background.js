// FocusGuard Background Script - YouTube Selective Blocking with declarativeNetRequest

class FocusGuardCore {
  constructor() {
    this.init();
  }

  async init() {
    const defaultSettings = {
      focusSession: {
        active: false,
        expiry: null,
        whitelist: [],
        youtubeAllowed: [],
      },
    };

    const stored = await chrome.storage.local.get(Object.keys(defaultSettings));
    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
      if (stored[key] === undefined) {
        await chrome.storage.local.set({ [key]: defaultValue });
      }
    }

    this.setupEventListeners();
    this.loadBlockingRules();
  }

  setupEventListeners() {
    chrome.alarms.onAlarm.addListener(this.handleAlarm.bind(this));

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "startFocusSession") {
        this.startFocusSession(
          request.duration,
          request.whitelist,
          request.youtubeAllowed
        );
      }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "local" && changes.focusSession) {
        this.loadBlockingRules();
      }
    });
  }

  parseYouTubeUrl(url) {
    try {
      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
      const pathname = urlObj.pathname;
      const searchParams = urlObj.searchParams;

      // Playlist
      if (searchParams.has("list")) {
        return { type: "playlist", id: searchParams.get("list") };
      }

      // Video
      if (searchParams.has("v")) {
        return { type: "video", id: searchParams.get("v") };
      }

      // Channel patterns
      if (pathname.startsWith("/channel/")) {
        return {
          type: "channel",
          id: pathname.split("/channel/")[1].split("/")[0],
        };
      }

      if (pathname.startsWith("/c/")) {
        return {
          type: "channel",
          handle: pathname.split("/c/")[1].split("/")[0],
        };
      }

      if (pathname.startsWith("/@")) {
        return {
          type: "channel",
          handle: pathname.split("/@")[1].split("/")[0],
        };
      }
    } catch (e) {
      // Handle raw IDs
      if (url.startsWith("UC") && url.length === 24) {
        return { type: "channel", id: url };
      }
      if (url.startsWith("PL") || url.startsWith("UU")) {
        return { type: "playlist", id: url };
      }
    }

    return null;
  }

  generateYouTubeAllowPatterns(youtubeAllowed) {
    const patterns = [];

    for (const url of youtubeAllowed) {
      const parsed = this.parseYouTubeUrl(url);
      if (!parsed) continue;

      if (parsed.type === "playlist") {
        // Allow playlist pages
        patterns.push(`*://youtube.com/playlist?list=${parsed.id}*`);
        patterns.push(`*://www.youtube.com/playlist?list=${parsed.id}*`);
        // Allow videos in playlist
        patterns.push(`*://youtube.com/watch?*list=${parsed.id}*`);
        patterns.push(`*://www.youtube.com/watch?*list=${parsed.id}*`);
      } else if (parsed.type === "video") {
        // Allow specific video
        patterns.push(`*://youtube.com/watch?v=${parsed.id}*`);
        patterns.push(`*://www.youtube.com/watch?v=${parsed.id}*`);
      } else if (parsed.type === "channel") {
        if (parsed.id) {
          // Channel by ID
          patterns.push(`*://youtube.com/channel/${parsed.id}*`);
          patterns.push(`*://www.youtube.com/channel/${parsed.id}*`);
        }
        if (parsed.handle) {
          // Channel by handle
          patterns.push(`*://youtube.com/c/${parsed.handle}*`);
          patterns.push(`*://www.youtube.com/c/${parsed.handle}*`);
          patterns.push(`*://youtube.com/@${parsed.handle}*`);
          patterns.push(`*://www.youtube.com/@${parsed.handle}*`);
        }
      }
    }

    // Always allow YouTube's essential resources
    patterns.push(
      "*://youtube.com/favicon.ico",
      "*://www.youtube.com/favicon.ico",
      "*://youtube.com/sw.js*",
      "*://www.youtube.com/sw.js*",
      "*://youtube.com/api/*",
      "*://www.youtube.com/api/*",
      "*://youtube.com/youtubei/*",
      "*://www.youtube.com/youtubei/*",
      "*://youtube.com/s/player/*",
      "*://www.youtube.com/s/player/*"
    );

    return patterns;
  }

  generateDomainPatterns(domain) {
    return [`*://${domain}/*`, `*://*.${domain}/*`, `*://www.${domain}/*`];
  }

  async loadBlockingRules() {
    const { focusSession } = await chrome.storage.local.get("focusSession");
    const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
    const currentRuleIds = currentRules.map((rule) => rule.id);

    if (focusSession.active) {
      const rules = [];
      let ruleId = 1;

      // Handle regular domains (full domain + subdomain access)
      for (const domain of focusSession.whitelist) {
        const patterns = this.generateDomainPatterns(domain);
        for (const pattern of patterns) {
          rules.push({
            id: ruleId++,
            priority: 10,
            action: { type: "allow" },
            condition: {
              urlFilter: pattern,
              resourceTypes: ["main_frame"],
            },
          });
        }
      }

      // Handle YouTube selective access (always process if URLs provided)
      if (
        focusSession.youtubeAllowed &&
        focusSession.youtubeAllowed.length > 0
      ) {
        const youtubePatterns = this.generateYouTubeAllowPatterns(
          focusSession.youtubeAllowed
        );
        for (const pattern of youtubePatterns) {
          rules.push({
            id: ruleId++,
            priority: 10,
            action: { type: "allow" },
            condition: {
              urlFilter: pattern,
              resourceTypes: ["main_frame"],
            },
          });
        }
      }

      // Allow extension URLs
      rules.push({
        id: ruleId++,
        priority: 10,
        action: { type: "allow" },
        condition: {
          urlFilter: `${chrome.runtime.getURL("")}*`,
          resourceTypes: ["main_frame"],
        },
      });

      // Block everything else
      rules.push({
        id: ruleId++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { url: chrome.runtime.getURL("blocked.html") },
        },
        condition: {
          urlFilter: "*://*/*",
          resourceTypes: ["main_frame"],
        },
      });

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: currentRuleIds,
        addRules: rules,
      });
    } else {
      if (currentRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: currentRuleIds,
        });
      }
    }
  }

  async handleAlarm(alarm) {
    if (alarm.name === "focusSession") {
      await this.endFocusSession();
    }
  }

  async startFocusSession(duration, whitelist, youtubeAllowed) {
    const expiry = Date.now() + duration;

    const session = {
      active: true,
      expiry: expiry,
      whitelist: whitelist.map((url) => this.cleanUrl(url)),
      youtubeAllowed: youtubeAllowed || [],
    };

    await chrome.storage.local.set({ focusSession: session });
    chrome.alarms.create("focusSession", { when: expiry });
  }

  async endFocusSession() {
    await chrome.storage.local.set({
      focusSession: {
        active: false,
        expiry: null,
        whitelist: [],
        youtubeAllowed: [],
      },
    });
    chrome.alarms.clear("focusSession");
  }

  cleanUrl(url) {
    try {
      return new URL(
        url.startsWith("http") ? url : `http://${url}`
      ).hostname.replace(/^www\./, "");
    } catch (e) {
      return url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
    }
  }
}

new FocusGuardCore();