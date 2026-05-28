const STORAGE_KEY = "slow-reader-data-v1";
const UNLOCK_HOUR = 8;

const screens = {
  catalog: document.querySelector("#catalogScreen"),
  reader: document.querySelector("#readerScreen")
};

const state = {
  data: null,
  fullData: null,
  mode: "remote",
  currentChapterId: null,
  saveTimer: null
};

const elements = {
  backButton: document.querySelector("#backButton"),
  settingsButton: document.querySelector("#settingsButton"),
  closeSettings: document.querySelector("#closeSettings"),
  drawer: document.querySelector("#settingsDrawer"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  bookTitle: document.querySelector("#bookTitle"),
  chapterList: document.querySelector("#chapterList"),
  emptyState: document.querySelector("#emptyState"),
  importFileInput: document.querySelector("#importFileInput"),
  readerTitle: document.querySelector("#readerTitle"),
  readerContent: document.querySelector("#readerContent"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  lineHeightInput: document.querySelector("#lineHeightInput"),
  lineHeightValue: document.querySelector("#lineHeightValue")
};

elements.backButton.addEventListener("click", () => showCatalog());
elements.settingsButton.addEventListener("click", () => openSettings());
elements.closeSettings.addEventListener("click", () => closeSettings());
elements.drawerBackdrop.addEventListener("click", () => closeSettings());

elements.importFileInput.addEventListener("change", async () => {
  const file = elements.importFileInput.files?.[0];
  if (!file) return;
  const imported = normalizeFullState(JSON.parse(await file.text()));
  saveLocalFullState(imported);
  state.mode = "local";
  state.fullData = imported;
  state.data = publicState(imported);
  applySettings(state.data.settings);
  renderCatalog();
  showCatalog();
});

elements.fontSizeInput.addEventListener("input", () => {
  state.data.settings.fontSize = Number(elements.fontSizeInput.value);
  applySettings(state.data.settings);
  scheduleSaveSettings();
});

elements.lineHeightInput.addEventListener("input", () => {
  state.data.settings.lineHeight = Number(elements.lineHeightInput.value);
  applySettings(state.data.settings);
  scheduleSaveSettings();
});

document.querySelectorAll("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    state.data.settings.theme = button.dataset.theme;
    applySettings(state.data.settings);
    scheduleSaveSettings();
  });
});

document.querySelectorAll("[data-font-family]").forEach((button) => {
  button.addEventListener("click", () => {
    state.data.settings.fontFamily = button.dataset.fontFamily;
    applySettings(state.data.settings);
    scheduleSaveSettings();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

await refresh();

async function refresh() {
  const local = loadLocalFullState();
  if (local) {
    state.mode = "local";
    state.fullData = local;
    state.data = publicState(local);
  } else {
    try {
      state.mode = "remote";
      state.data = await api("api/state");
    } catch {
      state.mode = "local";
      state.fullData = emptyFullState();
      state.data = publicState(state.fullData);
    }
  }

  applySettings(state.data.settings);
  renderCatalog();
  showCatalog();
}

function applySettings(settings) {
  document.body.className = `theme-${settings.theme}${document.body.classList.contains("is-reading") ? " is-reading" : ""}`;
  document.documentElement.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
  document.documentElement.style.setProperty("--reader-line-height", settings.lineHeight);
  document.documentElement.style.setProperty("--reader-width", `${settings.pageWidth || 760}px`);
  document.documentElement.style.setProperty("--reader-font-family", fontFamily(settings.fontFamily));

  elements.bookTitle.textContent = settings.bookTitle || "捞尸人";
  elements.fontSizeInput.value = settings.fontSize;
  elements.lineHeightInput.value = settings.lineHeight;
  elements.fontSizeValue.value = `${settings.fontSize}px`;
  elements.lineHeightValue.value = String(settings.lineHeight);

  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.theme === settings.theme);
  });
  document.querySelectorAll("[data-font-family]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.fontFamily === settings.fontFamily);
  });
}

function fontFamily(value) {
  const families = {
    serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
    song: '"SimSun", "Songti SC", serif',
    kai: '"KaiTi", "STKaiti", "Kaiti SC", serif',
    sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
  };
  return families[value] || families.serif;
}

function renderCatalog() {
  const chapters = state.data.chapters || [];
  elements.chapterList.replaceChildren();
  elements.emptyState.classList.toggle("is-visible", chapters.length === 0);

  chapters.forEach((chapter) => {
    const button = document.createElement("button");
    button.className = "chapter-card";
    button.type = "button";
    button.textContent = chapter.title;
    button.addEventListener("click", () => openChapter(chapter.id));
    elements.chapterList.append(button);
  });
}

async function openChapter(id) {
  const chapter = state.mode === "local" ? localChapter(id) : await api(`api/chapters/${encodeURIComponent(id)}`);
  state.currentChapterId = chapter.id;
  elements.readerTitle.textContent = chapter.title;
  elements.readerContent.replaceChildren(...chapter.content.split(/\n+/).map((paragraph) => {
    const element = document.createElement("p");
    element.textContent = paragraph;
    return element;
  }));
  showReader();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function localChapter(id) {
  const visible = state.fullData.chapters.slice(0, unlockedCount(state.fullData));
  const chapter = visible.find((item) => item.id === id);
  if (!chapter) throw new Error("这章还没有解封。");
  state.fullData.lastReadId = id;
  saveLocalFullState(state.fullData);
  return chapter;
}

function showCatalog() {
  screens.catalog.classList.add("is-active");
  screens.reader.classList.remove("is-active");
  document.body.classList.remove("is-reading");
  elements.backButton.setAttribute("aria-hidden", "true");
  elements.backButton.setAttribute("tabindex", "-1");
  applySettings(state.data?.settings || emptyFullState().settings);
}

function showReader() {
  screens.catalog.classList.remove("is-active");
  screens.reader.classList.add("is-active");
  document.body.classList.add("is-reading");
  elements.backButton.removeAttribute("aria-hidden");
  elements.backButton.removeAttribute("tabindex");
  applySettings(state.data.settings);
}

function openSettings() {
  elements.drawer.hidden = false;
  elements.drawerBackdrop.hidden = false;
  elements.drawer.classList.add("is-open");
  elements.drawer.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  elements.drawer.classList.remove("is-open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawer.hidden = true;
  elements.drawerBackdrop.hidden = true;
}

function scheduleSaveSettings() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    if (state.mode === "local") {
      state.fullData.settings = { ...state.fullData.settings, ...state.data.settings };
      saveLocalFullState(state.fullData);
      state.data = publicState(state.fullData);
      return;
    }
    await api("api/settings", {
      method: "POST",
      body: JSON.stringify({
        theme: state.data.settings.theme,
        fontFamily: state.data.settings.fontFamily,
        fontSize: state.data.settings.fontSize,
        lineHeight: state.data.settings.lineHeight
      })
    });
  }, 180);
}

function publicState(fullState) {
  const count = unlockedCount(fullState);
  const chapters = fullState.chapters.slice(0, count).map(({ id, title }) => ({ id, title }));
  const lastReadIsVisible = chapters.some((chapter) => chapter.id === fullState.lastReadId);
  return {
    settings: fullState.settings,
    hasBook: fullState.chapters.length > 0,
    totalChapters: fullState.chapters.length,
    unlockedCount: count,
    chapters,
    lastReadId: lastReadIsVisible ? fullState.lastReadId : chapters.at(-1)?.id || chapters[0]?.id || null
  };
}

function unlockedCount(fullState) {
  if (!fullState.chapters.length) return 0;
  const elapsed = daysBetween(fullState.settings.unlockStartDate, unlockDayKey());
  return Math.min(fullState.chapters.length, Math.max(0, elapsed + 1));
}

function unlockDayKey(date = new Date()) {
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - UNLOCK_HOUR);
  return dayKey(shifted);
}

function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end - start) / 86400000);
}

function emptyFullState() {
  return {
    settings: {
      bookTitle: "捞尸人",
      unlockStartDate: unlockDayKey(),
      theme: "paper",
      fontFamily: "serif",
      fontSize: 17,
      lineHeight: 1.6,
      pageWidth: 760
    },
    chapters: [],
    lastReadId: null
  };
}

function normalizeFullState(input) {
  const defaults = emptyFullState();
  return {
    settings: {
      ...defaults.settings,
      ...(input.settings || {})
    },
    chapters: Array.isArray(input.chapters) ? input.chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      title: `第${index + 1}章`,
      content: String(chapter.content || "").trim()
    })).filter((chapter) => chapter.content) : [],
    lastReadId: input.lastReadId || null
  };
}

function loadLocalFullState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeFullState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocalFullState(fullState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeFullState(fullState)));
}

async function api(path, options = {}) {
  const url = `${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}
