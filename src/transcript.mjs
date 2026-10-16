// Reads the last few user messages from a Claude Code transcript (JSONL),
// so Jev sees what the conversation is about, not only the latest prompt.

import fs from "node:fs";
import { clip } from "./docs-index.mjs";

const TAIL_BYTES = 400_000;

export function recentUserMessages(transcriptPath, currentPrompt, limit = 3) {
  if (!transcriptPath) return [];
  try {
    const stat = fs.statSync(transcriptPath);
    const size = Math.min(stat.size, TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    const msgs = [];
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes('"user"')) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "user" || row.message?.role !== "user" || row.isMeta) continue;
      const c = row.message.content;
      const text =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")
            : "";
      // Skips tool results and harness-injected blocks such as <command-name>.
      if (text && !text.startsWith("<") && text.trim() !== currentPrompt.trim()) msgs.push(clip(text.trim(), 600));
    }
    return msgs.slice(-limit);
  } catch {
    return [];
  }
}
