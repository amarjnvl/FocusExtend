// FocusGuard Popup Script

class FocusGuardPopup {
  constructor() {
    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.loadCurrentStatus();
  }

  setupEventListeners() {
    // Quick block functionality
    document.getElementById('quickBlockMode').addEventListener('change', this.handleBlockModeChange.bind(this));
    document.getElementById('addQuickBlock').addEventListener('click', this.handleAddQuickBlock.bind(this));
    
    // Focus session functionality
    document.getElementById('startFocus').addEventListener('click', this.handleStartFocus.bind(this));
    document.getElementById('endFocus').addEventListener('click', this.handleEndFocus.bind(this));
    
    // Quick actions
    document.getElementById('openOptions').addEventListener('click', this.handleOpenOptions.bind(this));
    document.getElementById('toggleIncognito').addEventListener('click', this.handleToggleIncognito.bind(this));
  }

  handleBlockModeChange(event) {
    const strictDiv = document.getElementById('strictDurationDiv');
    if (event.target.value === 'strict') {
      strictDiv.style.display = 'block';
    } else {
      strictDiv.style.display = 'none';
    }
  }

  async handleAddQuickBlock() {
    const url = document.getElementById('quickBlockUrl').value.trim();
    const mode = document.getElementById('quickBlockMode').value;
    
    if (!url) {
      alert('Please enter a website URL');
      return;
    }

    const cleanUrl = this.cleanUrl(url);
    const { blockedSites } = await chrome.storage.local.get('blockedSites');

    if (mode === 'normal') {
      blockedSites.push({ url: cleanUrl, mode: 'normal' });
      await chrome.storage.local.set({ blockedSites });
      alert('Website added to normal blocklist');
    } else {
      const hours = parseInt(document.getElementById('strictHours').value);
      const unit = document.getElementById('strictUnit').value;
      
      if (!hours || hours <= 0) {
        alert('Please enter a valid duration');
        return;
      }

      let duration = hours * 60 * 60 * 1000; // Convert to milliseconds
      if (unit === 'days') duration *= 24;
      if (unit === 'weeks') duration *= 24 * 7;

      // Add to blocked sites and create strict block
      blockedSites.push({ url: cleanUrl, mode: 'strict' });
      await chrome.storage.local.set({ blockedSites });
      
      // Send message to background script to create strict block
      chrome.runtime.sendMessage({
        action: 'addStrictBlock',
        url: cleanUrl,
        duration: duration
      });

      alert(`Website added to strict blocklist for ${hours} ${unit}`);
    }

    document.getElementById('quickBlockUrl').value = '';
  }

  async handleStartFocus() {
    const whitelistText = document.getElementById('focusWhitelist').value.trim();
    const duration = parseInt(document.getElementById('focusDuration').value);

    if (!whitelistText || !duration) {
      alert('Please enter both whitelist and duration');
      return;
    }

    const whitelist = whitelistText.split(',').map(site => site.trim()).filter(site => site);
    const durationMs = duration * 60 * 1000;

    chrome.runtime.sendMessage({
      action: 'startFocusSession',
      duration: durationMs,
      whitelist: whitelist
    });

    await this.loadCurrentStatus();
    alert(`Focus session started for ${duration} minutes`);
  }

  async handleEndFocus() {
    alert('Focus sessions can only be ended when the timer expires!');
  }

  handleOpenOptions() {
    chrome.runtime.openOptionsPage();
  }

  async handleToggleIncognito() {
    const { incognitoBlocked } = await chrome.storage.local.get('incognitoBlocked');
    const newValue = !incognitoBlocked;
    await chrome.storage.local.set({ incognitoBlocked: newValue });
    alert(`Incognito mode ${newValue ? 'blocked' : 'allowed'}`);
  }

  async loadCurrentStatus() {
    // Load focus session status
    const { focusSessions } = await chrome.storage.local.get('focusSessions');
    const activeSessions = Object.values(focusSessions).filter(s => s.active);
    
    const statusDiv = document.getElementById('focusStatus');
    const startBtn = document.getElementById('startFocus');
    const endBtn = document.getElementById('endFocus');

    if (activeSessions.length > 0) {
      const session = activeSessions[0];
      const expiry = new Date(session.expiry);
      const remaining = Math.max(0, expiry.getTime() - Date.now());
      const remainingMinutes = Math.ceil(remaining / (1000 * 60));

      statusDiv.textContent = `Active: ${remainingMinutes} minutes remaining`;
      statusDiv.className = 'status active';
      startBtn.style.display = 'none';
      endBtn.style.display = 'block';
    } else {
      statusDiv.textContent = 'No active focus session';
      statusDiv.className = 'status inactive';
      startBtn.style.display = 'block';
      endBtn.style.display = 'none';
    }
  }

  cleanUrl(url) {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new FocusGuardPopup();
});
