import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const COLLAPSED_LINE_COUNT = 10;

interface RefSpan {
  type: "head" | "branch" | "remote" | "tag";
  text: string;
}

function parseRefs(decoration: string): RefSpan[] {
  const spans: RefSpan[] = [];
  // Strip outer parens
  const inner = decoration.replace(/^\(/, "").replace(/\)$/, "");
  const parts = inner.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (part === "HEAD") {
      spans.push({ type: "head", text: "HEAD" });
    } else if (part.startsWith("HEAD -> ")) {
      spans.push({ type: "head", text: "HEAD" });
      spans.push({ type: "branch", text: part.slice(8) });
    } else if (part.startsWith("tag: ")) {
      spans.push({ type: "tag", text: part });
    } else if (part.startsWith("origin/") || part.includes("/")) {
      spans.push({ type: "remote", text: part });
    } else {
      spans.push({ type: "branch", text: part });
    }
  }

  return spans;
}

const REF_CLASS_MAP: Record<RefSpan["type"], string> = {
  head: "git-ref-head",
  branch: "git-ref-branch",
  remote: "git-ref-remote",
  tag: "git-ref-tag",
};

function renderLine(line: string, index: number): React.ReactNode {
  const elements: React.ReactNode[] = [];

  // Match decoration block: (HEAD -> main, origin/main)
  const decoMatch = line.match(/(\([^)]+\))/);
  if (decoMatch && decoMatch.index !== undefined) {
    const before = line.slice(0, decoMatch.index);
    const decoStr = decoMatch[1];
    const after = line.slice(decoMatch.index + decoStr.length);

    // Render text before decoration (may contain hash)
    elements.push(...renderTextWithHash(before, 0));

    // Render decoration
    const refs = parseRefs(decoStr);
    elements.push(
      <span key={`deco-${index}`} className="git-ref-decoration">
        {"("}
        {refs.map((ref, ri) => (
          <span key={`ref-${ri}`}>
            {ri > 0 && ", "}
            <span className={REF_CLASS_MAP[ref.type]}>{ref.text}</span>
          </span>
        ))}
        {")"}
      </span>
    );

    // Render text after decoration
    elements.push(<span key={`after-${index}`}>{after}</span>);
  } else {
    // No decoration, just render with hash highlighting
    elements.push(...renderTextWithHash(line, 0));
  }

  return <div key={index} className="git-log-line">{elements}</div>;
}

function renderTextWithHash(text: string, startKey: number): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  // Match hash: graph chars (*, |, /, \, space) followed by 7+ hex chars
  const hashMatch = text.match(/^([*|/\\ ]*)([0-9a-f]{7,})(.*)$/);
  if (hashMatch) {
    if (hashMatch[1]) {
      elements.push(<span key={startKey} className="git-graph-char">{hashMatch[1]}</span>);
    }
    elements.push(<span key={startKey + 1} className="git-hash">{hashMatch[2]}</span>);
    if (hashMatch[3]) {
      elements.push(<span key={startKey + 2}>{hashMatch[3]}</span>);
    }
  } else {
    elements.push(<span key={startKey}>{text}</span>);
  }
  return elements;
}

export function GitLogView({
  projectPath,
  isGitRepo,
}: {
  projectPath: string;
  isGitRepo: boolean;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const currentPathRef = useRef(projectPath);

  const loadGitLog = useCallback((path: string) => {
    setLoading(true);
    invoke<string[]>("get_git_log", { projectPath: path, limit: 50 })
      .then((result) => {
        if (currentPathRef.current === path) {
          setLines(result ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load git log:", err);
        if (currentPathRef.current === path) {
          setLines([]);
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    currentPathRef.current = projectPath;
    setExpanded(false);
    setLines([]);
    if (isGitRepo) {
      loadGitLog(projectPath);
    } else {
      setLoading(false);
    }
  }, [projectPath, isGitRepo, loadGitLog]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (!isGitRepo) return null;
  if (loading) return null;
  if (lines.length === 0) {
    return <div className="git-log-empty">No git history found.</div>;
  }

  const displayLines = expanded ? lines : lines.slice(0, COLLAPSED_LINE_COUNT);
  const canToggle = lines.length > COLLAPSED_LINE_COUNT;

  return (
    <div className="git-log-wrapper">
      <pre className="git-log-content">
        {displayLines.map((line, i) => renderLine(line, i))}
      </pre>
      {canToggle && (
        <button className="git-log-toggle" onClick={handleToggle}>
          {expanded ? "Show less" : `Show more (${lines.length - COLLAPSED_LINE_COUNT} more)`}
        </button>
      )}
    </div>
  );
}
