/**
 * Nat-vigator — LinkedIn Experience parser.
 *
 * Loaded as a classic content script BEFORE content.js (see manifest.json), and
 * also unit-tested directly via Vitest. Pure: no DOM / chrome APIs — it takes the
 * page's `innerText` string and returns structured entries.
 *
 * Why this exists: a prospect can hold several *current* ("Present") roles at once
 * (e.g. "Manager @ Busy Bees Asia" + "Divemaster @ PADI"). The old parser grabbed
 * the first title/company it saw with no notion of currency, which made Nat-vigator
 * research the wrong company. LinkedIn renders the most relevant role on top, so the
 * rule is: pick the TOPMOST role that is still current; fall back to the topmost
 * role overall when none are marked Present.
 */
(function (root) {
  "use strict";

  // ── Line classifiers ──────────────────────────────────────────────────────
  const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const EMPLOYMENT_TYPES =
    "full-time|part-time|contract|freelance|internship|self-employed|seasonal|apprenticeship|permanent|temporary";
  const EMP_RE = new RegExp("\\b(" + EMPLOYMENT_TYPES + ")\\b", "i");
  const INLINE_COMPANY_RE = new RegExp("·\\s*(" + EMPLOYMENT_TYPES + ")\\b", "i");
  const DURATION_RE = /\b\d+\s*(yr|yrs|mo|mos|year|years|month|months)\b/i;
  const BARE_TENURE_RE =
    /^\d+\s*(yr|yrs|mo|mos|year|years|month|months)(\s+\d+\s*(mo|mos|month|months))?$/i;
  const DATE_START_RE = new RegExp("^(" + MONTH + ")\\.?\\s+\\d{4}\\b", "i");
  const YEAR_START_RE = /^\d{4}\b/;
  const BULLET_RE = /^[•·\-*•]/;

  // Section labels that can follow "Experience" on a profile — used to bound the
  // window so we never bleed into Education / Skills / etc.
  const NEXT_SECTIONS = new Set(
    [
      "education",
      "licenses & certifications",
      "licenses and certifications",
      "volunteering",
      "volunteer experience",
      "skills",
      "courses",
      "projects",
      "honors & awards",
      "honors and awards",
      "languages",
      "organizations",
      "recommendations",
      "causes",
      "interests",
      "featured",
      "publications",
      "patents",
      "test scores",
      "people also viewed",
      "promoted",
      "activity",
    ].map((s) => s.toLowerCase()),
  );

  // Words that strongly imply a role title (used only for the ambiguous fallback
  // where an inline role omits its employment type).
  const ROLE_RE =
    /\b(manager|director|officer|engineer|analyst|consultant|developer|designer|lead|head|vp|svp|evp|ceo|cto|cfo|coo|cmo|president|founder|co-founder|coordinator|specialist|executive|associate|architect|advisor|strategist|partner|principal|chief|intern|owner|representative|administrator|supervisor|technician|scientist|researcher|teacher|instructor|accountant|controller|recruiter|ambassador|divemaster)\b/i;
  // Words / suffixes that strongly imply a company name.
  const COMPANY_RE =
    /\b(pte|ltd|llc|inc|corp|co\.|company|international|holdings|group|ventures|enterprise|enterprises|sdn|bhd|gmbh|s\.a\.|pty|technologies|solutions|systems|labs|studio|studios|agency|partners|capital|bank|university|college|school|hospital|clinic)\b/i;

  /**
   * A per-role date line ("Dec 2025 - Present · 6 mos", "2019 - 2021").
   * Must START with a month+year or a 4-digit year AND contain a range / Present /
   * duration marker — so description bullets that merely mention a year don't match.
   * @param {string} t
   * @returns {boolean}
   */
  function isDateRangeLine(t) {
    const s = t.trim();
    if (!(DATE_START_RE.test(s) || YEAR_START_RE.test(s))) return false;
    return /[-–—]|\bto\b|present/i.test(s) || /·/.test(s) || DURATION_RE.test(s);
  }

  /** @param {string} t @returns {boolean} — date line that is still current. */
  function isCurrentDateLine(t) {
    return /\bpresent\b/i.test(t);
  }

  /**
   * A grouped-company total-tenure line — the line that sits between a grouped
   * company header and its first role. Never carries a calendar year.
   * e.g. "2 yrs 11 mos", "Full-time · 5 yrs 9 mos", "5 yrs · Full-time".
   * @param {string} t
   * @returns {boolean}
   */
  function isGroupedTenureLine(t) {
    const s = t.trim();
    if (isDateRangeLine(s)) return false;
    if (BARE_TENURE_RE.test(s)) return true;
    return EMP_RE.test(s) && DURATION_RE.test(s);
  }

  /** Inline company line: "Busy Bees Asia · Full-time". @param {string} t */
  function isInlineCompanyLine(t) {
    return INLINE_COMPANY_RE.test(t);
  }

  /** Text before the first "·" separator (drops the "· Full-time" tail). */
  function mainPart(t) {
    return t.split("·")[0].trim();
  }

  function isBullet(t) {
    return BULLET_RE.test(t.trim());
  }

  function isLocationLine(t) {
    return /\b(on-site|remote|hybrid)\b/i.test(t) && t.length < 60;
  }

  function looksLikeRole(t) {
    return ROLE_RE.test(t);
  }

  function looksLikeCompany(t) {
    return COMPANY_RE.test(t);
  }

  /** Lines that are never a title or company on their own. */
  function isStructuralNoise(t) {
    const s = t.trim();
    if (!s) return true;
    if (isDateRangeLine(s) || isGroupedTenureLine(s)) return true;
    if (isBullet(s) || isLocationLine(s)) return true;
    if (EMP_RE.test(s) && s.replace(EMP_RE, "").replace(/[·\s]/g, "") === "") return true;
    return false;
  }

  /** Normalise a candidate title line; returns "" when it isn't a usable title. */
  function cleanTitle(t) {
    if (!t) return "";
    const s = mainPart(t).trim();
    if (!s || s.length < 2 || s.length > 150) return "";
    if (isStructuralNoise(s)) return "";
    return s;
  }

  /**
   * Slice the lines belonging to the Experience section out of full-page innerText.
   * Bounds the window at the next known section header (or a generous line cap).
   * @param {string} bodyText
   * @returns {string[]}
   */
  function sliceExperienceSection(bodyText) {
    if (!bodyText || typeof bodyText !== "string") return [];
    const lines = bodyText.split("\n").map((l) => l.trim());
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase() === "experience") {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return [];

    const out = [];
    const MAX_LINES = 160; // topmost current role is always near the top
    for (let i = start; i < lines.length && out.length < MAX_LINES; i++) {
      const l = lines[i];
      if (!l) continue;
      if (l.toLowerCase() === "experience") continue; // a11y-duplicated header
      if (NEXT_SECTIONS.has(l.toLowerCase())) break;
      out.push(l);
    }
    return out;
  }

  /**
   * Collapse consecutive identical lines. LinkedIn renders an aria-hidden span and
   * a visually-hidden (clip-based) span for most fields, so innerText doubles every
   * line: "Title\nTitle\nCompany\nCompany\n…". The duplicates are always adjacent.
   * @param {string[]} lines
   * @returns {string[]}
   */
  function dedupeAdjacent(lines) {
    const out = [];
    for (const line of lines) {
      const prev = out[out.length - 1];
      if (prev && prev.toLowerCase() === line.toLowerCase()) continue;
      out.push(line);
    }
    return out;
  }

  /**
   * Parse the Experience section into ordered role entries.
   * @param {string} bodyText - document.body.innerText
   * @returns {{ entries: Array<{title:string, company:string, isCurrent:boolean}>, primary: ({title:string, company:string, isCurrent:boolean}|null) }}
   */
  function parseExperienceSection(bodyText) {
    const lines = dedupeAdjacent(sliceExperienceSection(bodyText));
    const entries = [];
    let groupCompany = null; // most recent grouped-company header

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Grouped company header: the line above a total-tenure line.
      if (isGroupedTenureLine(line)) {
        const header = i > 0 ? lines[i - 1] : "";
        if (header && !isStructuralNoise(header)) groupCompany = header;
        continue;
      }

      // Anchor every entry on its date-range line; title/company sit just above it.
      if (!isDateRangeLine(line)) continue;

      const prev = i > 0 ? lines[i - 1] : "";
      const prev2 = i > 1 ? lines[i - 2] : "";
      let title = "";
      let company = "";

      if (isInlineCompanyLine(prev)) {
        // Inline layout: "Title" / "Company · Type" / "Dates"
        company = mainPart(prev);
        title = cleanTitle(prev2);
        groupCompany = null; // an inline entry ends any open group
      } else if (groupCompany) {
        // Grouped role: "Title" / "Dates", company taken from the group header.
        title = cleanTitle(prev);
        company = groupCompany;
      } else if (looksLikeRole(prev) && !looksLikeCompany(prev)) {
        // Inline role with the employment type omitted, and prev reads as a title.
        title = cleanTitle(prev);
        company = "";
      } else {
        // Inline-without-type: "Title" / "Company" / "Dates".
        company = mainPart(prev);
        title = cleanTitle(prev2);
      }

      // Safety net: correct an obvious title↔company swap.
      if (looksLikeCompany(title) && looksLikeRole(company)) {
        const tmp = title;
        title = company;
        company = tmp;
      }

      if (title || company) {
        entries.push({ title, company, isCurrent: isCurrentDateLine(line) });
      }
    }

    return { entries, primary: pickPrimary(entries) };
  }

  /**
   * Select the role Nat-vigator should research: the topmost CURRENT role with a
   * company, then any topmost current role, then the topmost role overall.
   * @param {Array<{title:string, company:string, isCurrent:boolean}>} entries
   * @returns {{title:string, company:string, isCurrent:boolean}|null}
   */
  function pickPrimary(entries) {
    if (!entries || entries.length === 0) return null;
    return (
      entries.find((e) => e.isCurrent && e.company) ||
      entries.find((e) => e.isCurrent) ||
      entries[0]
    );
  }

  const api = {
    parseExperienceSection,
    pickPrimary,
    // exposed for unit tests
    _internals: {
      isDateRangeLine,
      isGroupedTenureLine,
      isInlineCompanyLine,
      isCurrentDateLine,
      sliceExperienceSection,
      dedupeAdjacent,
    },
  };

  root.NatvigatorExperience = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
