// FocusGuard Content Script - Enhanced blocking and custom block pages

class FocusGuardContent {
  constructor() {
    this.init();
  }

  async init() {
    // Check if current page should be blocked
    await this.checkCurrentPage();

    // Set up monitoring for dynamic content changes
    this.setupPageMonitoring();
  }

  async checkCurrentPage() {
    const currentUrl = window.location.href;
    const domain = window.location.hostname.replace(/^www\./, "");

    // Get current settings
    const { blockedSites, strictBlocks, focusSessions } =
      await chrome.storage.local.get([
        "blockedSites",
        "strictBlocks",
        "focusSessions",
      ]);

    // Check for focus session
    const activeSessions = Object.values(focusSessions).filter((s) => s.active);
    if (activeSessions.length > 0) {
      const session = activeSessions[0];
      const isWhitelisted = this.isUrlInWhitelist(
        currentUrl,
        session.whitelist
      );

      if (!isWhitelisted) {
        this.showBlockPage("focus", null, session);
        return;
      }
    }

    // Check for blocked sites
    const blockedSite = blockedSites.find((site) =>
      this.isDomainBlocked(domain, site.url)
    );
    if (blockedSite) {
      // Check if it's a strict block
      const strictBlock = strictBlocks[blockedSite.url];
      if (
        strictBlock &&
        strictBlock.active &&
        new Date(strictBlock.expiry) > new Date()
      ) {
        this.showBlockPage("strict", blockedSite.url, strictBlock);
      } else {
        this.showBlockPage("normal", blockedSite.url);
      }
    }
  }

  setupPageMonitoring() {
    // Monitor for navigation changes (for single-page applications)
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(() => this.checkCurrentPage(), 100);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  showBlockPage(type, url, additionalData) {
    // Create block page overlay
    document.documentElement.innerHTML = this.generateBlockPageHTML(
      type,
      url,
      additionalData
    );

    // Prevent any further page execution
    if (window.stop) window.stop();

    // Add event listeners for the block page
    this.setupBlockPageListeners(type, url);
  }

  generateBlockPageHTML(type, url, additionalData) {
    const baseStyles = `
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
          padding: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .block-container {
          text-align: center;
          padding: 40px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          max-width: 600px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        h2 { font-size: 1.5em; margin-bottom: 30px; opacity: 0.9; }
        button {
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 15px 30px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 16px;
          margin: 10px;
          transition: all 0.3s ease;
        }
        button:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .danger {
          background: rgba(231, 76, 60, 0.6);
          border-color: rgba(231, 76, 60, 0.8);
        }
        .info-box {
          background: rgba(0, 0, 0, 0.2);
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
        }
        input {
          padding: 10px;
          border: none;
          border-radius: 5px;
          margin: 10px;
          width: 250px;
          text-align: center;
        }
      </style>
    `;

    let content = "";

    switch (type) {
      case "normal":
        content = `
          <div class="block-container">
            <h1>🚫</h1>
            <h2>Website Blocked</h2>
            <div class="info-box">
              <p><strong>${url}</strong> is currently blocked.</p>
              <p>This is a normal block. You can temporarily unblock it using your password.</p>
            </div>
            <button id="requestUnblock">Request Temporary Unblock</button>
            <button onclick="history.back()">Go Back</button>
          </div>
        `;
        break;

      case "strict":
        const expiry = new Date(additionalData.expiry);
        const remaining = Math.max(0, expiry.getTime() - Date.now());
        const remainingHours = Math.ceil(remaining / (1000 * 60 * 60));

        content = `
          <div class="block-container">
            <h1>🔒</h1>
            <h2>Strict Block Active</h2>
            <div class="info-box">
              <p><strong>${url}</strong> is under strict block.</p>
              <p><strong>Time Remaining:</strong> ${remainingHours} hours</p>
              <p class="danger">⚠️ This block cannot be removed until the timer expires.</p>
            </div>
            <button onclick="history.back()">Go Back</button>
          </div>
        `;
        break;

      case "focus":
        const sessionExpiry = new Date(additionalData.expiry);
        const sessionRemaining = Math.max(
          0,
          sessionExpiry.getTime() - Date.now()
        );
        const remainingMinutes = Math.ceil(sessionRemaining / (1000 * 60));

        content = `
          <div class="block-container">
            <h1>🎯</h1>
            <h2>Focus Session Active</h2>
            <div class="info-box">
              <p>You're in a focus session!</p>
              <p><strong>Time Remaining:</strong> ${remainingMinutes} minutes</p>
              <p><strong>Allowed sites:</strong> ${additionalData.whitelist.join(
                ", "
              )}</p>
            </div>
            <button onclick="history.back()">Go Back</button>
          </div>
        `;
        break;

      case "incognito":
        content = `
          <div class="block-container">
            <h1>🕵️</h1>
            <h2>Incognito Mode Blocked</h2>
            <div class="info-box">
              <p>Incognito mode is currently disabled by FocusGuard.</p>
              <p>Use regular browsing mode to access websites.</p>
            </div>
            <button onclick="window.close()">Close Window</button>
          </div>
        `;
        break;
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>FocusGuard - Website Blocked</title>
          ${baseStyles}
        </head>
        <body>
          ${content}
        </body>
      </html>
    `;
  }

  setupBlockPageListeners(type, url) {
    const requestUnblock = document.getElementById("requestUnblock");
    if (requestUnblock && type === "normal") {
      requestUnblock.addEventListener("click", () => {
        const password = prompt(
          "Enter your FocusGuard password to temporarily unblock this site:"
        );
        if (password) {
          this.requestTemporaryUnblock(url, password);
        }
      });
    }
  }

  async requestTemporaryUnblock(url, password) {
    // Send message to background script to verify password and create temporary unblock
    chrome.runtime.sendMessage(
      {
        action: "requestTemporaryUnblock",
        url: url,
        password: password,
      },
      (response) => {
        if (response && response.success) {
          // Reload the page to allow access
          window.location.reload();
        } else {
          alert("Incorrect password. Access denied.");
        }
      }
    );
  }

  isDomainBlocked(currentDomain, blockedUrl) {
    const blockedDomain = blockedUrl
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");
    return (
      currentDomain === blockedDomain ||
      currentDomain.endsWith("." + blockedDomain)
    );
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
}

// Only run if we're not in an extension page
if (!window.location.href.startsWith("chrome-extension://")) {
  new FocusGuardContent();
}
