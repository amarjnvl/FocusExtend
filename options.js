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

      let durationMs = duration * 60 * 60 * 1000; // Convert to milliseconds
      if (unit === "days") durationMs *= 24;
      if (unit === "weeks") durationMs *= 24 * 7;

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

    const updatedBlocked = blockedSites.filter((site) => site.url !== url);
    await chrome.storage.local.set({ blockedSites: updatedBlocked });
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
    await this.loadBlockedSites();
    await this.loadWhitelist();
    await this.loadFocusSessionStatus();
    await this.loadIncognitoSetting();
  }

  async loadBlockedSites() {
    const { blockedSites, strictBlocks } = await chrome.storage.local.get([
      "blockedSites",
      "strictBlocks",
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

      if (isStrictActive) {
        div.classList.add("strict-block");
        const expiry = new Date(strictBlocks[site.url].expiry);
        const remaining = Math.max(0, expiry.getTime() - Date.now());
        const remainingHours = Math.ceil(remaining / (1000 * 60 * 60));

        div.innerHTML = `
          <div>
            <strong>${site.url}</strong> 
            <span style="color: #e74c3c;">(STRICT - ${remainingHours}h remaining)</span>
          </div>
          <button disabled style="opacity: 0.5;">Cannot Remove</button>
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
    const { whitelist } = await chrome.storage.local.get("whitelist");
    const listDiv = document.getElementById("whitelistList");

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

      statusDiv.innerHTML = `
        <div style="background-color: #d5f4e6; padding: 15px; border-radius: 5px; color: #27ae60;">
          <h4>🎯 Active Focus Session</h4>
          <p><strong>${remainingMinutes}</strong> minutes remaining</p>
          <p><strong>Allowed sites:</strong> ${session.whitelist.join(", ")}</p>
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