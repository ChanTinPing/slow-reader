import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4173);
const UNLOCK_HOUR = 8;

const defaultState = {
  settings: {
    bookTitle: "捞尸人",
    sourceUrl: "https://www.69shuba.com/txt/83216/39104252",
    unlockStartDate: unlockDayKey(),
    theme: "paper",
    fontFamily: "serif",
    fontSize: 20,
    lineHeight: 1.9,
    pageWidth: 760
  },
  chapters: [],
  lastReadId: null
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function unlockDayKey(date = new Date()) {
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - UNLOCK_HOUR);
  return todayKey(shifted);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end - start) / 86400000);
}

function unlockedCount(state) {
  if (!state.chapters.length) return 0;
  const elapsed = daysBetween(state.settings.unlockStartDate, unlockDayKey());
  return Math.min(state.chapters.length, Math.max(0, elapsed + 1));
}

async function readState() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeState(defaultState);
    return structuredClone(defaultState);
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
}

function normalizeState(state) {
  return {
    settings: {
      ...defaultState.settings,
      ...(state.settings || {})
    },
    chapters: Array.isArray(state.chapters) ? state.chapters : [],
    lastReadId: state.lastReadId || null
  };
}

function publicState(state) {
  const count = unlockedCount(state);
  const unlocked = state.chapters.slice(0, count).map(({ id, title }) => ({ id, title }));
  const lastReadIsVisible = unlocked.some((chapter) => chapter.id === state.lastReadId);

  return {
    settings: state.settings,
    hasBook: state.chapters.length > 0,
    totalChapters: state.chapters.length,
    unlockedCount: count,
    chapters: unlocked,
    lastReadId: lastReadIsVisible ? state.lastReadId : unlocked.at(-1)?.id || unlocked[0]?.id || null
  };
}

function sanitizeSettings(input, current) {
  const next = { ...current };
  if (typeof input.bookTitle === "string") next.bookTitle = input.bookTitle.trim().slice(0, 80) || current.bookTitle;
  if (typeof input.sourceUrl === "string") next.sourceUrl = input.sourceUrl.trim().slice(0, 500);
  if (["paper", "ivory", "green", "mist", "rose", "night"].includes(input.theme)) next.theme = input.theme;
  if (["serif", "song", "kai", "sans"].includes(input.fontFamily)) next.fontFamily = input.fontFamily;
  if (Number.isFinite(Number(input.fontSize))) next.fontSize = Math.min(28, Math.max(16, Number(input.fontSize)));
  if (Number.isFinite(Number(input.lineHeight))) next.lineHeight = Math.min(2.4, Math.max(1.5, Number(input.lineHeight)));
  if (Number.isFinite(Number(input.pageWidth))) next.pageWidth = Math.min(980, Math.max(560, Number(input.pageWidth)));
  return next;
}

function parseChapters(rawText) {
  const text = rawText
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  if (!text) return [];

  const lines = text.split("\n");
  const headingPattern = /^\s*(第[零〇一二两三四五六七八九十百千万\d]+[章节卷回集][^\n]{0,48}|Chapter\s+\d+[^\n]{0,48})\s*$/i;
  const headings = [];

  lines.forEach((line, index) => {
    if (headingPattern.test(line.trim())) headings.push({ index, title: line.trim() });
  });

  if (!headings.length) {
    return [{
      id: "chapter-1",
      title: "第1章",
      content: cleanContent(text)
    }];
  }

  return headings.map((heading, headingIndex) => {
    const nextHeading = headings[headingIndex + 1];
    const bodyLines = lines.slice(heading.index + 1, nextHeading ? nextHeading.index : lines.length);
    return {
      id: `chapter-${headingIndex + 1}`,
      title: heading.title,
      content: cleanContent(bodyLines.join("\n"))
    };
  }).filter((chapter) => chapter.content.length > 0);
}

function sanitizeChapters(input) {
  if (!Array.isArray(input)) return [];
  return input.map((chapter, index) => {
    const title = typeof chapter.title === "string" ? chapter.title.trim().slice(0, 120) : "";
    const content = typeof chapter.content === "string" ? cleanContent(chapter.content) : "";
    return {
      id: `chapter-${index + 1}`,
      title: title || `第${index + 1}章`,
      content
    };
  }).filter((chapter) => chapter.content.length > 0);
}

function cleanContent(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20 * 1024 * 1024) throw new Error("请求内容太大了。");
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const filePath = path.join(PUBLIC_DIR, requested);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(resolved);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(resolved)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const state = await readState();

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, publicState(state));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/chapters/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/chapters/", ""));
    const visible = state.chapters.slice(0, unlockedCount(state));
    const chapter = visible.find((item) => item.id === id);
    if (!chapter) {
      sendError(response, 404, "这章还没有解封。");
      return;
    }
    state.lastReadId = id;
    await writeState(state);
    sendJson(response, 200, chapter);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJsonBody(request);
    state.settings = sanitizeSettings(body, state.settings);
    await writeState(state);
    sendJson(response, 200, publicState(state));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import-text") {
    const body = await readJsonBody(request);
    if (typeof body.text !== "string" || !body.text.trim()) {
      sendError(response, 400, "请先粘贴或选择 TXT 文本。");
      return;
    }
    const chapters = parseChapters(body.text);
    if (!chapters.length) {
      sendError(response, 400, "没有识别到可阅读的章节内容。");
      return;
    }
    state.chapters = chapters;
    state.lastReadId = null;
    state.settings = sanitizeSettings(body.settings || {}, state.settings);
    state.settings.unlockStartDate = unlockDayKey();
    await writeState(state);
    sendJson(response, 200, { ...publicState(state), importedCount: chapters.length });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import-chapters") {
    const body = await readJsonBody(request);
    const chapters = sanitizeChapters(body.chapters);
    if (!chapters.length) {
      sendError(response, 400, "没有可导入的章节内容。");
      return;
    }
    state.chapters = chapters;
    state.lastReadId = null;
    state.settings = sanitizeSettings(body.settings || {}, state.settings);
    state.settings.unlockStartDate = unlockDayKey();
    await writeState(state);
    sendJson(response, 200, { ...publicState(state), importedCount: chapters.length });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/clear") {
    state.chapters = [];
    state.lastReadId = null;
    await writeState(state);
    sendJson(response, 200, publicState(state));
    return;
  }

  sendError(response, 404, "没有这个接口。");
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendError(response, 500, error.message || "服务器出错了。");
  }
});

server.listen(PORT, () => {
  console.log(`慢读器已启动：http://localhost:${PORT}`);
});
