// FocusGuard Popup Script - With YouTube Selective Blocking

class FocusGuardPopup {
  constructor() {
    this.timerInterval = null;
    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.loadCurrentStatus();
  }

  setupEventListeners() {
    document
      .getElementById("startFocus")
      .addEventListener("click", this.handleStartFocus.bind(this));
  }

  async handleStartFocus() {
    const whitelistText = document
      .getElementById("focusWhitelist")
      .value.trim();
    const youtubeText = document.getElementById("youtubeAllowed").value.trim();
    const duration = parseInt(document.getElementById("focusDuration").value);

    if (!duration) {
      alert("Please enter a duration.");
      return;
    }

    if (duration < 5) {
      alert("Duration must be at least 5 minutes.");
      return;
    }

    if (!whitelistText && !youtubeText) {
      alert("Please enter at least one allowed site or YouTube URL.");
      return;
    }

    const whitelist = whitelistText
      .split("\n")
      .map((site) => site.trim())
      .filter((site) => site);

    const youtubeAllowed = youtubeText
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => url);

    const durationMs = duration * 60 * 1000;

    chrome.runtime.sendMessage({
      action: "startFocusSession",
      duration: durationMs,
      whitelist: whitelist,
      youtubeAllowed: youtubeAllowed,
    });

    alert(`Focus session started for ${duration} minutes.`);
    window.close();
  }

  async loadCurrentStatus() {
    const { focusSession } = await chrome.storage.local.get("focusSession");

    const focusSection = document.getElementById("focusSection");
    const activeSessionSection = document.getElementById(
      "activeSessionSection"
    );

    if (focusSession.active && focusSession.expiry > Date.now()) {
      focusSection.style.display = "none";
      activeSessionSection.style.display = "block";
      this.updateTimerDisplay(focusSession.expiry);

      // Display regular whitelist
      const whitelistUl = document.getElementById("activeWhitelist");
      whitelistUl.innerHTML = "";
      focusSession.whitelist.forEach((site) => {
        const li = document.createElement("li");
        li.textContent = site;
        whitelistUl.appendChild(li);
      });

      // Display YouTube allowed list
      const youtubeUl = document.getElementById("activeYoutubeList");
      youtubeUl.innerHTML = "";
      if (focusSession.youtubeAllowed) {
        focusSession.youtubeAllowed.forEach((url) => {
          const li = document.createElement("li");
          li.textContent = this.formatYouTubeDisplay(url);
          whitelistUl.appendChild(li);
        });
      }
    } else {
      focusSection.style.display = "block";
      activeSessionSection.style.display = "none";
    }
  }

  formatYouTubeDisplay(url) {
    // Show a more readable format for YouTube URLs
    try {
      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
      const pathname = urlObj.pathname;
      const searchParams = urlObj.searchParams;

      if (pathname === "/playlist" || searchParams.has("list")) {
        return `Playlist: ${searchParams.get("list")}`;
      }
      if (pathname === "/watch" || searchParams.has("v")) {
        return `Video: ${searchParams.get("v")}`;
      }
      if (pathname.startsWith("/channel/")) {
        return `Channel: ${pathname.split("/channel/")[1]}`;
      }
      if (pathname.startsWith("/c/")) {
        return `Channel: ${pathname.split("/c/")[1]}`;
      }
      if (pathname.startsWith("/@")) {
        return `Channel: ${pathname.split("/@")[1]}`;
      }
      return url;
    } catch (e) {
      return url;
    }
  }

  updateTimerDisplay(expiry) {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    const timerDisplay = document.getElementById("timerDisplay");

    const update = () => {
      const remaining = Math.max(0, expiry - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      timerDisplay.textContent = `${minutes}m ${seconds}s remaining`;

      if (remaining === 0) {
        clearInterval(this.timerInterval);
        this.loadCurrentStatus();
      }
    };

    update();
    this.timerInterval = setInterval(update, 1000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new FocusGuardPopup();
});
