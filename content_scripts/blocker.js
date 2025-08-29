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
    const { blockedSites, strictBlocks, focusSessions, temporaryUnblocks } =
      await chrome.storage.local.get([
        "blockedSites",
        "strictBlocks",
        "focusSessions",
        "temporaryUnblocks"
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
      // Check if temporarily unblocked
      const isTemporarilyUnblocked = temporaryUnblocks && temporaryUnblocks[blockedSite.url] &&
        temporaryUnblocks[blockedSite.url].active &&
        new Date(temporaryUnblocks[blockedSite.url].expiry) > new Date();

      if (isTemporarilyUnblocked) {
        // Site is temporarily unblocked, allow access
        return;
      }

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
        .success {
          background: rgba(46, 204, 113, 0.6);
          border-color: rgba(46, 204, 113, 0.8);
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
          padding: 15px;
          border: none;
          border-radius: 10px;
          margin: 10px;
          width: 250px;
          text-align: center;
          font-size: 16px;
          background: rgba(255, 255, 255, 0.9);
          color: #333;
        }
        input::placeholder {
          color: #666;
        }
        .password-section {
          background: rgba(52, 152, 219, 0.2);
          border: 2px solid rgba(52, 152, 219, 0.5);
          padding: 20px;
          border-radius: 15px;
          margin: 20px 0;
        }
        .warning-text {
          color: #f39c12;
          font-weight: bold;
          margin: 10px 0;
        }
        .success-text {
          color: #2ecc71;
          font-weight: bold;
        }
        .error-text {
          color: #e74c3c;
          font-weight: bold;
        }
        #unblockResult {
          margin: 15px 0;
          padding: 10px;
          border-radius: 8px;
          display: none;
        }
        .result-success {
          background: rgba(46, 204, 113, 0.3);
          border: 1px solid rgba(46, 204, 113, 0.6);
        }
        .result-error {
          background: rgba(231, 76, 60, 0.3);
          border: 1px solid rgba(231, 76, 60, 0.6);
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
              <p>This is a normal block. You can temporarily unblock it using your master password.</p>
            </div>
            <div class="password-section">
              <h3>🔓 Temporary Unblock (15 minutes)</h3>
              <input type="password" id="passwordInput" placeholder="Enter master password">
              <br>
              <button id="requestUnblock" class="success">Unblock Temporarily</button>
              <div id="unblockResult"></div>
              <p class="warning-text">⚠️ You need to set a master password in extension settings first</p>
            </div>
            <button onclick="history.back()">Go Back</button>
          </div>
        `;
        break;

      case "strict":
        const expiry = new Date(additionalData.expiry);
        const remaining = Math.max(0, expiry.getTime() - Date.now());
        
        // Format remaining time appropriately
        let remainingText;
        if (remaining < 60 * 60 * 1000) { // Less than 1 hour
          const remainingMinutes = Math.ceil(remaining / (1000 * 60));
          remainingText = `${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
        } else if (remaining < 24 * 60 * 60 * 1000) { // Less than 1 day
          const remainingHours = Math.ceil(remaining / (1000 * 60 * 60));
          remainingText = `${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
        } else {
          const remainingDays = Math.ceil(remaining / (1000 * 60 * 60 * 24));
          remainingText = `${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
        }

        content = `
          <div class="block-container">
            <h1>🔒</h1>
            <h2>Strict Block Active</h2>
            <div class="info-box">
              <p><strong>${url}</strong> is under strict block.</p>
              <p><strong>Time Remaining:</strong> ${remainingText}</p>
              <p class="error-text">⚠️ This block cannot be removed until the timer expires.</p>
              <p>Strict blocks are designed to help you stay focused without the temptation to override them.</p>
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
              <p>You're in a focus session! Stay productive!</p>
              <p><strong>Time Remaining:</strong> ${remainingMinutes} minutes</p>
              <p><strong>Allowed sites:</strong> ${additionalData.whitelist.join(
                ", "
              )}</p>
              <p class="success-text">💡 Focus sessions help you maintain productivity by limiting distractions.</p>
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
              <p class="warning-text">This helps maintain accountability and prevents bypassing blocks.</p>
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
    const passwordInput = document.getElementById("passwordInput");
    const resultDiv = document.getElementById("unblockResult");
    
    if (requestUnblock && type === "normal") {
      // Handle Enter key in password input
      if (passwordInput) {
        passwordInput.addEventListener("keypress", (e) => {
          if (e.key === "Enter") {
            this.requestTemporaryUnblock(url);
          }
        });
      }

      requestUnblock.addEventListener("click", () => {
        this.requestTemporaryUnblock(url);
      });
    }
  }

  async requestTemporaryUnblock(url) {
    const passwordInput = document.getElementById("passwordInput");
    const resultDiv = document.getElementById("unblockResult");
    const requestBtn = document.getElementById("requestUnblock");
    
    const password = passwordInput.value;
    
    if (!password) {
      this.showUnblockResult("Please enter your master password", "error");
      return;
    }

    // Disable button and show loading
    requestBtn.disabled = true;
    requestBtn.textContent = "Checking...";
    this.showUnblockResult("Verifying password...", "info");

    // Send message to background script to verify password and create temporary unblock
    chrome.runtime.sendMessage(
      {
        action: "requestTemporaryUnblock",
        url: url,
        password: password,
      },
      (response) => {
        requestBtn.disabled = false;
        requestBtn.textContent = "Unblock Temporarily";
        
        if (response && response.success) {
          this.showUnblockResult("✅ Success! Reloading page...", "success");
          // Small delay before reload to show success message
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else if (response && response.needsPasswordSetup) {
          this.showUnblockResult("❌ No master password set. Please go to extension settings to set one first.", "error");
        } else {
          this.showUnblockResult(
            response ? `❌ ${response.message}` : "❌ Failed to unblock. Please try again.",
            "error"
          );
          passwordInput.value = ""; // Clear password on error
        }
      }
    );
  }

  showUnblockResult(message, type) {
    const resultDiv = document.getElementById("unblockResult");
    if (resultDiv) {
      resultDiv.textContent = message;
      resultDiv.className = `result-${type}`;
      resultDiv.style.display = "block";
      
      // Hide after 5 seconds for info messages
      if (type === "info") {
        setTimeout(() => {
          resultDiv.style.display = "none";
        }, 5000);
      }
    }
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