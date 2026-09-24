/* app.js — Main form logic for Homeview Property Group */

/* ============================================================
   CONFIG
   ============================================================ */
const WEBHOOK_URL = "https://hook.eu1.make.com/9nwpq3h5eheub2qaoxn1vmbxd4n81got";
const SUPABASE_URL = "https://uymidpurzgjqzmqssjuc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5bWlkcHVyemdqcXptcXNzanVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjA2OTYsImV4cCI6MjEwNTgzNjY5Nn0.cAhbIiaM4lZxcz8IBxD4We6VRB7_j_2TXMYEaJy8VV0";
const SUPABASE_BUCKET = "homereview-files";
const SUPABASE_TABLE = "homereview_submissions";

function getSupabaseClient() {
  if (!window._hrSupabase && window.supabase) {
    window._hrSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return window._hrSupabase;
}

/* Upload files to Supabase Storage and return an array of public URLs */
async function uploadFilesToSupabase(files, onProgress) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client is not available");

  const urls = [];
  const total = files.length;
  const datePrefix = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  for (let i = 0; i < total; i++) {
    if (onProgress) {
      onProgress(
        Math.round((i / total) * 80),
        `Uploading photo ${i + 1} of ${total}…`
      );
    }
    const file = files[i];
    const random = Math.random().toString(36).substring(2, 10);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${datePrefix}/${random}_${safeName}`;

    const { error } = await client.storage
      .from(SUPABASE_BUCKET)
      .upload(path, file, { cacheControl: "31536000", upsert: false });

    if (error) {
      console.error(`Upload failed for ${file.name}:`, error);
      throw new Error(`Upload failed for ${file.name}: ${error.message}`);
    }

    const { data: urlData } = client.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(path);

    urls.push(urlData.publicUrl);
  }
  return urls;
}

/* ============================================================
   STATE
   ============================================================ */
let state = {
  currentStep: 1,
  selectedCategory: null,
  selectedIssue: null,
  uploadedFiles: [],
  priority: "routine",
  keysAllowed: "",
  hasPets: "",
  petsDetails: "",
  selectedDates: [],   // array of ISO date strings e.g. ["2025-07-22"]
  selectedSlots: {},   // key: date string, value: array of bands e.g. {"2026-07-22": ["AM"]}
  ts: {},           // key: question id, value: answer value
  tsQA: [],         // array of {q: "question text", a: "answer label"}
  tsBuiltForCode: null, // track which issue the troubleshoot was built for
  internal: {
    engineer_required: false,
    request_closed: false,
    responsibility_type: "",
    alert_type: "",
    troubleshooting_path: [],
    final_action: ""
  }
};

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  buildCategoryGrid();
  buildDatePicker();
  setupDragDrop();
  document.getElementById("repair-form").addEventListener("submit", handleSubmit);

  // Close dropdowns on outside click
  document.addEventListener("click", e => {
    const issueWrap = document.getElementById("issue-select-wrap");
    const issueDd = document.getElementById("issue-dropdown");
    if (issueWrap && issueDd && !issueWrap.contains(e.target)) {
      issueDd.classList.add("hidden");
    }
    // Close video modal on backdrop click
    if (e.target.id === "video-modal") {
      closeVideoModal();
    }
  });

  // ESC closes video modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeVideoModal();
  });
});

/* ============================================================
   CATEGORY GRID BUILDER
   ============================================================ */
function buildCategoryGrid() {
  const grid = document.getElementById("category-grid");
  if (!grid) return;
  grid.innerHTML = "";

  CATEGORIES.forEach(cat => {
    const card = document.createElement("div");
    card.className = "category-card";
    card.dataset.id = cat.id;
    card.innerHTML = `
      <div class="category-card-icon">${cat.icon}</div>
      <div class="category-card-label">${cat.label}</div>
    `;
    card.addEventListener("click", () => selectCategory(cat));
    grid.appendChild(card);
  });
}

function selectCategory(cat) {
  state.selectedCategory = cat;

  // Highlight selected card
  document.querySelectorAll(".category-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.id === cat.id);
  });

  // Update hidden elements
  document.getElementById("category-id").value = cat.id;
  document.getElementById("category-label").value = cat.label;
  document.getElementById("category-error").textContent = "";

  // Reset selected issue since category changed
  state.selectedIssue = null;
  document.getElementById("issue-search").value = "";
  document.getElementById("issue-code").value = "";
  document.getElementById("issue-label").value = "";
  document.getElementById("other-issue-group").classList.add("hidden");
  document.getElementById("other-issue").required = false;
  document.getElementById("other-issue").value = "";
  document.getElementById("help-video-container").classList.add("hidden");

  // Re-build filtered issue dropdown
  buildIssueDropdown();
}

/* ============================================================
   ISSUE DROPDOWN BUILDER (FILTERED BY CATEGORY)
   ============================================================ */
function buildIssueDropdown() {
  const list = document.getElementById("issue-dropdown-list");
  if (!list) return;
  list.innerHTML = "";

  if (!state.selectedCategory) {
    list.innerHTML = '<div class="issue-option no-results" style="color:var(--text-subtle);text-align:center;">Please select a category first.</div>';
    return;
  }

  state.selectedCategory.issues.forEach(issue => {
    const opt = document.createElement("div");
    opt.className = "issue-option";
    // Suffix / code stripped from UI display label
    opt.textContent = issue.label;
    opt.dataset.code = issue.code;
    opt.addEventListener("click", () => selectIssue(issue, opt));
    list.appendChild(opt);
  });
}

function openIssueDropdown() {
  const dd = document.getElementById("issue-dropdown");
  if (dd) dd.classList.remove("hidden");
  setTimeout(() => {
    const s = document.getElementById("issue-dropdown-search");
    if (s) s.focus();
  }, 50);
}

function filterIssues(query) {
  const q = query.toLowerCase();
  document.querySelectorAll("#issue-dropdown-list .issue-option").forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function selectIssue(issue, optEl) {
  state.selectedIssue = issue;

  document.querySelectorAll(".issue-option").forEach(el => el.classList.remove("selected"));
  if (optEl) optEl.classList.add("selected");

  // Set selected label without code suffix in text input
  document.getElementById("issue-search").value = issue.label;
  document.getElementById("issue-code").value = issue.code;
  document.getElementById("issue-label").value = issue.label;

  const dd = document.getElementById("issue-dropdown");
  if (dd) dd.classList.add("hidden");

  document.getElementById("issue-error").textContent = "";

  // Urgent/Emergency indicators
  const urgentBanner = document.getElementById("urgent-banner");
  const emergencyBanner = document.getElementById("emergency-banner");
  if (urgentBanner) urgentBanner.classList.toggle("hidden", !issue.urgent);
  if (emergencyBanner) emergencyBanner.classList.toggle("hidden", !issue.emergency);

  // If issue is "Other" description textarea
  const otherGroup = document.getElementById("other-issue-group");
  if (otherGroup) {
    if (issue.code === "RC-999G") {
      otherGroup.classList.remove("hidden");
      document.getElementById("other-issue").required = true;
    } else {
      otherGroup.classList.add("hidden");
      document.getElementById("other-issue").required = false;
      document.getElementById("other-issue").value = "";
    }
  }

  // Check and show helper video inline
  checkShowHelpVideo(issue.code);

  // Reset troubleshoot state and immediately rebuild for this issue
  state.ts = {};
  state.tsQA = [];
  state.internal = {
    engineer_required: false,
    request_closed: false,
    responsibility_type: "",
    alert_type: "",
    troubleshooting_path: [],
    final_action: ""
  };
  buildTroubleshootSection();
  state.tsBuiltForCode = issue.code;
}

/* ============================================================
   INLINE HELP VIDEOS
   ============================================================ */
function checkShowHelpVideo(code) {
  const container = document.getElementById("help-video-container");
  if (!container) return;
  container.innerHTML = "";
  container.classList.add("hidden");

  let videoData = null;

  // Map issue codes to help videos
  if (code === "RC-001R" || code === "RC-002A" || code === "RC-006R" || code === "RC-007A") {
    // Reset boiler or pressurise
    videoData = {
      title: "💡 Try resetting your boiler or checking pressure",
      desc: "Many heating and hot water lockouts can be solved without an engineer. Watch this guide to re-pressurise and reset your boiler.",
      url: "https://youtu.be/I3HgvV2mIqY?si=Wuk_UPaR_3rSx3v1",
      btnText: "Watch Boiler Guide"
    };
  } else if (code === "RC-086G" || code === "RC-083G") {
    // Clean filter
    videoData = {
      title: "💡 Try cleaning the appliance filter",
      desc: "If your appliance is blocked or smelling, cleaning the filter is the first step. Watch this video to see how to do it safely.",
      url: "https://www.youtube.com/watch?v=sW1m0f_F4w4",
      btnText: "Watch Filter Cleaning Guide"
    };
  } else if (code === "RC-044A") {
    // Spotlight bulb
    videoData = {
      title: "💡 How to safely replace a spotlight bulb",
      desc: "Before reporting a broken light, try changing the bulb. Watch this tutorial on how to safely replace a GU10 spotlight bulb.",
      url: "https://www.youtube.com/watch?v=e_t2jRpeW3A",
      btnText: "Watch Spotlight Bulb Guide"
    };
  }

  if (videoData) {
    container.innerHTML = `
      <div style="background:rgba(0, 130, 130, 0.05); border: 1.5px solid rgba(0, 130, 130, 0.25); border-radius:var(--radius-sm); padding:1rem 1.25rem;">
        <h4 style="color:var(--accent); font-size:0.92rem; font-weight:700; margin-bottom:0.25rem;">${videoData.title}</h4>
        <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:0.75rem;">${videoData.desc}</p>
        <button type="button" class="ts-help-link" style="margin-bottom:0;" onclick="openVideoModal('${videoData.url}')">▶ ${videoData.btnText}</button>
      </div>
    `;
    container.classList.remove("hidden");
  }
}

/* ============================================================
   ACCESS & PREFERENCES SELECTORS
   ============================================================ */
function selectPriorityBtn(priority) {
  state.priority = priority;
  document.getElementById("priority").value = priority;

  document.querySelectorAll(".priority-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.priority === priority);
  });
  document.getElementById("priority-error").textContent = "";
}

function selectKeysOption(value) {
  state.keysAllowed = value;
  document.getElementById("keys-allowed").value = value;

  const group = document.getElementById("keys-group");
  group.querySelectorAll(".radio-btn-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.value === value);
  });
  document.getElementById("keys-error").textContent = "";
}

function selectPetsOption(value) {
  state.hasPets = value;
  document.getElementById("has-pets").value = value;

  const group = document.getElementById("pets-group");
  group.querySelectorAll(".radio-btn-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.value === value);
  });
  document.getElementById("pets-error").textContent = "";

  const detailsGroup = document.getElementById("pets-details-group");
  if (value === "yes") {
    detailsGroup.classList.remove("hidden");
    document.getElementById("pets-details").required = true;
  } else {
    detailsGroup.classList.add("hidden");
    document.getElementById("pets-details").required = false;
    document.getElementById("pets-details").value = "";
  }
}

/* ============================================================
   APPOINTMENT DATE PICKER (Max 2 dates, independent slots)
   ============================================================ */
const BAND_LABELS = { AM: "Morning (8am–12pm)", PM: "Afternoon (12pm–5pm)", EVE: "Evening (5pm–8pm)" };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildDatePicker() {
  const row = document.getElementById("appt-date-row");
  if (!row) return;
  row.innerHTML = "";
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    const pill = document.createElement("div");
    pill.className = "appt-date-pill";
    pill.dataset.date = iso;
    pill.innerHTML = `
      <span class="appt-pill-day">${DAY_NAMES[d.getDay()]}</span>
      <span class="appt-pill-date">${d.getDate()}</span>
      <span class="appt-pill-month">${MONTH_NAMES[d.getMonth()]}</span>
    `;
    pill.addEventListener("click", () => toggleDatePill(pill, iso));
    row.appendChild(pill);
  }
}

function toggleDatePill(el, iso) {
  const isSelected = el.classList.contains("selected");
  if (isSelected) {
    el.classList.remove("selected");
    state.selectedDates = state.selectedDates.filter(d => d !== iso);
    delete state.selectedSlots[iso];
  } else {
    if (state.selectedDates.length >= 2) {
      // Trigger warning animation
      const badge = document.getElementById("appt-max-badge");
      if (badge) {
        badge.classList.remove("warn");
        void badge.offsetWidth; // Force reflow
        badge.classList.add("warn");
        setTimeout(() => badge.classList.remove("warn"), 1500);
      }
      return;
    }
    el.classList.add("selected");
    state.selectedDates.push(iso);
    state.selectedSlots[iso] = [];
  }
  renderPerDateSlots();
  updateApptSummary();
}

function removeDatePill(iso) {
  const pill = document.querySelector(`.appt-date-pill[data-date="${iso}"]`);
  if (pill) pill.classList.remove("selected");
  state.selectedDates = state.selectedDates.filter(d => d !== iso);
  delete state.selectedSlots[iso];
  renderPerDateSlots();
  updateApptSummary();
}

function toggleDateSlotBand(iso, band, el) {
  if (!state.selectedSlots[iso]) state.selectedSlots[iso] = [];
  const index = state.selectedSlots[iso].indexOf(band);

  if (index === -1) {
    state.selectedSlots[iso].push(band);
    el.classList.add("selected");
  } else {
    state.selectedSlots[iso].splice(index, 1);
    el.classList.remove("selected");
  }
  updateApptSummary();
}

function renderPerDateSlots() {
  const container = document.getElementById("appt-per-date-slots");
  if (!container) return;
  container.innerHTML = "";

  if (state.selectedDates.length === 0) return;

  state.selectedDates.forEach(iso => {
    const d = new Date(iso + "T00:00:00");
    const dateLabel = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    const activeSlots = state.selectedSlots[iso] || [];

    const card = document.createElement("div");
    card.className = "appt-date-slot-card";
    card.innerHTML = `
      <div class="appt-card-header">
        <span>Preferred times for <strong>${dateLabel}</strong></span>
        <button type="button" class="appt-card-remove" onclick="removeDatePill('${iso}')">✕ Remove</button>
      </div>
      <div class="appt-band-grid">
        <div class="appt-band ${activeSlots.includes("AM") ? "selected" : ""}" onclick="toggleDateSlotBand('${iso}', 'AM', this)">
          <span class="appt-band-icon">🌅</span>
          <span class="appt-band-name">Morning</span>
          <span class="appt-band-range">8 am – 12 pm</span>
        </div>
        <div class="appt-band ${activeSlots.includes("PM") ? "selected" : ""}" onclick="toggleDateSlotBand('${iso}', 'PM', this)">
          <span class="appt-band-icon">☀️</span>
          <span class="appt-band-name">Afternoon</span>
          <span class="appt-band-range">12 pm – 5 pm</span>
        </div>
        <div class="appt-band ${activeSlots.includes("EVE") ? "selected" : ""}" onclick="toggleDateSlotBand('${iso}', 'EVE', this)">
          <span class="appt-band-icon">🌆</span>
          <span class="appt-band-name">Evening</span>
          <span class="appt-band-range">5 pm – 8 pm</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateApptSummary() {
  const summary = document.getElementById("appt-summary");
  if (!summary) return;
  summary.innerHTML = "";

  const combos = [];
  state.selectedDates.forEach(iso => {
    const d = new Date(iso + "T00:00:00");
    const dateLabel = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    const activeSlots = state.selectedSlots[iso] || [];

    if (activeSlots.length > 0) {
      activeSlots.forEach(band => {
        combos.push({
          label: `${dateLabel} · ${BAND_LABELS[band]}`,
          iso,
          band
        });
      });
    } else {
      combos.push({
        label: `${dateLabel} · Any time`,
        iso,
        band: "any"
      });
    }
  });

  combos.forEach(c => {
    const chip = document.createElement("div");
    chip.className = "appt-summary-chip";
    chip.innerHTML = `${c.label} <button type="button" aria-label="Remove">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      if (c.band !== "any") {
        state.selectedSlots[c.iso] = state.selectedSlots[c.iso].filter(b => b !== c.band);
        renderPerDateSlots();
      } else {
        removeDatePill(c.iso);
      }
      updateApptSummary();
    });
    summary.appendChild(chip);
  });

  const hiddenVal = combos.map(c => c.label).join(" | ");
  const hid = document.getElementById("preferred-slots");
  if (hid) hid.value = hiddenVal;
}

/* ============================================================
   STEP NAVIGATION
   ============================================================ */
function goToStep(n) {
  if (n > state.currentStep) {
    if (!validateStep(state.currentStep)) return;
  }

  if (n === 3) {
    // Rebuild troubleshoot if the selected issue changed
    const code = state.selectedIssue ? state.selectedIssue.code : null;
    if (state.tsBuiltForCode !== code) {
      buildTroubleshootSection();
      state.tsBuiltForCode = code;
    }
  }

  if (n === 5) {
    buildReviewGrid();
  }

  _showStep(n);
}

function _showStep(n) {
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById("step-" + i);
    if (el) el.style.display = "none";
  }
  const target = document.getElementById("step-" + n);
  if (target) target.style.display = "block";
  state.currentStep = n;
  updateStepIndicators(n);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBackFromReview() {
  goToStep(4);
}

function updateStepIndicators(n) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById("step-indicator-" + i);
    if (!el) continue;
    el.classList.remove("active", "done");
    if (i < n) el.classList.add("done");
    else if (i === n) el.classList.add("active");
  }
}

/* ============================================================
   VALIDATION
   ============================================================ */
function validateEmailInline(input) {
  const val = (input.value || "").trim();
  const errEl = document.getElementById("email-error");
  if (!val) {
    if (errEl) errEl.textContent = "";
    input.classList.remove("error");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
    if (errEl) errEl.textContent = "Please enter a valid email address.";
    input.classList.add("error");
  } else {
    if (errEl) errEl.textContent = "";
    input.classList.remove("error");
  }
}

function validatePhoneInline(input) {
  const raw = (input.value || "").replace(/\s/g, "");
  const digits = raw.replace(/\D/g, "");
  const errEl = document.getElementById("phone-error");
  const wrap = input.closest(".phone-input-wrap");

  const hiddenPhone = document.getElementById("phone");
  if (hiddenPhone) hiddenPhone.value = digits ? "+44" + digits : "";

  if (!digits) {
    if (errEl) errEl.textContent = "";
    if (wrap) wrap.classList.remove("error");
    return;
  }
  if (digits.length < 10) {
    if (errEl) errEl.textContent = "UK numbers need 10 digits after +44 (e.g. 7700 000000).";
    if (wrap) wrap.classList.add("error");
  } else if (digits.length > 10) {
    if (errEl) errEl.textContent = "Number too long — please enter 10 digits after +44.";
    if (wrap) wrap.classList.add("error");
  } else {
    if (errEl) errEl.textContent = "";
    if (wrap) wrap.classList.remove("error");
  }
}

function validateStep(step) {
  let ok = true;

  function setErr(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    ok = false;
  }
  function clearErr(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  }
  function markErr(id) { const el = document.getElementById(id); if (el) el.classList.add("error"); }
  function clearMark(id) { const el = document.getElementById(id); if (el) el.classList.remove("error"); }

  if (step === 1) {
    const name = (document.getElementById("name").value || "").trim();
    const email = (document.getElementById("email").value || "").trim();
    const address = (document.getElementById("address").value || "").trim();

    const digitsInput = document.getElementById("phone-digits");
    const digits = digitsInput ? digitsInput.value.replace(/\s/g, "").replace(/\D/g, "") : "";
    const hiddenPhone = document.getElementById("phone");
    if (hiddenPhone) hiddenPhone.value = digits ? "+44" + digits : "";

    if (!name) { setErr("name-error", "Please enter your full name."); markErr("name"); }
    else { clearErr("name-error"); clearMark("name"); }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErr("email-error", "Please enter a valid email address."); markErr("email");
    } else { clearErr("email-error"); clearMark("email"); }

    const phoneWrap = document.querySelector(".phone-input-wrap");
    if (!digits) {
      setErr("phone-error", "Please enter your phone number.");
      if (phoneWrap) phoneWrap.classList.add("error");
    } else if (digits.length !== 10) {
      setErr("phone-error", digits.length < 10
        ? "UK numbers need 10 digits after +44."
        : "Number too long — 10 digits expected after +44.");
      if (phoneWrap) phoneWrap.classList.add("error");
    } else {
      clearErr("phone-error");
      if (phoneWrap) phoneWrap.classList.remove("error");
    }

    if (!address) { setErr("address-error", "Please enter your property address."); markErr("address"); }
    else { clearErr("address-error"); clearMark("address"); }
  }

  if (step === 2) {
    if (!state.selectedCategory) {
      setErr("category-error", "Please select a category above.");
    } else {
      clearErr("category-error");
    }
  }

  if (step === 3) {
    if (!state.selectedIssue) {
      setErr("issue-error", "Please select an issue type.");
    } else {
      clearErr("issue-error");
    }

    const info = (document.getElementById("further-info").value || "").trim();
    if (!info) {
      setErr("further-info-error", "Please describe the issue.");
      markErr("further-info");
    } else {
      clearErr("further-info-error");
      clearMark("further-info");
    }

    if (!state.uploadedFiles || state.uploadedFiles.length === 0) {
      const uploadArea = document.getElementById("upload-area");
      if (uploadArea) uploadArea.style.borderColor = "var(--danger)";
      setErr("upload-error", "Please upload at least one photo or video of the issue.");
    } else {
      const uploadArea = document.getElementById("upload-area");
      if (uploadArea) uploadArea.style.borderColor = "";
      clearErr("upload-error");
    }

    if (state.selectedIssue && state.selectedIssue.code === "RC-999G") {
      const other = (document.getElementById("other-issue").value || "").trim();
      if (!other) {
        setErr("other-issue-error", "Please describe the other issue.");
        markErr("other-issue");
      } else {
        clearErr("other-issue-error");
        clearMark("other-issue");
      }
    }
  }

  if (step === 4) {
    if (!state.priority) {
      setErr("priority-error", "Please select priority level.");
    } else {
      clearErr("priority-error");
    }

    if (!state.keysAllowed) {
      setErr("keys-error", "Please specify keys permission.");
    } else {
      clearErr("keys-error");
    }

    if (!state.hasPets) {
      setErr("pets-error", "Please specify if pets are present.");
    } else {
      clearErr("pets-error");
    }
  }

  if (step === 5) {
    if (!document.getElementById("consent-check").checked) {
      setErr("consent-error", "Please confirm your consent before submitting.");
    } else {
      clearErr("consent-error");
    }
  }

  return ok;
}

/* ============================================================
   FILE UPLOAD HANDLERS
   ============================================================ */
function setupDragDrop() {
  const area = document.getElementById("upload-area");
  if (!area) return;
  ["dragover", "dragenter"].forEach(ev => area.addEventListener(ev, e => {
    e.preventDefault(); area.style.borderColor = "var(--accent)";
  }));
  ["dragleave", "dragend"].forEach(ev => area.addEventListener(ev, () => {
    area.style.borderColor = "";
  }));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.style.borderColor = "";
    handleFiles(e.dataTransfer.files);
  });
}

async function handleFiles(files) {
  for (const file of Array.from(files)) {
    const processed = await compressImageIfNeeded(file);
    state.uploadedFiles.push(processed);
    renderPreview(processed);
  }
  if (state.uploadedFiles.length > 0) {
    document.getElementById("upload-error").textContent = "";
    const uploadArea = document.getElementById("upload-area");
    if (uploadArea) uploadArea.style.borderColor = "";
  }
}

/* ============================================================
   IMAGE COMPRESSION (speeds up upload on submit)
   ============================================================ */
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_QUALITY = 0.8;
const IMAGE_COMPRESS_MIN_BYTES = 400 * 1024; // skip already-small images

function compressImageIfNeeded(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < IMAGE_COMPRESS_MIN_BYTES) {
    return Promise.resolve(file);
  }

  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
        const scale = IMAGE_MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) {
          resolve(file); // compression didn't help, keep original
          return;
        }
        const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        resolve(new File([blob], newName, { type: "image/jpeg", lastModified: file.lastModified }));
      }, "image/jpeg", IMAGE_QUALITY);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fall back to original on any decode error
    };

    img.src = objectUrl;
  });
}

function renderPreview(file) {
  const wrap = document.getElementById("upload-previews");
  const item = document.createElement("div");
  item.className = "preview-item";
  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    item.appendChild(img);
  } else if (file.type.startsWith("video/")) {
    const vid = document.createElement("video");
    vid.src = URL.createObjectURL(file);
    item.appendChild(vid);
  } else {
    const name = document.createElement("div");
    name.className = "preview-name";
    name.textContent = file.name;
    item.appendChild(name);
  }
  const btn = document.createElement("button");
  btn.className = "preview-remove"; btn.textContent = "✕"; btn.type = "button";
  btn.addEventListener("click", () => {
    state.uploadedFiles = state.uploadedFiles.filter(f => f !== file);
    item.remove();
  });
  item.appendChild(btn);
  wrap.appendChild(item);
}

/* ============================================================
   ALERT MODAL
   ============================================================ */
function showModal(icon, title, message) {
  document.getElementById("modal-icon").textContent = icon;
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-message").textContent = message;
  document.getElementById("alert-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("alert-modal").classList.add("hidden");
}

/* ============================================================
   VIDEO MODAL
   ============================================================ */
function openVideoModal(youtubeUrl) {
  let embedUrl = youtubeUrl;
  const watchMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
  if (watchMatch) {
    embedUrl = "https://www.youtube.com/embed/" + watchMatch[1] + "?autoplay=1";
  }
  document.getElementById("video-iframe").src = embedUrl;
  document.getElementById("video-modal").classList.remove("hidden");
}

function closeVideoModal() {
  document.getElementById("video-modal").classList.add("hidden");
  const iframe = document.getElementById("video-iframe");
  if (iframe) iframe.src = "";
}

/* ============================================================
   TROUBLESHOOTING BUILDER
   ============================================================ */
function buildTroubleshootSection() {
  const container = document.getElementById("troubleshoot-container");
  container.innerHTML = "";
  state.ts = {};
  state.tsQA = [];

  const issue = state.selectedIssue;
  if (!issue) return;

  if (PEST_CODES.includes(issue.code)) {
    buildPestFlow(container);
  } else if (HEATING_CODES.includes(issue.code)) {
    buildHeatingFlow(container);
  } else if (ELECTRICAL_CODES.includes(issue.code)) {
    buildElectricalFlow(container);
  }
}

const RESOLVED_MSG = "🎉 Great news! It looks like this issue has been resolved. Please still complete and submit this form so we have a record — if the problem returns we can act quickly.";
const ENGINEER_MSG = "🛠️ Based on your answers, an engineer visit may be needed. Please complete and submit your report below and our team will review and arrange a visit.";

function makeQuestion(id, text, options, helpLink) {
  const wrap = document.createElement("div");
  wrap.className = "ts-question";
  wrap.id = "ts-q-" + id;

  const q = document.createElement("div");
  q.className = "ts-question-text";
  q.textContent = text;
  wrap.appendChild(q);

  if (helpLink) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ts-help-link";
    btn.textContent = "▶ " + helpLink.label;
    btn.addEventListener("click", () => openVideoModal(helpLink.url));
    wrap.appendChild(btn);
  }

  const optWrap = document.createElement("div");
  optWrap.className = "ts-options";

  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ts-option-btn";
    btn.textContent = opt.label;
    btn.dataset.value = opt.value;

    btn.addEventListener("click", () => {
      optWrap.querySelectorAll(".ts-option-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");

      state.ts[id] = opt.value;

      state.internal.troubleshooting_path = state.internal.troubleshooting_path.filter(p => !p.startsWith(id + ":"));
      state.internal.troubleshooting_path.push(id + ":" + opt.value);

      state.tsQA = state.tsQA.filter(entry => entry.qid !== id);
      state.tsQA.push({ qid: id, q: text, a: opt.label });

      wrap.querySelectorAll(".ts-high-priority, .ts-outcome-resolved, .ts-outcome-engineer").forEach(el => el.remove());
      removeAfter(wrap);

      state.internal.engineer_required = false;
      state.internal.request_closed = false;
      state.internal.alert_type = "";

      if (opt.responsibility) {
        state.internal.responsibility_type = opt.responsibility;
        setHiddenVal("responsibility_type", opt.responsibility);
      }
      if (opt.engineerInternal || opt.engineer) {
        state.internal.engineer_required = true;
        setHiddenVal("engineer_required", "true");
      }
      if (opt.closedInternal || opt.resolved) {
        state.internal.request_closed = true;
        setHiddenVal("request_closed", "true");
      }
      if (opt.highAlert) {
        state.internal.priority = "HIGH";
        state.internal.engineer_required = true;
        setHiddenVal("engineer_required", "true");
        appendNotice(wrap, opt.highAlert, "ts-high-priority");
      }

      if (!opt.highAlert) {
        if (opt.resolved) {
          appendNotice(wrap, RESOLVED_MSG, "ts-outcome-resolved");
        } else if (opt.engineer) {
          appendNotice(wrap, ENGINEER_MSG, "ts-outcome-engineer");
        }
      }

      if (opt.modal && opt.modal.icon) {
        showModal(opt.modal.icon, opt.modal.title, opt.modal.message);
      }
      if (opt.modal) {
        state.internal.responsibility_type = state.internal.responsibility_type || "possible_tenant";
        setHiddenVal("responsibility_type", state.internal.responsibility_type);
      }

      if (opt.next) opt.next();
    });

    optWrap.appendChild(btn);
  });

  wrap.appendChild(optWrap);
  return wrap;
}

function appendNotice(parent, text, cls) {
  const n = document.createElement("div");
  n.className = cls;
  n.textContent = text;
  parent.appendChild(n);
}

function removeAfter(el) {
  while (el.nextSibling) el.parentNode.removeChild(el.nextSibling);
}

function setHiddenVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

/* ============================================================
   DETAILED TROUBLESHOOTING PATHS (PESTS, HEATING, ELECTRICAL)
   ============================================================ */
function buildPestFlow(container) {
  const code = state.selectedIssue.code;
  if (code === "RC-160A") {
    buildRatsMiceFlow(container);
  } else if (code === "RC-162A" || code === "RC-163A") {
    buildRoachesBedbugsFlow(container);
  } else if (code === "RC-164A") {
    buildWaspsFlow(container);
  } else {
    buildOtherPestFlow(container);
  }
}

function buildRatsMiceFlow(container) {
  const q1 = makeQuestion("pest_holes", "Can you see any holes, gaps, or entry points in walls, floors, or around pipes?", [
    { label: "Yes", value: "yes", responsibility: "landlord" },
    {
      label: "No", value: "no", next: () => {
        const q2 = makeQuestion("pest_food", "Is there food left out, rubbish indoors, or pet food left overnight?", [
          { label: "Yes", value: "yes", modal: { icon: "⚠️", title: "Possible Tenant Responsibility", message: "Based on your answers, this issue may be your responsibility. You could be charged for the cost of treatment. The pest controller will confirm this on their visit. Please continue to submit your report." }, responsibility: "possible_tenant" },
          {
            label: "No", value: "no", next: () => {
              const q3 = makeQuestion("pest_preexisting", "Did you notice rodents when you first moved in?", [
                { label: "Yes", value: "yes", responsibility: "landlord" },
                { label: "No", value: "no", responsibility: "review_landlord_possible" },
              ]);
              container.appendChild(q3);
            }
          }
        ]);
        container.appendChild(q2);
      }
    }
  ]);
  container.appendChild(q1);
}

function buildRoachesBedbugsFlow(container) {
  const q1 = makeQuestion("pest_furniture", "Have you recently brought in second-hand furniture, luggage, or belongings?", [
    { label: "Yes", value: "yes", modal: { icon: "⚠️", title: "Possible Tenant Responsibility", message: "Based on your answers, this issue may be your responsibility. Bringing in second-hand items is a common cause of infestations. You could be charged for the cost of treatment. The pest controller will confirm this on their visit. Please continue to submit your report." }, responsibility: "possible_tenant" },
    {
      label: "No", value: "no", next: () => {
        const q2 = makeQuestion("pest_kitchen_clean", "Is the kitchen kept clean, with bins emptied regularly and crumbs cleared?", [
          {
            label: "Yes", value: "yes", next: () => {
              const q3 = makeQuestion("pest_preexisting_roach", "Did you notice pests when you first moved in?", [
                { label: "Yes", value: "yes", responsibility: "landlord" },
                { label: "No", value: "no", responsibility: "review_landlord_possible" },
              ]);
              container.appendChild(q3);
            }
          },
          { label: "No", value: "no", modal: { icon: "⚠️", title: "Possible Tenant Responsibility", message: "Based on your answers, this issue may be your responsibility. Poor hygiene conditions are a common cause of infestations. You could be charged for the cost of treatment. The pest controller will confirm this on their visit. Please continue to submit your report." }, responsibility: "possible_tenant" },
        ]);
        container.appendChild(q2);
      }
    }
  ]);
  container.appendChild(q1);
}

function buildWaspsFlow(container) {
  const q1 = makeQuestion("pest_wasps_location", "Is the nest located in the garden, loft, roof, eaves, or external walls?", [
    { label: "Yes", value: "yes", responsibility: "landlord" },
    { label: "No", value: "no", modal: { icon: "⚠️", title: "Possible Tenant Responsibility", message: "Based on your answers, if the nest is inside the property and not in an external structural area, this may be your responsibility. You could be charged for the cost of treatment. The pest controller will confirm this on their visit. Please continue to submit your report." }, responsibility: "possible_tenant" },
  ]);
  container.appendChild(q1);
}

function buildOtherPestFlow(container) {
  const q1 = makeQuestion("pest_other_location", "Where have you noticed them?", [
    { label: "Outside property", value: "outside", responsibility: "review_landlord_possible" },
    {
      label: "Inside property", value: "inside", next: () => {
        const q2 = makeQuestion("pest_other_preexisting", "Did you notice this problem when you first moved in?", [
          { label: "Yes", value: "yes", responsibility: "landlord" },
          { label: "No", value: "no", modal: { icon: "⚠️", title: "Possible Tenant Responsibility", message: "Based on your answers, this issue may be your responsibility as it does not appear to be a pre-existing or structural problem. You could be charged for the cost of treatment. The pest controller will confirm this on their visit. Please continue to submit your report." }, responsibility: "possible_tenant" },
        ]);
        container.appendChild(q2);
      }
    }
  ]);
  container.appendChild(q1);
}

function buildHeatingFlow(container) {
  const q1 = makeQuestion("ht_gas", "Is your hot water and heating supplied by a gas boiler?", [
    { label: "Yes", value: "yes", next: () => buildGasBoilerFlow(container) },
    { label: "No", value: "no", next: () => buildNonGasFlow(container) },
  ]);
  container.appendChild(q1);
}

function buildGasBoilerFlow(container) {
  const q2 = makeQuestion("ht_meter", "Is your gas meter billed or a top-up / smart meter?", [
    { label: "Billed", value: "billed", next: () => buildHeatingQ3(container) },
    {
      label: "Top-up / Smart Meter", value: "topup", next: () => {
        const q2a = makeQuestion("ht_credit", "Have you checked there is enough credit on the meter?", [
          { label: "Yes, there is credit", value: "yes_credit", next: () => buildHeatingQ3(container) },
          { label: "No — the credit had finished, but I’ve topped it up and heating & hot water are now working", value: "topped_resolved", resolved: true }
        ]);
        container.appendChild(q2a);
      }
    }
  ]);
  container.appendChild(q2);
}

function buildHeatingQ3(container) {
  const q3 = makeQuestion("ht_heating_now", "Do you currently have heating?", [
    { label: "Yes", value: "yes", next: () => buildHeatingQ4(container, "yes") },
    { label: "No", value: "no", next: () => buildHeatingQ4(container, "no") },
  ]);
  container.appendChild(q3);
}

function buildHeatingQ4(container, heatingStatus) {
  const q4 = makeQuestion("ht_hotwater_now", "Do you currently have hot water?", [
    {
      label: "Yes", value: "yes", next: () => {
        if (heatingStatus === "no") buildHeatingBothNoHotYes(container);
        else buildHeatingBothYes(container);
      }
    },
    {
      label: "No", value: "no", next: () => {
        if (heatingStatus === "no") buildHeatingBothNo(container);
        else buildHeatingHeatYesHWNo(container);
      }
    },
  ]);
  container.appendChild(q4);
}

function buildHeatingBothNo(container) {
  const q5 = makeQuestion(
    "ht_pressure",
    "Have you checked that the boiler is pressurised?",
    [
      { label: "Yes, it’s correctly pressurised", value: "pressurised", engineer: true },
      {
        label: "No, I’ve now re-pressurised it", value: "repressurised", next: () => {
          const qFix = makeQuestion("ht_pressure_fixed", "Did re-pressurising fix the issue?", [
            { label: "Yes", value: "yes", resolved: true },
            { label: "No", value: "no", engineer: true },
          ]);
          container.appendChild(qFix);
        }
      },
    ],
    { label: "How to Re-Pressurise Your Boiler", url: "https://youtu.be/I3HgvV2mIqY?si=Wuk_UPaR_3rSx3v1" }
  );
  container.appendChild(q5);
}

function buildHeatingBothNoHotYes(container) {
  const q6 = makeQuestion("ht_radiators_working", "Are your radiators working?", [
    { label: "Yes, radiators working", value: "yes", engineer: true },
    {
      label: "No, radiators not working", value: "no", next: () => {
        const q6b = makeQuestion(
          "ht_bleed",
          "Have you tried bleeding the affected radiators?",
          [
            { label: "Yes, I tried and it worked", value: "worked", resolved: true },
            { label: "Yes, I tried but it didn’t work", value: "tried_failed", engineer: true },
            { label: "No, I haven’t tried yet", value: "no", engineer: true },
          ],
          { label: "How to Bleed a Radiator", url: "https://youtu.be/0IP54Kbgnv0?si=H5UeWyFTQLNp0PbD" }
        );
        container.appendChild(q6b);
      }
    }
  ]);
  container.appendChild(q6);
}

function buildHeatingHeatYesHWNo(container) {
  const wrap = document.createElement("div");
  wrap.className = "ts-question";
  const txt = document.createElement("div");
  txt.className = "ts-question-text";
  txt.textContent = "Heating is working but there is no hot water.";
  wrap.appendChild(txt);
  appendNotice(wrap, ENGINEER_MSG, "ts-outcome-engineer");
  state.internal.engineer_required = true;
  setHiddenVal("engineer_required", "true");

  const input = document.createElement("input");
  input.type = "text"; input.className = "ts-text-input";
  input.placeholder = "Enter any boiler error codes here (optional)";
  input.id = "boiler_error_code";
  input.addEventListener("input", () => { state.ts["boiler_error_code"] = input.value; });
  wrap.appendChild(input);
  container.appendChild(wrap);
}

function buildHeatingBothYes(container) {
  const wrap = document.createElement("div");
  wrap.className = "ts-question";
  appendNotice(wrap, RESOLVED_MSG, "ts-outcome-resolved");
  container.appendChild(wrap);
}

function buildNonGasFlow(container) {
  const q7 = makeQuestion("ht_electric_boiler", "Is your heating/hot water supplied by an electric boiler or other system?", [
    {
      label: "Yes (Electric Boiler)", value: "electric", next: () => {
        const q8 = makeQuestion("ht_electric_prepaid", "Is your electric meter pre-paid?", [
          {
            label: "Yes (Pre-Paid)", value: "prepaid", next: () => {
              const qCredit = makeQuestion("ht_electric_credit", "Is there credit on your electric meter?", [
                { label: "Yes", value: "yes", engineer: true },
                { label: "No", value: "no", resolved: true },
              ]);
              container.appendChild(qCredit);
            }
          },
          { label: "No (Billed)", value: "billed", engineer: true },
        ]);
        container.appendChild(q8);
      }
    },
    { label: "No", value: "no", engineer: true },
  ]);
  container.appendChild(q7);
}

function buildElectricalFlow(container) {
  const q1 = makeQuestion("el_whole_loss", "Do you have a loss of power in the whole property?", [
    { label: "Yes", value: "yes", next: () => buildElecQ2(container) },
    { label: "No", value: "no", next: () => buildElecQ4(container) },
  ]);
  container.appendChild(q1);
}

function buildElecQ2(container) {
  const q2 = makeQuestion("el_neighbour", "Have you checked if your neighbours also have no power?", [
    { label: "Yes, they also have no power", value: "yes", resolved: true },
    { label: "No, only my property", value: "no", next: () => buildElecQ3(container) },
  ]);
  container.appendChild(q2);
}

function buildElecQ3(container) {
  const q3 = makeQuestion("el_meter_type", "Is your electricity supplied through a billed account or a top-up meter?", [
    { label: "Billed", value: "billed", next: () => buildElecQ4(container) },
    {
      label: "Top-up", value: "topup", next: () => {
        const q3a = makeQuestion("el_credit", "Have you checked that there is credit on your meter?", [
          { label: "Yes", value: "yes", next: () => buildElecQ4(container) },
          {
            label: "No", value: "no", next: () => {
              const qTopUp = makeQuestion("el_topped", "Did topping up restore power?", [
                { label: "Yes", value: "yes", resolved: true },
                { label: "No", value: "no", next: () => buildElecQ4(container) },
              ]);
              container.appendChild(qTopUp);
            }
          },
        ]);
        container.appendChild(q3a);
      }
    },
  ]);
  container.appendChild(q3);
}

function buildElecQ4(container) {
  const q4 = makeQuestion("el_scope", "Is the power outage affecting all rooms or only specific rooms / outlets?", [
    { label: "All rooms", value: "all", next: () => buildElecQ5(container) },
    { label: "Specific rooms/outlets", value: "specific", next: () => buildElecQ6(container) },
  ]);
  container.appendChild(q4);
}

function buildElecQ5(container) {
  const q5 = makeQuestion("el_breaker", "Have you checked your main breaker / fuse box?", [
    {
      label: "Yes, the breaker is tripped / off", value: "tripped", next: () => {
        const qReset = makeQuestion("el_breaker_fixed", "Did resetting the breaker solve the issue?", [
          { label: "Yes", value: "yes", resolved: true },
          { label: "No", value: "no", next: () => buildElecQ7(container) },
        ]);
        container.appendChild(qReset);
      }
    },
    { label: "Yes, all breakers appear normal", value: "normal", next: () => buildElecQ7(container) },
    { label: "No, I haven’t checked", value: "unchecked", next: () => buildElecQ7(container) },
  ]);
  container.appendChild(q5);
}

function buildElecQ6(container) {
  const q6 = makeQuestion("el_appliance", "Are the affected outlets linked to a specific appliance (e.g. kettle, heater, microwave)?", [
    {
      label: "Yes", value: "yes", next: () => {
        const qFixed = makeQuestion("el_appliance_fixed", "Did unplugging the appliance and testing the outlet solve the issue?", [
          { label: "Yes", value: "yes", resolved: true },
          { label: "No", value: "no", next: () => buildElecQ7(container) },
        ]);
        container.appendChild(qFixed);
      }
    },
    { label: "No", value: "no", next: () => buildElecQ7(container) },
  ]);
  container.appendChild(q6);
}

function buildElecQ7(container) {
  const wrap = document.createElement("div");
  wrap.className = "ts-question";
  wrap.id = "ts-q-el_safety";

  const q = document.createElement("div");
  q.className = "ts-question-text";
  q.textContent = "Do you notice any of the following? Select all that apply:";
  wrap.appendChild(q);

  const safetyOptions = [
    { id: "el_burning", label: "Burning smell" },
    { id: "el_sparks", label: "Sparks or smoke" },
    { id: "el_wiring", label: "Exposed wiring" },
    { id: "el_water", label: "Water near electrical fittings" },
    { id: "el_none", label: "None of the above" },
  ];

  const checkWrap = document.createElement("div");
  checkWrap.className = "ts-options";

  safetyOptions.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ts-option-btn";
    btn.textContent = opt.label; btn.dataset.id = opt.id;
    btn.addEventListener("click", () => {
      if (opt.id === "el_none") {
        checkWrap.querySelectorAll(".ts-option-btn").forEach(b => b.classList.remove("selected"));
      } else {
        const noneBtn = checkWrap.querySelector("[data-id='el_none']");
        if (noneBtn) noneBtn.classList.remove("selected");
      }
      btn.classList.toggle("selected");
      evalElecSafety(wrap, checkWrap);
    });
    checkWrap.appendChild(btn);
  });

  wrap.appendChild(checkWrap);
  container.appendChild(wrap);
}

function evalElecSafety(parent, checkWrap) {
  parent.querySelectorAll(".ts-high-priority, .ts-outcome-engineer, .ts-outcome-resolved").forEach(el => el.remove());
  const selected = Array.from(checkWrap.querySelectorAll(".ts-option-btn.selected")).map(b => b.dataset.id);
  const danger = ["el_burning", "el_sparks", "el_wiring", "el_water"];
  const hasDanger = selected.some(id => danger.includes(id));

  state.ts["el_safety"] = selected.join(", ");
  state.tsQA = state.tsQA.filter(e => e.qid !== "el_safety");
  state.tsQA.push({ qid: "el_safety", q: "Electrical safety concerns", a: selected.join(", ") || "None selected" });

  if (hasDanger) {
    appendNotice(parent, "This has been flagged as a potential safety concern. Please keep away from the affected area. Our team will treat this as a priority.", "ts-high-priority");
    state.internal.priority = "HIGH"; state.internal.engineer_required = true;
    setHiddenVal("priority", "HIGH"); setHiddenVal("engineer_required", "true"); setHiddenVal("alert_type", "electrical_safety");
  } else if (selected.includes("el_none") || selected.length > 0) {
    appendNotice(parent, ENGINEER_MSG, "ts-outcome-engineer");
    state.internal.engineer_required = true;
    setHiddenVal("engineer_required", "true");
  }
}

/* ============================================================
   REVIEW GRID
   ============================================================ */
function buildReviewGrid() {
  const grid = document.getElementById("review-grid");
  grid.innerHTML = "";

  function add(label, value, full) {
    const div = document.createElement("div");
    div.className = full ? "review-item full" : "review-item";
    div.innerHTML = '<div class="review-item-label">' + label + '</div><div class="review-item-value">' + (value || "—") + '</div>';
    grid.appendChild(div);
  }

  const flatVal = document.getElementById("flat-room").value.trim();
  const addressFull = document.getElementById("address").value.trim() + (flatVal ? `, Flat/Room: ${flatVal}` : "");

  add("Full Name", document.getElementById("name").value);
  add("Email", document.getElementById("email").value);
  add("Phone", document.getElementById("phone").value);
  add("Property Address", addressFull, true);

  add("Category", state.selectedCategory ? state.selectedCategory.label : "—");
  add("Issue Type", state.selectedIssue ? state.selectedIssue.label : "—");

  add("Priority Level", state.priority.toUpperCase());
  add("Allow Key Access?", state.keysAllowed === "yes" ? "Yes" : "No, must be present");
  add("Pets at Property?", state.hasPets === "yes" ? `Yes (${document.getElementById("pets-details").value.trim() || "No details"})` : "No");

  add("Access Instructions", document.getElementById("access-instructions").value.trim(), true);
  const apptReviewSlots = [];
  if (state.selectedDates.length) {
    state.selectedDates.forEach(iso => {
      const d = new Date(iso + "T00:00:00");
      const dateStr = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
      const activeSlots = state.selectedSlots[iso] || [];
      if (activeSlots.length) {
        activeSlots.forEach(band => apptReviewSlots.push(`${dateStr} · ${BAND_LABELS[band]}`));
      } else {
        apptReviewSlots.push(`${dateStr} · Any time`);
      }
    });
  }
  add("Preferred Appointment Slots", apptReviewSlots.length ? apptReviewSlots.join(", ") : "No preference selected", true);

  add("Issue Description", document.getElementById("further-info").value, true);

  if (state.selectedIssue && state.selectedIssue.code === "RC-999G") {
    add("Other Issue Detail", document.getElementById("other-issue").value, true);
  }

  add("Files Attached", state.uploadedFiles.length ? state.uploadedFiles.length + " file(s)" : "None");

  // Troubleshooting Q&A section
  if (state.tsQA && state.tsQA.length > 0) {
    const tsDiv = document.createElement("div");
    tsDiv.className = "review-item full";
    let html = '<div class="review-item-label">Troubleshooting Answers</div>';
    html += '<div class="ts-review-block">';
    state.tsQA.forEach((entry, i) => {
      if (i > 0) html += '<hr class="ts-review-separator">';
      html += '<div class="ts-review-q">' + escHtml(entry.q) + '</div>';
      html += '<div class="ts-review-a">→ ' + escHtml(entry.a) + '</div>';
    });
    html += '</div>';
    tsDiv.innerHTML = html;
    grid.appendChild(tsDiv);
  }

  // Update hidden fields
  setHiddenVal("submitted_at", new Date().toISOString());
  setHiddenVal("engineer_required", state.internal.engineer_required ? "true" : "false");
  setHiddenVal("request_closed", state.internal.request_closed ? "true" : "false");
}

function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ============================================================
   SUBMISSION
   ============================================================ */
function buildDbRecord(payload) {
  const fileUrls = Array.isArray(payload.file_urls) ? payload.file_urls : [];
  const fullAddress = String(
    payload.full_address ||
    (payload.flat_room_number ? `${payload.flat_room_number}, ${payload.address || ""}` : (payload.address || ""))
  ).trim();

  return {
    company_name: String(payload.company_name || "Homeview Property Management"),
    source: String(payload.source || "Homeview Maintenance Portal"),
    name: String(payload.name || ""),
    email: String(payload.email || ""),
    phone: String(payload.phone || ""),
    address: String(payload.address || ""),
    flat_room_number: String(payload.flat_room_number || ""),
    full_address: fullAddress,
    city: "",
    postcode: "",
    category_id: String(payload.category_id || ""),
    category_label: String(payload.category_label || ""),
    issue_code: String(payload.issue_code || ""),
    issue_label: String(payload.issue_label || ""),
    other_issue_text: String(payload.other_issue_text || ""),
    further_info: String(payload.further_info || ""),
    priority: String(payload.priority || "routine"),
    internal_priority: String(payload.internal_priority || "normal"),
    keys_allowed: String(payload.keys_allowed || ""),
    has_pets: String(payload.has_pets || ""),
    pets_details: String(payload.pets_details || ""),
    preferred_appointment_slots: String(payload.preferred_appointment_slots || ""),
    access_instructions: String(payload.access_instructions || ""),
    troubleshooting_summary: String(payload.troubleshooting_summary || ""),
    troubleshooting_answers: payload.troubleshooting_answers || {},
    troubleshooting_path: Array.isArray(payload.troubleshooting_path) ? payload.troubleshooting_path : [],
    boiler_error_code: String(payload.boiler_error_code || ""),
    engineer_required: Boolean(payload.engineer_required || false),
    request_closed: Boolean(payload.request_closed || false),
    responsibility_type: String(payload.responsibility_type || ""),
    alert_type: String(payload.alert_type || ""),
    final_action: String(payload.final_action || ""),
    file_urls: fileUrls,
    file_count: fileUrls.length,
    submitted_at: String(payload.submitted_at || new Date().toISOString()),
    make_webhook_sent: false
  };
}

/* Save submission record directly to Supabase PostgreSQL */
async function insertToSupabase(payload) {
  // 1. Try via Supabase JS client with anon key
  try {
    const client = getSupabaseClient();
    if (client) {
      const dbRecord = buildDbRecord(payload);
      const { data, error } = await client.from(SUPABASE_TABLE).insert([dbRecord]).select();
      if (!error && data && data.length) {
        console.log("[Homeview] Supabase row created successfully:", data[0].id);
        return data[0].id;
      }
      if (error) {
        console.warn("[Homeview] Supabase client insert note:", error.message);
      }
    }
  } catch (clientErr) {
    console.warn("[Homeview] Supabase client exception:", clientErr);
  }

  // 2. Direct REST insert with anon key
  try {
    const dbRecord = buildDbRecord(payload);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(dbRecord)
    });

    if (res.ok) {
      const data = await res.json();
      const newId = (Array.isArray(data) && data[0] && data[0].id) ? data[0].id : true;
      console.log("[Homeview] Supabase REST row created:", newId);
      return newId;
    }
  } catch (err) {
    console.warn("[Homeview] Supabase REST insert exception:", err);
  }

  return false;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!validateStep(5)) return;

  const submitBtn = document.getElementById("submit-btn");
  const submitText = document.getElementById("submit-text");
  const submitSpinner = document.getElementById("submit-spinner");
  const progressWrap = document.getElementById("upload-progress-wrap");
  const progressBar = document.getElementById("upload-progress-bar");
  const progressText = document.getElementById("upload-progress-text");

  submitBtn.disabled = true;
  submitText.classList.add("hidden");
  submitSpinner.classList.remove("hidden");
  if (progressWrap) progressWrap.classList.remove("hidden");
  if (progressBar) progressBar.style.width = "0%";
  if (progressText) progressText.textContent = "Preparing submission… 0%";

  function updateProgress(pct, label) {
    if (progressBar) progressBar.style.width = pct + "%";
    if (progressText) {
      progressText.textContent = label || (pct >= 100 ? "Processing…" : `Uploading… ${pct}%`);
    }
  }

  // 1. Upload files to Supabase Storage -> public URLs
  let fileUrls = [];
  if (state.uploadedFiles && state.uploadedFiles.length > 0) {
    try {
      fileUrls = await uploadFilesToSupabase(state.uploadedFiles, updateProgress);
    } catch (uploadErr) {
      console.warn("[Homeview] Supabase storage upload warning:", uploadErr);
    }
  }

  updateProgress(85, "Saving to database…");

  const boilerErr = document.getElementById("boiler_error_code");
  const tsSummary = state.tsQA.map((e, i) => (i + 1) + ". " + e.q + "\n   Answer: " + e.a).join("\n\n");
  const submittedAt = new Date().toISOString();
  const finalAction = state.internal.engineer_required ? "engineer_required"
    : state.internal.request_closed ? "self_resolved"
      : state.internal.responsibility_type ? "responsibility_review"
        : "standard_review";

  // Build preferred appointment slots summary
  const apptSlots = [];
  if (state.selectedDates.length) {
    state.selectedDates.forEach(iso => {
      const d = new Date(iso + "T00:00:00");
      const dateStr = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
      const activeSlots = state.selectedSlots[iso] || [];
      if (activeSlots.length) {
        activeSlots.forEach(band => {
          apptSlots.push({ date: dateStr, date_iso: iso, time_band: band, time_label: BAND_LABELS[band] });
        });
      } else {
        apptSlots.push({ date: dateStr, date_iso: iso, time_band: "any", time_label: "Any time" });
      }
    });
  }

  const payload = {
    company_name: "Homeview Property Management",
    company: "Homeview Property Management",
    brand: "Homeview Property Management",
    source: "Homeview Maintenance Portal",
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    address: document.getElementById("address").value.trim(),
    flat_room_number: document.getElementById("flat-room").value.trim(),
    full_address: [document.getElementById("flat-room").value.trim(), document.getElementById("address").value.trim()].filter(Boolean).join(", "),
    category_id: state.selectedCategory ? state.selectedCategory.id : "",
    category_label: state.selectedCategory ? state.selectedCategory.label : "",
    issue_label: state.selectedIssue ? state.selectedIssue.label : "",
    issue_code: state.selectedIssue ? state.selectedIssue.code : "",
    other_issue_text: document.getElementById("other-issue").value.trim(),
    further_info: document.getElementById("further-info").value.trim(),
    priority: state.priority,
    keys_allowed: state.keysAllowed,
    has_pets: state.hasPets,
    pets_details: document.getElementById("pets-details").value.trim(),
    preferred_appointment_slots: apptSlots.map(s => `${s.date} · ${s.time_label}`).join(" | "),
    access_instructions: document.getElementById("access-instructions").value.trim(),
    internal_priority: state.internal.priority === "HIGH" ? "HIGH" : state.priority.toUpperCase(),
    engineer_required: state.internal.engineer_required,
    request_closed: state.internal.request_closed,
    responsibility_type: state.internal.responsibility_type,
    alert_type: state.internal.alert_type,
    troubleshooting_path: state.internal.troubleshooting_path,
    troubleshooting_answers: state.ts,
    troubleshooting_summary: tsSummary,
    boiler_error_code: boilerErr ? boilerErr.value : "",
    file_urls: fileUrls,
    uploaded_files_count: fileUrls.length,
    uploaded_file_names: state.uploadedFiles.map(f => f.name),
    submitted_at: submittedAt,
    final_action: finalAction
  };

  // 1. Save backup to localStorage
  try {
    localStorage.setItem("homeview_pending_submission", JSON.stringify({
      payload,
      savedAt: new Date().toISOString(),
      fileNames: state.uploadedFiles.map(f => f.name)
    }));
  } catch (_) {}

  // 2. Submit to Supabase directly
  const dbId = await insertToSupabase(payload);
  if (dbId && typeof dbId === "string") {
    payload.supabase_id = dbId;
  }

  // 3. Send all data + file_urls as pure JSON into webhook
  const sent = await sendWithRetry(payload, updateProgress);
  updateProgress(100, "Done!");
  await new Promise(r => setTimeout(r, 250));

  submitBtn.disabled = false;
  submitText.classList.remove("hidden");
  submitSpinner.classList.add("hidden");
  if (progressWrap) progressWrap.classList.add("hidden");

  if (sent || dbId) {
    try { localStorage.removeItem("homeview_pending_submission"); } catch (_) {}
    showConfirmation(payload);
  } else {
    showSubmissionError(payload);
  }
}

// Same-origin relay (see api/submit-report.js). Saves to Supabase and forwards
// to Make.com server-side. Falls back to direct browser delivery if relay is unavailable.
const RELAY_URL = "/api/submit-report";

async function sendViaRelay(payload) {
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function sendDirect(payload) {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.warn("[Homeview] sendDirect fetch error:", err);
    return false;
  }
}

async function sendWithRetry(payload, onProgress) {
  const MAX = 3;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    if (onProgress) {
      onProgress(90 + (attempt * 3), `Forwarding to webhook (attempt ${attempt})…`);
    }
    if (await sendViaRelay(payload)) return true;
    if (await sendDirect(payload)) return true;
    if (attempt < MAX) {
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
  return false;
}

/* ============================================================
   ESTIMATED UPLOAD PROGRESS
   Real byte-level progress isn't available (see sendWithRetry), so we
   animate toward 90% based on payload size and a conservative assumed
   upload speed, then snap to 100% once the request actually resolves.
   ============================================================ */
const ASSUMED_UPLOAD_BYTES_PER_SEC = 250 * 1024; // conservative mobile upload speed

function startEstimatedProgress(totalBytes, onProgress) {
  const estimatedMs = Math.max(1200, (totalBytes / ASSUMED_UPLOAD_BYTES_PER_SEC) * 1000);
  const start = performance.now();
  onProgress(0);
  const timer = setInterval(() => {
    const elapsed = performance.now() - start;
    const pct = Math.min(90, Math.round(90 * (1 - Math.exp(-elapsed / estimatedMs))));
    onProgress(pct);
  }, 150);
  return () => clearInterval(timer);
}

function showSubmissionError(payload) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById("step-" + i);
    if (el) el.style.display = "none";
  }
  const step6 = document.getElementById("step-6");
  if (step6) step6.style.display = "block";

  const iconEl = document.getElementById("confirm-icon");
  const titleEl = document.getElementById("confirm-title");
  const msgEl = document.getElementById("confirm-message");
  const noteEl = document.getElementById("confirm-note");

  if (iconEl) iconEl.textContent = "⚠️";
  if (titleEl) titleEl.textContent = "Submission Failed";
  if (msgEl) msgEl.textContent =
    "We couldn't reach our server right now. Your details have been saved on this device. " +
    "Please try again, or email us directly using the link below — your data is NOT lost.";

  if (noteEl) {
    noteEl.className = "confirm-note confirm-note--warn";
    const subject = encodeURIComponent("Maintenance Report – " + payload.name);
    const body = encodeURIComponent(
      "Name: " + payload.name + "\n" +
      "Email: " + payload.email + "\n" +
      "Phone: " + payload.phone + "\n" +
      "Address: " + payload.address + "\n" +
      "Category: " + payload.category_label + "\n" +
      "Issue: " + payload.issue_label + "\n" +
      "Details: " + payload.further_info + "\n" +
      "Submitted: " + payload.submitted_at
    );
    noteEl.innerHTML =
      "<strong>Your report details are saved in this browser.</strong><br><br>" +
      "📧 <a href=\"mailto:ali@getmanagedtoday.com?subject=" + subject + "&body=" + body + "\" " +
      "style=\"color:var(--warning);font-weight:700;\">Send report by email instead</a><br><br>" +
      "<button onclick=\"retrySubmission()\" " +
      "style=\"background:none;border:1.5px solid var(--warning);color:var(--warning);padding:0.35rem 1rem;" +
      "border-radius:6px;cursor:pointer;font-size:0.85rem;font-weight:600;\">🔄 Try Again</button>";
  }
}

function retrySubmission() {
  const step6 = document.getElementById("step-6");
  if (step6) step6.style.display = "none";
  _showStep(5);
  buildReviewGrid();
}

function showConfirmation(payload) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById("step-" + i);
    if (el) el.style.display = "none";
  }
  const step6 = document.getElementById("step-6");
  if (step6) step6.style.display = "block";

  const firstName = (payload.name || "").split(" ")[0] || "there";

  let icon, title, msg;
  const isEmergency = payload.priority === "emergency" || payload.internal_priority === "HIGH";

  if (isEmergency) {
    icon = "🚨";
    title = "Emergency Report Submitted, " + firstName + "!";
    msg = "Thank you. Your report has been submitted as an emergency. Our emergency maintenance response team has been alerted immediately and is reviewing your details to dispatch an engineer. Please keep your phone close by for immediate call-backs.";
  } else if (payload.engineer_required) {
    icon = "✅";
    title = "Report Submitted, " + firstName + "!";
    msg = "Thank you. Based on the details provided, an engineer visit appears to be required. Our team is scheduling a visit based on your slot preferences and will confirm the date and time via email or text.";
  } else if (payload.request_closed) {
    icon = "🎉";
    title = "Issue Self-Resolved!";
    msg = "It looks like your issue was successfully resolved through the troubleshooting steps. We've logged this report for our records. If you experience further issues, please submit a new report.";
  } else {
    icon = "✅";
    title = "Report Submitted, " + firstName + "!";
    msg = "Thank you. Your report has been submitted. Our property management team is reviewing your request and will contact you shortly to coordinate resolution.";
  }

  const iconEl = document.getElementById("confirm-icon");
  const titleEl = document.getElementById("confirm-title");
  const msgEl = document.getElementById("confirm-message");
  if (iconEl) iconEl.textContent = icon;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  const noteEl = document.getElementById("confirm-note");
  if (noteEl) {
    noteEl.textContent = "";
    noteEl.className = "confirm-note";
    if (payload.responsibility_type === "possible_tenant") {
      noteEl.textContent = "⚠️ Please note: Based on the troubleshooting details, this issue may fall under tenant responsibility. We will review this and discuss options with you before any contractor is dispatched.";
      noteEl.classList.add("confirm-note--warn");
    } else if (payload.responsibility_type === "landlord") {
      noteEl.textContent = "🏠 This issue has been marked as a potential landlord responsibility. Homeview Property Group will coordinate repairs accordingly.";
      noteEl.classList.add("confirm-note--info");
    }
  }

  state.currentStep = 6;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  state = {
    currentStep: 1,
    selectedCategory: null,
    selectedIssue: null,
    uploadedFiles: [],
    priority: "routine",
    keysAllowed: "",
    hasPets: "",
    petsDetails: "",
    selectedDates: [],
    selectedSlots: {},
    ts: {},
    tsQA: [],
    tsBuiltForCode: null,
    internal: {
      engineer_required: false, request_closed: false,
      responsibility_type: "", priority: "routine",
      alert_type: "", troubleshooting_path: []
    }
  };

  document.getElementById("repair-form").reset();
  const previews = document.getElementById("upload-previews");
  if (previews) previews.innerHTML = "";
  const tsContainer = document.getElementById("troubleshoot-container");
  if (tsContainer) tsContainer.innerHTML = "";

  document.querySelectorAll(".category-card").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".priority-btn").forEach(b => b.classList.remove("selected"));
  document.querySelectorAll(".radio-btn-card").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".appt-date-pill").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".appt-band").forEach(b => b.classList.remove("selected"));
  const sumEl = document.getElementById("appt-summary");
  if (sumEl) sumEl.innerHTML = "";
  const slotsContainer = document.getElementById("appt-per-date-slots");
  if (slotsContainer) slotsContainer.innerHTML = "";

  document.getElementById("pets-details-group").classList.add("hidden");
  document.getElementById("other-issue-group").classList.add("hidden");
  document.getElementById("help-video-container").classList.add("hidden");
  document.getElementById("urgent-banner").classList.add("hidden");
  document.getElementById("emergency-banner").classList.add("hidden");

  // Select default priority
  selectPriorityBtn("routine");

  buildIssueDropdown();
  buildDatePicker();

  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById("step-" + i);
    if (el) el.style.display = (i === 1) ? "block" : "none";
  }
  updateStepIndicators(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
