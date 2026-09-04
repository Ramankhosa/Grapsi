import { diffLines } from "diff";

export type DiffPart = { t: "add" | "del" | "ctx"; text: string };

export function computeDiff(oldText: string, newText: string): DiffPart[] {
  const parts = diffLines(oldText.endsWith("\n") ? oldText : oldText + "\n", newText.endsWith("\n") ? newText : newText + "\n");
  const out: DiffPart[] = [];
  for (const part of parts) {
    const t: DiffPart["t"] = part.added ? "add" : part.removed ? "del" : "ctx";
    // Trim unchanged context so stored diffs stay small: keep at most the
    // first and last 3 lines of each context run.
    if (t === "ctx") {
      const lines = part.value.split("\n").filter((l) => l.length > 0);
      if (lines.length > 7) {
        out.push({ t, text: [...lines.slice(0, 3), `… (${lines.length - 6} unchanged lines)`, ...lines.slice(-3)].join("\n") });
        continue;
      }
    }
    const text = part.value.replace(/\n+$/, "");
    if (text.length > 0) out.push({ t, text });
  }
  return out;
}

export function addedLines(diff: DiffPart[]): string {
  return diff.filter((p) => p.t === "add").map((p) => p.text).join("\n");
}

export function removedLines(diff: DiffPart[]): string {
  return diff.filter((p) => p.t === "del").map((p) => p.text).join("\n");
}
