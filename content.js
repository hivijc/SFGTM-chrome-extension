/**
 * Nat-vigator Sidebar — injected into LinkedIn pages.
 * Uses Shadow DOM to isolate styles from LinkedIn.
 */

(function () {
  "use strict";

  if (document.getElementById("natvig-root")) return; // already injected

  const GPM_MEMBERS = [
    "Ammar", "Athirah", "Ditto", "Gisele",
    "Nathaniel", "Nuovo", "Others", "Pearl", "Rizqi",
  ];
  const HUBSPOT_GPMS = new Set([
    "Ammar", "Athirah", "Ditto", "Gisele",
    "Nathaniel", "Nuovo", "Pearl", "Rizqi",
  ]);

  let lastUrl = "";
  let currentProfile = null;
  let currentContactId = null;
  let currentGpmName = null;
  let currentFolderId = null;
  let sidebarSide = "right"; // "left" | "right"
  let sidebarOpen = true;
  let briefPollTimer = null;
  let autoOpen = true;
  let tabY = 80;
  let isDragging = false;

  const API_BASE = "https://sfgtm.vercel.app";

  /** Proxy fetch through background worker (content scripts can't cross-origin fetch) */
  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "api", method, path, body }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res);
      });
    });
  }

  // ── Create host element + Shadow DOM ──
  const host = document.createElement("div");
  host.id = "natvig-root";
  host.style.cssText = "all: initial; position: fixed; top: 0; z-index: 2147483647; height: 100vh; pointer-events: none;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  // ── Inject styles ──
  const style = document.createElement("style");
  style.textContent = getStyles();
  shadow.appendChild(style);

  // ── Build sidebar DOM ──
  const container = document.createElement("div");
  container.id = "nv-container";
  shadow.appendChild(container);

  container.innerHTML = `
    <div id="nv-tab" title="Nat-vigator">
      <img id="nv-tab-icon" src="${chrome.runtime.getURL("icons/icon-48.png")}" alt="N" />
    </div>
    <div id="nv-panel">
      <div id="nv-header">
        <img src="${chrome.runtime.getURL("icons/icon-48.png")}" class="nv-logo" />
        <div>
          <div class="nv-title">Nat-vigator</div>
          <div class="nv-subtitle">by SleekFlow</div>
        </div>
        <span id="nv-badge"></span>
        <div class="nv-header-actions">
          <button id="nv-toggle-side" title="Move to other side">&#8644;</button>
          <button id="nv-close" title="Collapse">&times;</button>
        </div>
      </div>
      <div id="nv-body">
        <!-- Setup -->
        <div id="nv-setup" class="nv-screen">
          <p class="nv-msg">Select your name:</p>
          <div id="nv-gpm-grid"></div>
        </div>
        <!-- No profile -->
        <div id="nv-no-profile" class="nv-screen nv-hidden">
          <p class="nv-msg nv-muted">Navigate to a LinkedIn profile to get started.</p>
        </div>
        <!-- Preview -->
        <div id="nv-preview" class="nv-screen nv-hidden">
          <div id="nv-card">
            <div id="nv-name"></div>
            <div id="nv-jobtitle"></div>
            <div id="nv-company"></div>
          </div>
          <button id="nv-research-btn" class="nv-btn nv-btn-primary">Research this Prospect</button>
        </div>
        <!-- Loading -->
        <div id="nv-loading" class="nv-screen nv-hidden">
          <div class="nv-progress-bar"><div class="nv-progress-fill" id="nv-loading-fill"></div></div>
          <div class="nv-progress-dots" id="nv-loading-dots">
            <span class="nv-dot"></span><span class="nv-dot"></span><span class="nv-dot"></span><span class="nv-dot"></span>
          </div>
          <p class="nv-msg" id="nv-loading-msg">Starting research...</p>
        </div>
        <!-- Success + Intelligence -->
        <div id="nv-success" class="nv-screen nv-hidden">
          <div class="nv-success-icon">&#10003;</div>
          <p class="nv-msg" id="nv-success-msg">Research started!</p>

          <!-- Intelligence section -->
          <div id="nv-intel">
            <div id="nv-intel-loading">
              <div class="nv-progress-bar nv-progress-sm"><div class="nv-progress-fill" id="nv-intel-fill"></div></div>
              <div class="nv-progress-dots nv-progress-dots-sm" id="nv-intel-dots">
                <span class="nv-dot"></span><span class="nv-dot"></span><span class="nv-dot"></span><span class="nv-dot"></span>
              </div>
              <p class="nv-msg nv-intel-label" id="nv-intel-step-label">Looking up prospect...</p>
            </div>
            <div id="nv-intel-content" class="nv-hidden">
              <!-- Pain points -->
              <div id="nv-pp-section">
                <div class="nv-section-label">Pain Points</div>
                <div id="nv-pp-list"></div>
              </div>
              <!-- Outbound (collapsed) -->
              <div id="nv-outbound-section">
                <button id="nv-outbound-toggle" class="nv-collapse-toggle">
                  <span>Outbound Material</span>
                  <span id="nv-outbound-arrow" class="nv-arrow">&#9656;</span>
                </button>
                <div id="nv-outbound-content" class="nv-hidden">
                  <div id="nv-email-section">
                    <div class="nv-outbound-label">Cold Email</div>
                    <div id="nv-email-subject" class="nv-email-subject"></div>
                    <div id="nv-email-body" class="nv-email-body"></div>
                    <button class="nv-copy-btn" id="nv-copy-email">Copy Email</button>
                  </div>
                  <div id="nv-call-section">
                    <div class="nv-outbound-label">Cold Call Script</div>
                    <div id="nv-call-content" class="nv-call-content"></div>
                    <button class="nv-copy-btn" id="nv-copy-call">Copy Script</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="nv-actions">
            <a id="nv-view-link" class="nv-btn nv-btn-outline" target="_blank">View in Nat-vigator</a>
            <button id="nv-hubspot-btn" class="nv-btn nv-btn-hubspot nv-hidden">Push to HubSpot</button>
            <div id="nv-hubspot-status" class="nv-hidden"></div>
            <a id="nv-hubspot-link" class="nv-btn nv-btn-hs-link nv-hidden" target="_blank">Open in HubSpot &#8599;</a>
          </div>
        </div>
        <!-- Error -->
        <div id="nv-error" class="nv-screen nv-hidden">
          <p class="nv-msg nv-error-text" id="nv-error-msg"></p>
          <button id="nv-retry-btn" class="nv-btn nv-btn-outline">Try Again</button>
        </div>
      </div>
      <div id="nv-footer">
        <div id="nv-credits" class="nv-hidden">
          <div class="nv-credits-header">
            <span class="nv-credits-label">Lusha Credits</span>
            <span id="nv-credits-count"></span>
          </div>
          <div class="nv-credits-bar">
            <div id="nv-credits-fill"></div>
          </div>
        </div>
        <div id="nv-prefs">
          <button id="nv-prefs-toggle" class="nv-prefs-toggle-btn">
            <span class="nv-prefs-gear">&#9881;</span>
          </button>
          <div id="nv-prefs-content" class="nv-hidden">
            <div class="nv-pref-row">
              <span class="nv-pref-label">Plugin position</span>
              <div class="nv-pos-toggle">
                <button class="nv-pos-btn" data-side="left">L</button>
                <button class="nv-pos-btn" data-side="right">R</button>
              </div>
            </div>
            <div class="nv-pref-row">
              <span class="nv-pref-label">Auto open</span>
              <label class="nv-switch">
                <input type="checkbox" id="nv-auto-open">
                <span class="nv-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Refs ──
  const $ = (sel) => shadow.querySelector(sel);
  const panel = $("#nv-panel");
  const tab = $("#nv-tab");

  // ── Screen management ──
  function showScreen(id) {
    shadow.querySelectorAll(".nv-screen").forEach((el) => {
      el.classList.add("nv-hidden");
    });
    const screen = $(`#nv-${id}`);
    if (screen) screen.classList.remove("nv-hidden");
  }

  // ── Sidebar toggle ──
  function updatePosition() {
    host.style.left = sidebarSide === "left" ? "0" : "";
    host.style.right = sidebarSide === "right" ? "0" : "";
    container.className = `nv-side-${sidebarSide}`;

    tab.style.marginTop = tabY + "px";

    if (sidebarOpen) {
      panel.classList.remove("nv-collapsed");
      tab.classList.add("nv-hidden");
    } else {
      panel.classList.add("nv-collapsed");
      tab.classList.remove("nv-hidden");
    }

    // Sync position toggle UI
    shadow.querySelectorAll(".nv-pos-btn").forEach((b) => {
      b.classList.toggle("nv-pos-active", b.dataset.side === sidebarSide);
    });

    chrome.storage.local.set({ nvSide: sidebarSide });
  }

  $("#nv-close").addEventListener("click", () => {
    sidebarOpen = false;
    updatePosition();
  });

  // ── Tab drag + click ──
  tab.addEventListener("mousedown", (e) => {
    isDragging = false;
    const startY = e.clientY;
    const startTabY = tabY;
    e.preventDefault();

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 3) isDragging = true;
      tabY = Math.max(10, Math.min(window.innerHeight - 50, startTabY + dy));
      tab.style.marginTop = tabY + "px";
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (isDragging) {
        chrome.storage.local.set({ nvTabY: tabY });
      } else {
        sidebarOpen = true;
        updatePosition();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  $("#nv-toggle-side").addEventListener("click", () => {
    sidebarSide = sidebarSide === "right" ? "left" : "right";
    updatePosition();
  });

  // Also toggle via extension icon click
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggle") {
      sidebarOpen = !sidebarOpen;
      updatePosition();
    }
  });

  // ── Outbound collapse toggle ──
  $("#nv-outbound-toggle").addEventListener("click", () => {
    const content = $("#nv-outbound-content");
    const arrow = $("#nv-outbound-arrow");
    const isHidden = content.classList.contains("nv-hidden");
    if (isHidden) {
      content.classList.remove("nv-hidden");
      arrow.innerHTML = "&#9662;"; // ▾
    } else {
      content.classList.add("nv-hidden");
      arrow.innerHTML = "&#9656;"; // ▶
    }
  });

  // ── Copy buttons ──
  $("#nv-copy-email").addEventListener("click", () => {
    const subj = $("#nv-email-subject").textContent;
    const body = $("#nv-email-body").textContent;
    copyToClipboard(`Subject: ${subj}\n\n${body}`, $("#nv-copy-email"));
  });

  $("#nv-copy-call").addEventListener("click", () => {
    copyToClipboard($("#nv-call-content").textContent, $("#nv-copy-call"));
  });

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = orig), 1500);
    }).catch(() => {});
  }

  // ── Preferences toggle ──
  $("#nv-prefs-toggle").addEventListener("click", () => {
    const content = $("#nv-prefs-content");
    content.classList.toggle("nv-hidden");
  });

  // ── Position toggle buttons (L / R) ──
  shadow.querySelectorAll(".nv-pos-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebarSide = btn.dataset.side;
      updatePosition();
    });
  });

  // ── Auto open switch ──
  $("#nv-auto-open").addEventListener("change", (e) => {
    autoOpen = e.target.checked;
    chrome.storage.local.set({ nvAutoOpen: autoOpen });
  });

  // ── Lusha credits ──
  let lushaFetchedAt = 0;

  async function fetchLushaCredits() {
    const now = Date.now();
    if (now - lushaFetchedAt < 60000) return; // 60s cooldown
    lushaFetchedAt = now;

    try {
      const res = await api("GET", "/api/lusha/usage");
      if (res.ok && res.data?.data) {
        const { total, used } = res.data.data;
        const creditsEl = $("#nv-credits");
        creditsEl.classList.remove("nv-hidden");
        $("#nv-credits-count").textContent = `${used.toLocaleString()} of ${total.toLocaleString()}`;
        const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
        $("#nv-credits-fill").style.width = pct + "%";
      }
    } catch {
      // Credits fetch failed — hide section silently
    }
  }

  // ── Data extraction ──
  function extractPersonData() {
    const url = normalizeUrl(window.location.href);
    let firstName = "", lastName = "", jobTitle = "", companyName = "";

    const ogTitle = getMeta("og:title");
    if (ogTitle) {
      const titleParts = ogTitle.split(" - ");
      if (titleParts.length >= 1) {
        const nameParts = titleParts[0].trim().split(" ");
        firstName = nameParts[0] || "";
        lastName = nameParts.slice(1).join(" ") || "";
      }
      if (titleParts.length >= 2) {
        const roleCompany = titleParts[1].replace(/\s*\|.*$/, "").trim();
        const atParts = roleCompany.split(" at ");
        if (atParts.length >= 2) {
          jobTitle = atParts[0].trim();
          companyName = atParts[1].trim();
        } else {
          // LinkedIn format without "at" is typically "Name - Company | LinkedIn"
          // Only treat as jobTitle if it looks like a role (contains role keywords)
          const rolePat = /\b(CEO|CTO|CFO|COO|CMO|VP|SVP|EVP|Director|Manager|Head|Lead|Founder|Co-founder|Chief|President|Officer|Engineer|Developer|Designer|Analyst|Consultant|Advisor|Specialist|Coordinator|Executive|Associate|Partner|Principal|Architect|Strategist)\b/i;
          if (rolePat.test(roleCompany)) jobTitle = roleCompany;
          else companyName = roleCompany;
        }
      }
    }

    if (!jobTitle || !companyName) {
      const ogDesc = getMeta("og:description");
      if (ogDesc) {
        // Pattern 1: "Title at Company. Description..."
        const m = ogDesc.match(/^(.+?)\s+at\s+([^.·|]+)/i);
        if (m) {
          if (!jobTitle) jobTitle = m[1].trim();
          if (!companyName) companyName = m[2].trim();
        }
        // Pattern 2: "... · Experience: Company Name · ..."
        if (!companyName) {
          const expMatch = ogDesc.match(/Experience:\s*([^·|]+)/i);
          if (expMatch) companyName = expMatch[1].trim();
        }
      }
    }

    // ── DOM-based extraction (most reliable when logged in) ──
    if (!firstName) {
      const h1 = document.querySelector("h1");
      if (h1) {
        const parts = h1.textContent.trim().split(" ");
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ") || "";
      }
    }

    // Experience section: ALWAYS read — this is the most accurate source for
    // current job title and company. Overrides headline/meta tag data.
    // Handles two LinkedIn layouts:
    //   Simple:  <li> Title | "Company · Full-time" | "Date range" </li>
    //   Grouped: <li> Company | "Full-time · Duration" | <li> Title | "Date range" </li> </li>
    const expSection = document.querySelector("#experience");
    if (expSection) {
      const expList = expSection.closest("section");
      if (expList) {
        const firstItem = expList.querySelector("li");
        if (firstItem) {
          const nestedLi = firstItem.querySelector("li");
          if (nestedLi) {
            // ── Grouped layout: company is parent, title is in nested li ──
            // Parent spans: ["Metro Singapore", "Full-time · 1 yr 2 mos", "On-site"]
            // Nested spans: ["Head of Loyalty...", "May 2025 - Present · 11 mos"]
            const parentSpans = firstItem.querySelectorAll(":scope > div span[aria-hidden='true']");
            const parentTexts = Array.from(parentSpans).map(s => s.textContent.trim()).filter(Boolean);
            const nestedSpans = nestedLi.querySelectorAll("span[aria-hidden='true']");
            const nestedTexts = Array.from(nestedSpans).map(s => s.textContent.trim()).filter(Boolean);
            if (parentTexts.length >= 1) companyName = parentTexts[0];
            if (nestedTexts.length >= 1) jobTitle = nestedTexts[0];
          } else {
            // ── Simple layout: title first, then company ──
            const itemSpans = firstItem.querySelectorAll("span[aria-hidden='true']");
            const itemTexts = Array.from(itemSpans).map(s => s.textContent.trim()).filter(Boolean);
            // Typical order: [title, "Company · Full-time", "date range", ...]
            if (itemTexts.length >= 2) {
              const expTitle = itemTexts[0];
              const expCompany = itemTexts[1].split("·")[0].trim();
              if (expTitle) jobTitle = expTitle;
              if (expCompany) companyName = expCompany;
            }
          }
        }
      }
    }

    // Headline fallback: only if Experience section didn't provide data
    if (!jobTitle || !companyName) {
      const headline = document.querySelector(".text-body-medium.break-words");
      if (headline) {
        const text = headline.textContent.trim();
        const atMatch = text.match(/^(.+?)\s+at\s+(.+)$/i);
        if (atMatch) {
          if (!jobTitle) jobTitle = atMatch[1].trim();
          if (!companyName) companyName = atMatch[2].trim();
        } else if (!jobTitle) {
          jobTitle = text;
        }
      }
    }

    if (!firstName || !companyName) {
      const t = document.title || "";
      const parts = t.split(" - ");
      if (!firstName && parts.length >= 1) {
        const np = parts[0].trim().split(" ");
        firstName = np[0] || "";
        lastName = np.slice(1).join(" ") || "";
      }
      if (!companyName && parts.length >= 2) {
        const m = parts[1].match(/at\s+([^|]+)/i);
        if (m) companyName = m[1].trim();
      }
    }

    return { type: "person", url, firstName, lastName, jobTitle, companyName };
  }

  function extractCompanyData() {
    const url = normalizeUrl(window.location.href);
    let companyName = "";
    const ogTitle = getMeta("og:title");
    if (ogTitle) companyName = ogTitle.replace(/\s*\|.*$/, "").replace(/\s*-\s*LinkedIn.*$/i, "").trim();
    if (!companyName) companyName = document.title.replace(/\s*\|.*$/, "").trim();
    return { type: "company", url, companyName };
  }

  function getMeta(prop) {
    const el = document.querySelector(`meta[property="${prop}"]`);
    return el ? el.getAttribute("content") || "" : "";
  }

  function normalizeUrl(href) {
    return href.split("?")[0].replace(/\/$/, "");
  }

  function extractProfile() {
    if (/linkedin\.com\/in\//.test(window.location.href)) return extractPersonData();
    if (/linkedin\.com\/company\//.test(window.location.href)) return extractCompanyData();
    return null;
  }

  // ── SPA navigation detection ──
  async function onPageChange() {
    stopBriefPolling();
    const profile = extractProfile();
    currentProfile = profile;
    currentContactId = null;

    if (!profile) {
      showScreen("no-profile");
      return;
    }

    // Auto-check: does this prospect already exist in the system?
    if (profile.type === "person" && profile.url) {
      try {
        const res = await api("GET", `/api/contacts/lookup?url=${encodeURIComponent(profile.url)}`);
        if (res.ok && res.data?.data) {
          const d = res.data.data;
          currentContactId = d.contactId;
          const viewUrl = `${API_BASE}/contacts/${d.contactId}`;

          // Already has a brief — show it immediately
          if (d.brief) {
            showSuccess(true, viewUrl, "person");
            renderBrief(d.brief);
            return;
          }

          // Research in progress — show progress bar and start polling
          if (d.status === "in_progress") {
            showSuccess(true, viewUrl, "person");
            startBriefPolling(d.contactId);
            return;
          }

          // Exists but no brief (failed/pending) — show preview with "Research" button
        }
      } catch {
        // Lookup failed — fall through to normal preview
      }
    }

    showProfilePreview(profile);
  }

  function checkForUrlChange() {
    const url = window.location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(onPageChange, 1500);
    }
  }

  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => checkForUrlChange()).observe(titleEl, { childList: true });
  }
  setInterval(checkForUrlChange, 2000);

  // ── GPM Picker ──
  function renderGpmPicker() {
    const grid = $("#nv-gpm-grid");
    GPM_MEMBERS.forEach((name) => {
      const btn = document.createElement("button");
      btn.className = "nv-gpm-btn";
      btn.textContent = name;
      btn.addEventListener("click", () => selectGpm(name, btn));
      grid.appendChild(btn);
    });
  }

  async function selectGpm(name, btn) {
    shadow.querySelectorAll(".nv-gpm-btn").forEach((b) => (b.disabled = true));
    btn.textContent = "...";

    try {
      let folderId = null;
      const createRes = await api("POST", "/api/folders", { name });

      if (createRes.ok) {
        folderId = createRes.data?.data?.id;
      } else if (createRes.status === 409) {
        const listRes = await api("GET", "/api/folders");
        const existing = (listRes.data?.data || []).find((f) => f.name === name);
        if (existing) folderId = existing.id;
      }

      if (folderId) {
        currentGpmName = name;
        currentFolderId = folderId;
        await chrome.storage.local.set({ gpmName: name, folderId });
        $("#nv-badge").textContent = name;
        onPageChange();
      } else {
        shadow.querySelectorAll(".nv-gpm-btn").forEach((b) => (b.disabled = false));
        btn.textContent = name;
      }
    } catch {
      shadow.querySelectorAll(".nv-gpm-btn").forEach((b) => (b.disabled = false));
      btn.textContent = name;
    }
  }

  // ── Profile Preview ──
  function showProfilePreview(profile) {
    if (profile.type === "person") {
      $("#nv-name").textContent = `${profile.firstName} ${profile.lastName}`.trim() || "Unknown";
      $("#nv-jobtitle").textContent = profile.jobTitle || "";
      $("#nv-company").textContent = profile.companyName || "";
    } else {
      $("#nv-name").textContent = profile.companyName || "Unknown Company";
      $("#nv-jobtitle").textContent = "Company Page";
      $("#nv-company").textContent = "";
    }

    showScreen("preview");

    $("#nv-research-btn").onclick = () => researchProfile(profile);
  }

  // ── Progress bar helpers ──
  const RESEARCH_STEPS = [
    { key: "prospect_lookup",    label: "Looking up prospect...",          pct: 20 },
    { key: "company_enrichment", label: "Enriching company data...",       pct: 45 },
    { key: "industry_analysis",  label: "Analyzing industry fit...",       pct: 65 },
    { key: "ai_intelligence",    label: "Generating AI intelligence...",   pct: 85 },
  ];

  function updateProgressBar(fillId, dotsId, labelId, step, status) {
    const fillEl = $(`#${fillId}`);
    const dotsEl = $(`#${dotsId}`);
    const labelEl = $(`#${labelId}`);
    if (!fillEl) return;

    const isCompleted = status === "completed";
    const isFailed = status === "failed";

    let stepIdx = 0;
    if (step) {
      const idx = RESEARCH_STEPS.findIndex(s => s.key === step);
      if (idx >= 0) stepIdx = idx;
    }
    if (isCompleted) stepIdx = RESEARCH_STEPS.length;

    const pct = isCompleted ? 100 : isFailed ? 0 : (RESEARCH_STEPS[stepIdx]?.pct ?? 10);
    const label = isCompleted
      ? "Done!"
      : isFailed
        ? "Research failed"
        : (RESEARCH_STEPS[stepIdx]?.label ?? "Starting research...");

    fillEl.style.width = pct + "%";
    fillEl.style.background = isFailed ? "#ef4444" : "#7c3aed";
    if (labelEl) labelEl.textContent = label;

    // Update dots
    if (dotsEl) {
      const dots = dotsEl.querySelectorAll(".nv-dot");
      dots.forEach((dot, i) => {
        dot.className = "nv-dot";
        if (i < stepIdx || isCompleted) dot.classList.add("nv-dot-done");
        else if (i === stepIdx && !isFailed) dot.classList.add("nv-dot-active");
      });
    }
  }

  // ── Research ──
  async function researchProfile(profile) {
    showScreen("loading");
    updateProgressBar("nv-loading-fill", "nv-loading-dots", "nv-loading-msg", null);

    const body = { url: profile.url, folderId: currentFolderId || undefined };

    if (profile.type === "person" && profile.firstName) {
      body.extractedData = {
        firstName: profile.firstName,
        lastName: profile.lastName || undefined,
        jobTitle: profile.jobTitle || undefined,
        companyName: profile.companyName || undefined,
      };
    }
    if (profile.type === "company" && profile.companyName) {
      body.extractedData = { companyName: profile.companyName };
    }

    try {
      const res = await api("POST", "/api/research/linkedin", body);

      if (!res.ok) {
        showError(res.data?.error || "Research failed.");
        return;
      }

      const result = res.data?.data;
      let viewUrl = "";
      if (result.type === "person" && result.contactId) {
        viewUrl = `${API_BASE}/contacts/${result.contactId}`;
        currentContactId = result.contactId;
      } else if (result.accountId) {
        viewUrl = `${API_BASE}/accounts/${result.accountId}`;
        currentContactId = null;
      }

      showSuccess(result.existing, viewUrl, result.type);

      // Start polling for intelligence brief
      if (currentContactId) {
        startBriefPolling(currentContactId);
      }
    } catch {
      showError("Network error. Check your connection.");
    }
  }

  // ── Success ──
  function showSuccess(isExisting, viewUrl, type) {
    $("#nv-success-msg").textContent = isExisting ? "Already in the system!" : "Research started!";

    // Reset intelligence section
    $("#nv-intel-loading").classList.remove("nv-hidden");
    $("#nv-intel-content").classList.add("nv-hidden");
    updateProgressBar("nv-intel-fill", "nv-intel-dots", "nv-intel-step-label", null);
    $("#nv-outbound-content").classList.add("nv-hidden");
    $("#nv-outbound-arrow").innerHTML = "&#9656;";

    const link = $("#nv-view-link");
    if (viewUrl) { link.href = viewUrl; link.classList.remove("nv-hidden"); }
    else link.classList.add("nv-hidden");

    const hubBtn = $("#nv-hubspot-btn");
    const hubStatus = $("#nv-hubspot-status");
    hubStatus.className = "nv-hidden";
    $("#nv-hubspot-link").classList.add("nv-hidden");

    if (type === "person" && currentContactId && HUBSPOT_GPMS.has(currentGpmName)) {
      hubBtn.classList.remove("nv-hidden");
      hubBtn.disabled = false;
      hubBtn.textContent = "Push to HubSpot";
      hubBtn.className = "nv-btn nv-btn-hubspot";
      hubBtn.onclick = pushToHubspot;
    } else {
      hubBtn.classList.add("nv-hidden");
    }

    showScreen("success");
  }

  // ── Brief polling ──
  function stopBriefPolling() {
    if (briefPollTimer) {
      clearInterval(briefPollTimer);
      briefPollTimer = null;
    }
  }

  function startBriefPolling(contactId) {
    stopBriefPolling();
    let attempts = 0;
    const maxAttempts = 30; // 30 × 3s = 90s max

    async function poll() {
      attempts++;
      try {
        const res = await api("GET", `/api/contacts/${contactId}/brief`);
        const d = res.data?.data;

        // Update progress bar with current step
        if (d) {
          updateProgressBar("nv-intel-fill", "nv-intel-dots", "nv-intel-step-label", d.step, d.status);
        }

        if (res.ok && d?.brief) {
          stopBriefPolling();
          renderBrief(d.brief);
          return;
        }

        // Check for failure
        if (d?.status === "failed") {
          stopBriefPolling();
          updateProgressBar("nv-intel-fill", "nv-intel-dots", "nv-intel-step-label", null, "failed");
          return;
        }
      } catch {
        // ignore poll errors
      }

      if (attempts >= maxAttempts) {
        stopBriefPolling();
        // Show fallback — just hide the loading spinner
        $("#nv-intel-loading").classList.add("nv-hidden");
      }
    }

    // First poll immediately
    poll();
    briefPollTimer = setInterval(poll, 3000);
  }

  function renderBrief(briefJson) {
    try {
      const brief = typeof briefJson === "string" ? JSON.parse(briefJson) : briefJson;

      // Pain points — condensed to 1 sentence each
      const ppList = $("#nv-pp-list");
      ppList.innerHTML = "";
      const painPoints = brief.prospect?.painPointsTable || [];
      const topTwo = painPoints.slice(0, 2);

      topTwo.forEach((pp) => {
        const row = document.createElement("div");
        row.className = "nv-pp-row";
        row.innerHTML = `
          <div class="nv-pp-problem">${escHtml(pp.problem)}</div>
          <div class="nv-pp-impact">${escHtml(pp.impact)}</div>
        `;
        ppList.appendChild(row);
      });

      // Outbound material
      const outbound = brief.outbound;
      if (outbound) {
        if (outbound.emailSubject) {
          $("#nv-email-subject").textContent = outbound.emailSubject;
          $("#nv-email-body").textContent = outbound.emailBody || "";
        }

        const callScript = outbound.coldCallScript;
        if (callScript) {
          const callEl = $("#nv-call-content");
          callEl.innerHTML = "";
          const parts = [
            { label: "Opener", text: callScript.opener },
            { label: "Trigger", text: callScript.trigger },
            { label: "Problem>Impact", text: callScript.problemImpact },
            { label: "CTA", text: callScript.cta },
          ];
          parts.forEach((p) => {
            if (!p.text) return;
            const div = document.createElement("div");
            div.className = "nv-call-part";
            div.innerHTML = `<span class="nv-call-label">${p.label}:</span> ${escHtml(p.text)}`;
            callEl.appendChild(div);
          });
        }
      }

      // Show intelligence, hide loading
      $("#nv-intel-loading").classList.add("nv-hidden");
      $("#nv-intel-content").classList.remove("nv-hidden");
    } catch {
      // Brief parsing failed
      $("#nv-intel-loading").classList.add("nv-hidden");
    }
  }

  function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // ── HubSpot ──
  async function pushToHubspot() {
    const btn = $("#nv-hubspot-btn");
    const status = $("#nv-hubspot-status");
    btn.disabled = true;
    btn.textContent = "Pushing...";
    status.className = "nv-hidden";

    try {
      const res = await api("POST", "/api/hubspot/push-contact", {
        contactId: currentContactId,
        gpmName: currentGpmName,
      });

      if (!res.ok) {
        btn.textContent = "Push to HubSpot";
        btn.disabled = false;
        status.textContent = res.data?.error || "Push failed.";
        status.className = "nv-status-error";
        return;
      }

      btn.textContent = "Synced!";
      btn.className = "nv-btn nv-btn-hubspot nv-pushed";
      status.textContent = "Contact synced to HubSpot.";
      status.className = "nv-status-success";

      // Show HubSpot link if URL was returned
      const hubspotUrl = res.data?.data?.hubspotUrl;
      if (hubspotUrl) {
        const hsLink = $("#nv-hubspot-link");
        hsLink.href = hubspotUrl;
        hsLink.classList.remove("nv-hidden");
      }
    } catch {
      btn.textContent = "Push to HubSpot";
      btn.disabled = false;
      status.textContent = "Network error.";
      status.className = "nv-status-error";
    }
  }

  // ── Error ──
  function showError(msg) {
    $("#nv-error-msg").textContent = msg;
    showScreen("error");
    $("#nv-retry-btn").onclick = () => {
      if (currentProfile) showProfilePreview(currentProfile);
      else showScreen("no-profile");
    };
  }

  // ── Init ──
  async function init() {
    const stored = await chrome.storage.local.get(["gpmName", "folderId", "nvSide", "nvAutoOpen", "nvTabY"]);
    if (stored.nvSide) sidebarSide = stored.nvSide;
    if (stored.nvAutoOpen !== undefined) autoOpen = stored.nvAutoOpen;
    if (stored.nvTabY !== undefined) tabY = stored.nvTabY;
    sidebarOpen = autoOpen;

    // Sync preferences UI
    $("#nv-auto-open").checked = autoOpen;

    updatePosition();

    // Fetch Lusha credits
    fetchLushaCredits();

    if (!stored.gpmName || !stored.folderId) {
      renderGpmPicker();
      showScreen("setup");
      return;
    }

    currentGpmName = stored.gpmName;
    currentFolderId = stored.folderId;
    $("#nv-badge").textContent = stored.gpmName;
    renderGpmPicker();

    lastUrl = window.location.href;
    onPageChange();
  }

  init();

  // ── Styles ──
  function getStyles() {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      #nv-container {
        pointer-events: auto;
        position: fixed;
        top: 0;
        height: 100vh;
        display: flex;
        align-items: flex-start;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1a1a2e;
      }

      #nv-container.nv-side-right {
        right: 0;
        flex-direction: row-reverse;
      }

      #nv-container.nv-side-left {
        left: 0;
        flex-direction: row;
      }

      /* ── Tab (collapsed state) ── */
      #nv-tab {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background: #7c3aed;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        margin: 0 4px;
        transition: transform 0.15s;
        flex-shrink: 0;
      }

      #nv-tab { cursor: grab; user-select: none; }
      #nv-tab:hover { transform: scale(1.1); }
      #nv-tab:active { cursor: grabbing; }
      #nv-tab-icon { width: 24px; height: 24px; border-radius: 50%; pointer-events: none; }

      /* ── Panel ── */
      #nv-panel {
        width: 300px;
        margin-top: 80px;
        max-height: calc(100vh - 100px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transition: opacity 0.2s, transform 0.2s;
      }

      #nv-panel.nv-collapsed {
        width: 0;
        opacity: 0;
        pointer-events: none;
        transform: scale(0.95);
      }

      /* ── Header ── */
      #nv-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 14px;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
      }

      .nv-logo { width: 28px; height: 28px; border-radius: 50%; }
      .nv-title { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
      .nv-subtitle { font-size: 11px; color: #6b7280; }

      #nv-badge {
        margin-left: auto;
        font-size: 12px;
        font-weight: 600;
        color: #7c3aed;
        background: #f3f0ff;
        padding: 2px 6px;
        border-radius: 8px;
      }
      #nv-badge:empty { display: none; }

      .nv-header-actions {
        display: flex;
        gap: 2px;
      }

      .nv-header-actions button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 16px;
        color: #9ca3af;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }

      .nv-header-actions button:hover {
        background: #f3f4f6;
        color: #374151;
      }

      /* ── Body ── */
      #nv-body {
        padding: 14px;
        overflow-y: auto;
        flex: 1;
      }

      .nv-hidden { display: none !important; }

      .nv-msg {
        font-size: 13px;
        color: #6b7280;
        text-align: center;
        margin-bottom: 10px;
      }

      .nv-muted { color: #9ca3af; padding: 20px 0; }

      /* ── GPM Grid ── */
      #nv-gpm-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 5px;
      }

      .nv-gpm-btn {
        padding: 7px 2px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #fff;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
        color: #1a1a2e;
      }

      .nv-gpm-btn:hover {
        background: #f3f0ff;
        border-color: #7c3aed;
        color: #7c3aed;
      }

      .nv-gpm-btn:disabled { opacity: 0.5; cursor: wait; }

      /* ── Profile Card ── */
      #nv-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
      }

      #nv-name { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
      #nv-jobtitle { font-size: 13px; color: #6b7280; }
      #nv-company { font-size: 13px; font-weight: 600; color: #7c3aed; margin-top: 3px; }
      #nv-company:empty { display: none; }

      /* ── Buttons ── */
      .nv-btn {
        display: block;
        width: 100%;
        padding: 8px 12px;
        border: none;
        border-radius: 7px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        text-decoration: none;
        transition: all 0.15s;
        color: #fff;
      }

      .nv-btn + .nv-btn { margin-top: 6px; }

      .nv-btn-primary { background: #7c3aed; }
      .nv-btn-primary:hover { background: #6d28d9; }
      .nv-btn-primary:disabled { background: #c4b5fd; cursor: not-allowed; }

      .nv-btn-outline {
        background: #fff;
        color: #7c3aed;
        border: 1px solid #7c3aed;
      }
      .nv-btn-outline:hover { background: #f3f0ff; }

      .nv-btn-hubspot { background: #ff7a59; }
      .nv-btn-hubspot:hover { background: #e66a4a; }
      .nv-btn-hubspot:disabled { background: #fdb9a7; cursor: not-allowed; }
      .nv-pushed { background: #10b981 !important; }

      .nv-btn-hs-link {
        background: #fff;
        color: #ff7a59;
        border: 1px solid #ff7a59;
        font-size: 13px;
      }
      .nv-btn-hs-link:hover { background: #fff5f3; }

      /* ── Success / Error ── */
      .nv-success-icon {
        text-align: center;
        font-size: 28px;
        color: #10b981;
        margin-bottom: 4px;
      }

      .nv-error-text { color: #ef4444 !important; }

      .nv-status-error {
        font-size: 12px;
        text-align: center;
        margin-top: 5px;
        padding: 5px 8px;
        border-radius: 5px;
        color: #ef4444;
        background: #fef2f2;
      }

      .nv-status-success {
        font-size: 12px;
        text-align: center;
        margin-top: 5px;
        padding: 5px 8px;
        border-radius: 5px;
        color: #10b981;
        background: #ecfdf5;
      }

      /* ── Progress bar ── */
      .nv-progress-bar {
        height: 6px;
        background: #e5e7eb;
        border-radius: 999px;
        overflow: hidden;
        margin: 14px 0 8px;
      }
      .nv-progress-bar.nv-progress-sm {
        height: 5px;
        margin: 10px 0 6px;
      }
      .nv-progress-fill {
        height: 100%;
        width: 10%;
        background: #7c3aed;
        border-radius: 999px;
        transition: width 0.7s ease-out;
      }
      .nv-progress-dots {
        display: flex;
        justify-content: space-between;
        padding: 0 2px;
        margin-bottom: 8px;
      }
      .nv-progress-dots-sm {
        margin-bottom: 6px;
      }
      .nv-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #d1d5db;
        transition: background 0.4s, box-shadow 0.4s;
      }
      .nv-dot-done {
        background: #7c3aed;
      }
      .nv-dot-active {
        background: #7c3aed;
        box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.25);
        animation: nv-pulse 1.5s ease-in-out infinite;
      }
      @keyframes nv-pulse {
        0%, 100% { box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.25); }
        50% { box-shadow: 0 0 0 5px rgba(124, 58, 237, 0.1); }
      }

      /* ── Intelligence section ── */
      #nv-intel {
        margin: 10px 0;
        border-top: 1px solid #e5e7eb;
        padding-top: 10px;
      }

      .nv-intel-label {
        font-size: 13px;
        margin-bottom: 4px;
      }

      .nv-section-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #7c3aed;
        margin-bottom: 6px;
      }

      /* Pain points */
      .nv-pp-row {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 5px;
      }

      .nv-pp-problem {
        font-size: 13px;
        font-weight: 600;
        color: #1a1a2e;
        line-height: 1.3;
      }

      .nv-pp-impact {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
        line-height: 1.3;
      }

      /* Outbound collapse */
      .nv-collapse-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        background: none;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 7px 10px;
        margin-top: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        transition: all 0.15s;
      }

      .nv-collapse-toggle:hover {
        background: #f9fafb;
        border-color: #7c3aed;
        color: #7c3aed;
      }

      .nv-arrow {
        font-size: 12px;
        color: #9ca3af;
      }

      /* Outbound content */
      #nv-outbound-content {
        margin-top: 8px;
      }

      .nv-outbound-label {
        font-size: 12px;
        font-weight: 600;
        color: #374151;
        margin-bottom: 4px;
        margin-top: 8px;
      }

      .nv-outbound-label:first-child { margin-top: 0; }

      .nv-email-subject {
        font-size: 13px;
        font-weight: 600;
        color: #1a1a2e;
        padding: 6px 8px;
        background: #f3f0ff;
        border-radius: 4px;
        margin-bottom: 4px;
      }

      .nv-email-body {
        font-size: 12px;
        color: #374151;
        padding: 6px 8px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        line-height: 1.4;
        white-space: pre-wrap;
      }

      .nv-call-content {
        font-size: 12px;
        color: #374151;
        padding: 6px 8px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        line-height: 1.4;
      }

      .nv-call-part {
        margin-bottom: 4px;
      }

      .nv-call-part:last-child { margin-bottom: 0; }

      .nv-call-label {
        font-weight: 700;
        color: #7c3aed;
        font-size: 10px;
        text-transform: uppercase;
      }

      .nv-copy-btn {
        display: block;
        width: 100%;
        margin-top: 4px;
        padding: 4px 8px;
        background: none;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }

      .nv-copy-btn:hover {
        border-color: #7c3aed;
        color: #7c3aed;
      }

      /* Actions at bottom */
      .nv-actions {
        margin-top: 10px;
      }

      /* ── Footer ── */
      #nv-footer {
        border-top: 1px solid #e5e7eb;
        padding: 10px 14px;
        flex-shrink: 0;
      }

      /* Credits */
      .nv-credits-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .nv-credits-label {
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
      }

      #nv-credits-count {
        font-size: 12px;
        color: #9ca3af;
      }

      .nv-credits-bar {
        height: 4px;
        background: #e5e7eb;
        border-radius: 2px;
        overflow: hidden;
      }

      #nv-credits-fill {
        height: 100%;
        background: #7c3aed;
        border-radius: 2px;
        transition: width 0.3s;
        width: 0%;
      }

      /* Preferences */
      .nv-prefs-toggle-btn {
        margin-top: 8px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        transition: background 0.15s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .nv-prefs-toggle-btn:hover {
        background: #f3f4f6;
      }

      .nv-prefs-gear {
        font-size: 20px;
        line-height: 1;
        color: #9ca3af;
        transition: color 0.15s;
      }

      .nv-prefs-toggle-btn:hover .nv-prefs-gear {
        color: #6b7280;
      }

      #nv-prefs-content {
        margin-top: 8px;
      }

      .nv-pref-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
      }

      .nv-pref-label {
        font-size: 13px;
        color: #374151;
        font-weight: 500;
      }

      /* Position toggle (L / R) */
      .nv-pos-toggle {
        display: flex;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        overflow: hidden;
      }

      .nv-pos-btn {
        padding: 4px 12px;
        border: none;
        background: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        color: #6b7280;
        transition: all 0.15s;
      }

      .nv-pos-btn + .nv-pos-btn {
        border-left: 1px solid #e5e7eb;
      }

      .nv-pos-btn.nv-pos-active {
        background: #7c3aed;
        color: #fff;
      }

      /* Auto open switch */
      .nv-switch {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 18px;
      }

      .nv-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .nv-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: #d1d5db;
        border-radius: 18px;
        transition: 0.2s;
      }

      .nv-slider::before {
        content: "";
        position: absolute;
        height: 14px;
        width: 14px;
        left: 2px;
        bottom: 2px;
        background: #fff;
        border-radius: 50%;
        transition: 0.2s;
      }

      .nv-switch input:checked + .nv-slider {
        background: #7c3aed;
      }

      .nv-switch input:checked + .nv-slider::before {
        transform: translateX(16px);
      }
    `;
  }
})();
