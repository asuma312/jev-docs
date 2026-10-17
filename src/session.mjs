// Per-session memory, so the hook only injects pages the agent hasn't
// already been pointed to or opened in the current conversation.

import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "./docs-index.mjs";

const SESSIONS_DIR = path.join(CACHE_DIR, "sessions");
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const TAIL_BYTES = 2_000_000;

const sessionFile = (sessionId) => path.join(SESSIONS_DIR, `${String(sessionId).replace(/[^\w.-]/g, "_")}.json`);

// Comparable form of an absolute path: resolved, forward slashes, case-folded on Windows.
export function pathKey(p) {
  const abs = path.resolve(p).split(path.sep).join("/");
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

export function loadSuggested(sessionId) {
  if (!sessionId) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf8")).docs || []);
  } catch {
    return new Set();
  }
}

export function saveSuggested(sessionId, keys) {
  if (!sessionId) return;
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(sessionFile(sessionId), JSON.stringify({ updatedAt: new Date().toISOString(), docs: [...keys] }));
  } catch {}
}

export function resetSession(sessionId) {
  if (!sessionId) return;
  try {
    fs.rmSync(sessionFile(sessionId), { force: true });
  } catch {}
}

// Drops session files untouched for two weeks.
export function pruneSessions(now = Date.now()) {
  try {
    for (const name of fs.readdirSync(SESSIONS_DIR)) {
      const f = path.join(SESSIONS_DIR, name);
      if (now - fs.statSync(f).mtimeMs > MAX_AGE_MS) fs.rmSync(f, { force: true });
    }
  } catch {}
}

// Files the agent opened with the Read tool, from the tail of the transcript.
export function readFilesFromTranscript(transcriptPath) {
  const keys = new Set();
  if (!transcriptPath) return keys;
  try {
    const stat = fs.statSync(transcriptPath);
    const size = Math.min(stat.size, TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes('"tool_use"')) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const content = row.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "tool_use" && block.name === "Read" && typeof block.input?.file_path === "string") {
          keys.add(pathKey(block.input.file_path));
        }
      }
    }
  } catch {}
  return keys;
}

// Keeps only pages not suggested earlier in the session and not already read.
export function newPagesOnly(selected, docsRoot, suggested, read) {
  return selected.filter((d) => {
    const key = pathKey(path.join(docsRoot, d.rel));
    return !suggested.has(key) && !read.has(key);
  });
}
