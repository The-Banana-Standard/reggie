import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { open } from "@tauri-apps/plugin-shell";
import type { TerminalTab } from "../../types/terminal";
import {
  spawnTerminal,
  writeToTerminal,
  resizeTerminal,
  attachTerminalChannel,
  writeToHeadlessTerminal,
  resizeHeadlessTerminal,
} from "../../services/terminal-service";

/**
 * Returns false when the element is not actually rendered (e.g. display:none).
 * `offsetParent === null` is the canonical "not in the render tree" check —
 * it returns null for display:none elements and their descendants. The
 * rect.width belt-and-suspenders catches edge cases where layout exists but
 * is implausibly small (e.g. a parent collapsed to near-zero mid-transition).
 *
 * Why this matters: calling fitAddon.fit() while hidden makes
 * proposeDimensions() read `getComputedStyle(parent).width` as the literal
 * string "100%" → parseInt("100%") === 100 → cols ≈ 10 → that narrow size
 * is pushed to the PTY and Claude's TUI bakes hard newlines into the buffer
 * that cannot be un-wrapped on re-show.
 * See .pipeline/fix-sessions-tab-width-on-return/HANDOFF.md for the full chain.
 */
function isContainerVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.offsetParent === null) return false;
  if (el.getBoundingClientRect().width < 50) return false;
  return true;
}

const darkTheme = {
  background: "#0D0D0D",
  foreground: "#E0E0E0",
  cursor: "#FF6B00",
  cursorAccent: "#0D0D0D",
  selectionBackground: "#FF6B0040",
  black: "#1A1A1A",
  red: "#FF5555",
  green: "#50FA7B",
  yellow: "#FFB86C",
  blue: "#6272A4",
  magenta: "#FF79C6",
  cyan: "#8BE9FD",
  white: "#E0E0E0",
  brightBlack: "#555555",
  brightRed: "#FF6E6E",
  brightGreen: "#69FF94",
  brightYellow: "#FFCFA8",
  brightBlue: "#D6ACFF",
  brightMagenta: "#FF92DF",
  brightCyan: "#A4FFFF",
  brightWhite: "#FFFFFF",
};

const lightTheme = {
  background: "#fefdf2",
  foreground: "#1a1a1a",
  cursor: "#05c250",
  cursorAccent: "#fefdf2",
  selectionBackground: "#05c25040",
  black: "#1a1a1a",
  red: "#c33",
  green: "#047d34",
  yellow: "#8a6d00",
  blue: "#2656a8",
  magenta: "#8b3a8b",
  cyan: "#0e7a7a",
  white: "#4a4a4a",
  brightBlack: "#7a7a7a",
  brightRed: "#e04040",
  brightGreen: "#05c250",
  brightYellow: "#b08f00",
  brightBlue: "#3a72c4",
  brightMagenta: "#a850a8",
  brightCyan: "#12a0a0",
  brightWhite: "#1a1a1a",
};

interface TerminalViewProps {
  tab: TerminalTab;
  isVisible: boolean;
  expanded?: boolean;
  onTerminalSpawned: (tabId: string, terminalId: string) => void;
  claudeCliAvailable?: boolean;
  onTabDied?: () => void;
  isDragging?: boolean;
  currentTheme?: "dark" | "light";
}

export function TerminalView({
  tab,
  isVisible,
  expanded,
  onTerminalSpawned,
  claudeCliAvailable,
  onTabDied,
  isDragging,
  currentTheme,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const terminalIdRef = useRef<string | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Keep latest callbacks in refs to avoid stale closures
  const onTerminalSpawnedRef = useRef(onTerminalSpawned);
  onTerminalSpawnedRef.current = onTerminalSpawned;
  const onTabDiedRef = useRef(onTabDied);
  onTabDiedRef.current = onTabDied;

  // Init terminal on first visibility — no cleanup (xterm persists)
  useEffect(() => {
    if (!containerRef.current || spawnedRef.current || !isVisible) return;
    spawnedRef.current = true;

    const container = containerRef.current;

    const isDarkTheme = document.documentElement.dataset.theme === "dark";

    const xterm = new Terminal({
      cursorBlink: true,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: isDarkTheme ? darkTheme : lightTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon((_, uri) => { open(uri).catch(console.error); }));

    xterm.open(container);
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Fit after a frame so container has real dimensions
    requestAnimationFrame(() => fitAddon.fit());

    // Guard: if Claude CLI is not available, show help instead of spawning
    if (tab.isClaudeSession && claudeCliAvailable === false) {
      xterm.write("\x1b[31mClaude CLI not found.\x1b[0m\r\n\r\n");
      xterm.write("Install it with:\r\n");
      xterm.write("  \x1b[33mnpm install -g @anthropic-ai/claude-code\x1b[0m\r\n\r\n");
      xterm.write("Then close this tab and try again.\r\n");
      onTabDiedRef.current?.();
      return;
    }

    // Handle promoted headless sessions — replay buffer and attach live channel
    if (tab.isHeadlessPromoted && tab.headlessTerminalId) {
      const headlessId = tab.headlessTerminalId;
      terminalIdRef.current = headlessId;
      onTerminalSpawnedRef.current(tab.id, headlessId);

      // Atomically attach live channel and get buffered output (no gap)
      attachTerminalChannel(headlessId, (event) => {
        if (event.type === "output") {
          xterm.write(new Uint8Array(event.data));
        } else if (event.type === "exit") {
          xterm.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
          onTabDiedRef.current?.();
        }
      })
        .then((buffer) => {
          if (buffer.length > 0) {
            xterm.write(new Uint8Array(buffer));
          }
          // Connect user input
          xterm.onData((data) => {
            writeToHeadlessTerminal(headlessId, data).catch(console.error);
          });

          const ro = new ResizeObserver(() => {
            if (!isContainerVisible(container)) return;
            fitAddon.fit();
            resizeHeadlessTerminal(headlessId, xterm.rows, xterm.cols).catch(console.error);
          });
          ro.observe(container);
          roRef.current = ro;
        })
        .catch((err) => {
          xterm.write(`\x1b[31mFailed to attach: ${err}\x1b[0m\r\n`);
        });

      return;
    }

    spawnTerminal(
      tab.projectPath,
      tab.isClaudeSession,
      tab.sessionId || null,
      (event) => {
        if (event.type === "output") {
          xterm.write(new Uint8Array(event.data));
        } else if (event.type === "exit") {
          xterm.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
          onTabDiedRef.current?.();
        }
      },
      tab.initialPrompt,
      undefined,
      tab.model,
      tab.effort,
    )
      .then((termId) => {
        terminalIdRef.current = termId;
        onTerminalSpawnedRef.current(tab.id, termId);

        xterm.onData((data) => {
          writeToTerminal(termId, data).catch(console.error);
        });

        const ro = new ResizeObserver(() => {
          if (!isContainerVisible(container)) return;
          fitAddon.fit();
          resizeTerminal(termId, xterm.rows, xterm.cols).catch(console.error);
        });
        ro.observe(container);
        roRef.current = ro;
      })
      .catch((err) => {
        xterm.write(`\x1b[31mFailed to start: ${err}\x1b[0m\r\n`);
      });

    // NO cleanup here — xterm must survive visibility changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // Cleanup on UNMOUNT only
  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      xtermRef.current?.dispose();
    };
  }, []);

  // Update xterm theme when the app theme changes (skip initial render —
  // the terminal is created with the correct theme in the init effect above)
  const themeInitializedRef = useRef(false);
  useEffect(() => {
    if (!themeInitializedRef.current) {
      themeInitializedRef.current = true;
      return;
    }
    if (xtermRef.current && currentTheme) {
      xtermRef.current.options.theme = currentTheme === "dark" ? darkTheme : lightTheme;
    }
  }, [currentTheme]);

  // Re-fit when becoming visible again or when layout changes.
  // The Sessions tab CSS grid transitions from offscreen (absolute positioned) to
  // grid-mode — a single rAF fires before the container's final dimensions settle,
  // causing fitAddon to measure a near-zero size. Double-rAF spans two paint cycles
  // so the grid layout is resolved, then a short setTimeout provides a safety net
  // for slower layout engines.
  useEffect(() => {
    if (isVisible && fitAddonRef.current && xtermRef.current && terminalIdRef.current) {
      let outerRafId: number;
      let innerRafId: number;
      let timerId: ReturnType<typeof setTimeout>;
      let cancelled = false;

      const doFit = () => {
        if (cancelled) return;
        if (!isContainerVisible(containerRef.current)) return;
        fitAddonRef.current?.fit();
        if (terminalIdRef.current && xtermRef.current) {
          const resizeFn = tab.isHeadlessPromoted ? resizeHeadlessTerminal : resizeTerminal;
          resizeFn(
            terminalIdRef.current,
            xtermRef.current.rows,
            xtermRef.current.cols
          ).catch(console.error);
        }
      };

      // Double-rAF: first rAF queues after current paint, second after the next
      outerRafId = requestAnimationFrame(() => {
        innerRafId = requestAnimationFrame(() => {
          // Safety-net timeout lets the CSS grid fully settle before measuring
          timerId = setTimeout(doFit, 50);
        });
      });

      return () => {
        cancelled = true;
        cancelAnimationFrame(outerRafId);
        cancelAnimationFrame(innerRafId);
        clearTimeout(timerId);
      };
    }
  }, [isVisible, expanded, tab.isHeadlessPromoted]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{
        display: isVisible ? "block" : "none",
        position: "relative",
      }}
    >
      {isDragging && (
        <div className="terminal-drop-overlay">
          <div className="terminal-drop-overlay-content">
            <span className="terminal-drop-overlay-icon">+</span>
            <span>Drop files to paste path</span>
          </div>
        </div>
      )}
    </div>
  );
}
