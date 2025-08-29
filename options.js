// FocusGuard Options Script

class FocusGuardOptions {
  constructor() {
    this.challengeString = "";
    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.loadSettings();
    this.disablePasteOnChallengeInput();
  }

  setupEventListeners() {
    // Password management
    document
      .getElementById("setMasterPassword")
      .addEventListener("click", this.handleSetMasterPassword.bind(this));

    // Blocked sites
    document
      .getElementById("blockMode")
      .addEventListener("change", this.handleBlockModeChange.bind(this));
    document
      .getElementById("addBlocked")
      .addEventListener("click", this.handleAddBlocked.bind(this));

    // Whitelist
    document
      .getElementById("addWhitelist")
      .addEventListener("click", this.handleAddWhitelist.bind(this));

    // Focus session
    document
      .getElementById("startFocusSession")
      .addEventListener("click", this.handleStartFocusSession.bind(this));

    // Incognito
    document
      .getElementById("blockIncognito")
      .addEventListener("change", this.handleIncognitoToggle.bind(this));

    // Challenge system
    document
      .getElementById("generateChallenge")
      .addEventListener("click", this.handleGenerateChallenge.bind(this));
    document
      .getElementById("verifyChallenge")
      .addEventListener("click", this.handleVerifyChallenge.bind(this));
    document
      .getElementById("resetChallenge")
      .addEventListener("click", this.handleResetChallenge.bind(this));
  }

  async handleSetMasterPassword() {
    const password = document.getElementById("masterPasswordInput").value;

    if (!password || password.length < 4) {
      alert("Password must be at least 4 characters long");
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: "setMasterPassword",
        password: password,
      },
      (response) => {
        if (response && response.success) {
          document.getElementById("masterPasswordInput").value = "";
          this.updatePasswordStatus(true);
          alert("Master password set successfully!");
        } else {
          alert(response ? response.message : "Failed to set password");
        }
      }
    );
  }

  async updatePasswordStatus(hasPassword = null) {
    if (hasPassword === null) {
      const { masterPassword } = await chrome.storage.local.get(
        "masterPassword"
      );
      hasPassword = !!masterPassword;
    }

    const statusDiv = document.getElementById("passwordStatus");
    const setBtn = document.getElementById("setMasterPassword");

    if (hasPassword) {
      statusDiv.innerHTML =
        '<p style="color: #27ae60; margin-top: 10px;">✅ Master password is set</p>';
      setBtn.textContent = "Change Password";
    } else {
      statusDiv.innerHTML =
        '<p style="color: #e74c3c; margin-top: 10px;">❌ No master password set - cannot temporarily unblock sites</p>';
      setBtn.textContent = "Set Password";
    }
  }

  disablePasteOnChallengeInput() {
    const challengeInput = document.getElementById("challengeInput");

    // Disable all paste methods
    challengeInput.addEventListener("paste", (e) => {
      e.preventDefault();
      alert(
        "Copy-paste is disabled for this challenge. You must type manually."
      );
    });

    challengeInput.addEventListener("contextmenu", (e) => {
      e.preventDefault(); // Disable right-click menu
    });

    challengeInput.addEventListener("keydown", (e) => {
      // Disable Ctrl+V, Ctrl+Shift+V, and other paste shortcuts
      if (
        (e.ctrlKey && (e.key === "v" || e.key === "V")) ||
        (e.ctrlKey && e.shiftKey && (e.key === "v" || e.key === "V"))
      ) {
        e.preventDefault();
        alert("Keyboard shortcuts for paste are disabled. Type manually.");
      }
    });
  }

  handleBlockModeChange(event) {
    const strictOptions = document.getElementById("strictBlockOptions");
    if (event.target.value === "strict") {
      strictOptions.classList.remove("hidden");
    } else {
      strictOptions.classList.add("hidden");
    }
  }

  async handleAddBlocked() {
    const url = document.getElementById("newBlockedUrl").value.trim();
    const mode = document.getElementById("blockMode").value;

    if (!url) {
      alert("Please enter a website URL");
      return;
    }

    const cleanUrl = this.cleanUrl(url);
    const { blockedSites } = await chrome.storage.local.get("blockedSites");

    // Check if already exists
    if (blockedSites.some((site) => site.url === cleanUrl)) {
      alert("This website is already in your blocklist");
      return;
    }

    if (mode === "normal") {
      blockedSites.push({ url: cleanUrl, mode: "normal" });
      await chrome.storage.local.set({ blockedSites });
    } else {
      const duration = parseInt(
        document.getElementById("strictDuration").value
      );
      const unit = document.getElementById("strictUnit").value;

      if (!duration || duration <= 0) {
        alert("Please enter a valid duration for strict block");
        return;
      }

      // Calculate duration in milliseconds based on unit
      let durationMs;
      switch (unit) {
        case "minutes":
          durationMs = duration * 60 * 1000;
          break;
        case "hours":
          durationMs = duration * 60 * 60 * 1000;
          break;
        case "days":
          durationMs = duration * 24 * 60 * 60 * 1000;
          break;
        case "weeks":
          durationMs = duration * 7 * 24 * 60 * 60 * 1000;
          break;
        default:
          durationMs = duration * 60 * 60 * 1000; // Default to hours
      }

      blockedSites.push({ url: cleanUrl, mode: "strict" });
      await chrome.storage.local.set({ blockedSites });

      // Create strict block
      chrome.runtime.sendMessage({
        action: "addStrictBlock",
        url: cleanUrl,
        duration: durationMs,
      });
    }

    document.getElementById("newBlockedUrl").value = "";
    document.getElementById("strictDuration").value = "";
    await this.loadBlockedSites();
  }

  async handleRemoveBlocked(url) {
    const { blockedSites, strictBlocks } = await chrome.storage.local.get([
      "blockedSites",
      "strictBlocks",
    ]);

    // Check if it's a strict block that's still active
    if (
      strictBlocks[url] &&
      strictBlocks[url].active &&
      new Date(strictBlocks[url].expiry) > new Date()
    ) {
      alert("Cannot remove strict blocks until they expire!");
      return;
    }

    // Remove from blockedSites array
    const updatedBlocked = blockedSites.filter((site) => site.url !== url);
    await chrome.storage.local.set({ blockedSites: updatedBlocked });

    // Clear any temporary unblocks for this site as well
    const { temporaryUnblocks } = await chrome.storage.local.get(
      "temporaryUnblocks"
    );
    if (temporaryUnblocks[url]) {
      delete temporaryUnblocks[url];
      await chrome.storage.local.set({ temporaryUnblocks });
    }

    await this.loadBlockedSites();
  }

  async handleAddWhitelist() {
    const url = document.getElementById("newWhitelistUrl").value.trim();

    if (!url) {
      alert("Please enter a website URL");
      return;
    }

    const cleanUrl = this.cleanUrl(url);
    const { whitelist } = await chrome.storage.local.get("whitelist");

    if (whitelist.includes(cleanUrl)) {
      alert("This website is already in your whitelist");
      return;
    }

    whitelist.push(cleanUrl);
    await chrome.storage.local.set({ whitelist });

    document.getElementById("newWhitelistUrl").value = "";
    await this.loadWhitelist();
  }

  async handleRemoveWhitelist(url) {
    const { whitelist } = await chrome.storage.local.get("whitelist");
    const updatedWhitelist = whitelist.filter((site) => site !== url);
    await chrome.storage.local.set({ whitelist: updatedWhitelist });
    await this.loadWhitelist();
  }

  async handleStartFocusSession() {
    const duration = parseInt(
      document.getElementById("focusSessionDuration").value
    );

    if (!duration || duration < 5) {
      alert("Please enter a duration of at least 5 minutes");
      return;
    }

    const { whitelist } = await chrome.storage.local.get("whitelist");

    if (whitelist.length === 0) {
      alert("Please add at least one website to your whitelist first");
      return;
    }

    const durationMs = duration * 60 * 1000;

    chrome.runtime.sendMessage({
      action: "startFocusSession",
      duration: durationMs,
      whitelist: whitelist,
    });

    await this.loadFocusSessionStatus();
    alert(`Focus session started for ${duration} minutes`);
  }

  async handleIncognitoToggle(event) {
    await chrome.storage.local.set({ incognitoBlocked: event.target.checked });
  }

  handleGenerateChallenge() {
    // Generate a 35-character random string with various character types
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    this.challengeString = "";

    for (let i = 0; i < 35; i++) {
      this.challengeString += chars.charAt(
        Math.floor(Math.random() * chars.length)
      );
    }

    document.getElementById("challengeString").textContent =
      this.challengeString;
    document.getElementById("challengeStep1").classList.add("hidden");
    document.getElementById("challengeStep2").classList.remove("hidden");
    document.getElementById("challengeInput").value = "";
    document.getElementById("challengeInput").focus();
  }

  async handleVerifyChallenge() {
    const userInput = document.getElementById("challengeInput").value;

    if (userInput === this.challengeString) {
      await chrome.storage.local.set({ disableUnlocked: true });
      document.getElementById("challengeStep2").classList.add("hidden");
      document.getElementById("challengeSuccess").classList.remove("hidden");

      // Set a timer to auto-reset the unlock after 5 minutes
      setTimeout(async () => {
        await chrome.storage.local.set({ disableUnlocked: false });
        this.handleResetChallenge();
      }, 5 * 60 * 1000);
    } else {
      alert("Incorrect string. Please try again carefully.");
      document.getElementById("challengeInput").value = "";
    }
  }

  async handleResetChallenge() {
    await chrome.storage.local.set({ disableUnlocked: false });
    document.getElementById("challengeStep1").classList.remove("hidden");
    document.getElementById("challengeStep2").classList.add("hidden");
    document.getElementById("challengeSuccess").classList.add("hidden");
    this.challengeString = "";
  }

  async loadSettings() {
    await this.updatePasswordStatus();
    await this.loadBlockedSites();
    await this.loadWhitelist();
    await this.loadFocusSessionStatus();
    await this.loadIncognitoSetting();
  }

  async loadBlockedSites() {
    const { blockedSites, strictBlocks, temporaryUnblocks } =
      await chrome.storage.local.get([
        "blockedSites",
        "strictBlocks",
        "temporaryUnblocks",
      ]);
    const listDiv = document.getElementById("blockedList");

    listDiv.innerHTML = "";

    for (const site of blockedSites) {
      const div = document.createElement("div");
      div.className = "list-item";

      // Check if this is a strict block and if it's still active
      const isStrictActive =
        strictBlocks[site.url] &&
        strictBlocks[site.url].active &&
        new Date(strictBlocks[site.url].expiry) > new Date();

      // Check if temporarily unblocked
      const isTemporarilyUnblocked =
        temporaryUnblocks &&
        temporaryUnblocks[site.url] &&
        temporaryUnblocks[site.url].active &&
        new Date(temporaryUnblocks[site.url].expiry) > new Date();

      if (isStrictActive) {
        div.classList.add("strict-block");
        const expiry = new Date(strictBlocks[site.url].expiry);
        const remaining = Math.max(0, expiry.getTime() - Date.now());

        // Format remaining time based on duration
        let remainingText;
        if (remaining < 60 * 60 * 1000) {
          // Less than 1 hour
          const remainingMinutes = Math.ceil(remaining / (1000 * 60));
          remainingText = `${remainingMinutes}m`;
        } else if (remaining < 24 * 60 * 60 * 1000) {
          // Less than 1 day
          const remainingHours = Math.ceil(remaining / (1000 * 60 * 60));
          remainingText = `${remainingHours}h`;
        } else {
          const remainingDays = Math.ceil(remaining / (1000 * 60 * 60 * 24));
          remainingText = `${remainingDays}d`;
        }

        div.innerHTML = `
          <div>
            <strong>${site.url}</strong> 
            <span style="color: #e74c3c;">(STRICT - ${remainingText} remaining)</span>
          </div>
          <button disabled style="opacity: 0.5;">Cannot Remove</button>
        `;
      } else if (isTemporarilyUnblocked) {
        div.classList.add("temp-unblocked");
        const expiry = new Date(temporaryUnblocks[site.url].expiry);
        const remaining = Math.max(0, expiry.getTime() - Date.now());
        const remainingMinutes = Math.ceil(remaining / (1000 * 60));

        div.innerHTML = `
          <div>
            <strong>${site.url}</strong> 
            <span style="color: #27ae60;">(TEMP UNBLOCKED - ${remainingMinutes}m remaining)</span>
          </div>
          <button onclick="focusGuardOptions.handleRemoveBlocked('${site.url}')" class="danger">Remove</button>
        `;
      } else {
        div.innerHTML = `
          <div><strong>${site.url}</strong> (${site.mode})</div>
          <button onclick="focusGuardOptions.handleRemoveBlocked('${site.url}')" class="danger">Remove</button>
        `;
      }

      listDiv.appendChild(div);
    }

    if (blockedSites.length === 0) {
      listDiv.innerHTML = "<p>No blocked websites yet.</p>";
    }
  }

  async loadWhitelist() {
    const { whitelist, focusSessions } = await chrome.storage.local.get([
      "whitelist",
      "focusSessions",
    ]);
    const listDiv = document.getElementById("whitelistList");

    // Check if focus session is active
    const activeSessions = Object.values(focusSessions).filter((s) => s.active);
    const isFocusActive = activeSessions.length > 0;

    listDiv.innerHTML = "";

    for (const site of whitelist) {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div><strong>${site}</strong></div>
        <button onclick="focusGuardOptions.handleRemoveWhitelist('${site}')" class="danger">Remove</button>
      `;
      listDiv.appendChild(div);
    }

    if (whitelist.length === 0) {
      listDiv.innerHTML = "<p>No whitelisted websites yet.</p>";
    }

    // Add note about focus session management
    if (isFocusActive) {
      const noteDiv = document.createElement("div");
      noteDiv.style.cssText =
        "background: #e8f5e8; padding: 10px; border-radius: 5px; margin: 10px 0; color: #27ae60; font-size: 14px;";
      noteDiv.innerHTML =
        "ℹ️ <strong>Focus Session Active:</strong> Changes to the whitelist will take effect immediately.";
      listDiv.insertBefore(noteDiv, listDiv.firstChild);
    }
  }

  async loadFocusSessionStatus() {
    const { focusSessions } = await chrome.storage.local.get("focusSessions");
    const statusDiv = document.getElementById("focusSessionStatus");
    const startBtn = document.getElementById("startFocusSession");

    const activeSessions = Object.values(focusSessions).filter((s) => s.active);

    if (activeSessions.length > 0) {
      const session = activeSessions[0];
      const expiry = new Date(session.expiry);
      const remaining = Math.max(0, expiry.getTime() - Date.now());
      const remainingMinutes = Math.ceil(remaining / (1000 * 60));

      // Get current whitelist
      const { whitelist } = await chrome.storage.local.get("whitelist");

      statusDiv.innerHTML = `
        <div style="background-color: #d5f4e6; padding: 15px; border-radius: 5px; color: #27ae60;">
          <h4>🎯 Active Focus Session</h4>
          <p><strong>${remainingMinutes}</strong> minutes remaining</p>
          <p><strong>Allowed sites:</strong> ${whitelist.join(", ")}</p>
          <p style="font-size: 12px; margin-top: 10px;">
            💡 <strong>Tip:</strong> You can add or remove websites from the whitelist above, 
            and changes will take effect immediately during this session.
          </p>
        </div>
      `;
      startBtn.disabled = true;
      startBtn.textContent = "Focus Session Active";
    } else {
      statusDiv.innerHTML = "<p>No active focus session</p>";
      startBtn.disabled = false;
      startBtn.textContent = "Start Focus Session";
    }
  }

  async loadIncognitoSetting() {
    const { incognitoBlocked } = await chrome.storage.local.get(
      "incognitoBlocked"
    );
    document.getElementById("blockIncognito").checked =
      incognitoBlocked || false;
  }

  cleanUrl(url) {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");
  }
}

// Initialize options page
const focusGuardOptions = new FocusGuardOptions();

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "settingsUpdated") {
    focusGuardOptions.loadSettings();
  }
});
