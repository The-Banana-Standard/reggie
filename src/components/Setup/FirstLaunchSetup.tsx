import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FirstLaunchSetupProps {
  onComplete: () => void;
}

export function FirstLaunchSetup({ onComplete }: FirstLaunchSetupProps) {
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "copied">("idle");
  const [message, setMessage] = useState("");
  const [exportLine, setExportLine] = useState("export ENABLE_TOOL_SEARCH=auto:5");
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the canonical export line from the backend.
  useEffect(() => {
    invoke<string>("get_shell_export_line")
      .then(setExportLine)
      .catch(() => { /* keep default */ });
  }, []);

  // Clean up dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const autoDismiss = () => {
    dismissTimer.current = setTimeout(() => {
      onComplete();
    }, 2000);
  };

  const handleAddToProfile = async () => {
    setStatus("adding");
    try {
      const result = await invoke<string>("add_to_shell_profile");
      setMessage(result);
      setStatus("added");
      autoDismiss();
    } catch (err) {
      setMessage(`Failed: ${err}`);
      setStatus("idle");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportLine);
    } catch {
      setMessage("Copy failed -- add manually: " + exportLine);
      return;
    }

    setStatus("copied");
    setMessage("Copied to clipboard");

    // Mark setup as complete in the backend (non-fatal if it fails).
    try {
      await invoke("complete_setup");
    } catch { /* non-fatal */ }

    autoDismiss();
  };

  const handleSkip = async () => {
    try {
      await invoke("complete_setup");
    } catch {
      // Non-fatal: the flag just won't be written.
    }
    onComplete();
  };

  return (
    <div className="first-launch-overlay">
      <div className="first-launch-modal">
        <div className="first-launch-header">
          <span className="first-launch-icon">&gt;_</span>
          <h2>Reggie Setup</h2>
        </div>

        <div className="first-launch-body">
          <p className="first-launch-description">
            Reggie has been installed to <code>~/.claude/</code>. One optional step remains:
          </p>

          <div className="first-launch-purpose-box">
            <h3>ENABLE_TOOL_SEARCH</h3>
            <p>
              This environment variable lets Claude Code automatically discover and use
              Reggie agents and commands without being told where they are. Set to{" "}
              <code>auto:5</code>, it allows up to 5 tool-search results per query.
            </p>
            <div className="first-launch-code-block">
              <code>{exportLine}</code>
            </div>
          </div>

          {message && (
            <div className={`first-launch-message ${status === "added" || status === "copied" ? "success" : ""}`}>
              {message}
            </div>
          )}
        </div>

        <div className="first-launch-actions">
          <button
            className="first-launch-btn primary"
            onClick={handleAddToProfile}
            disabled={status === "adding" || status === "added"}
          >
            {status === "adding" ? "Adding..." : status === "added" ? "Added" : "Add to shell profile"}
          </button>
          <button
            className="first-launch-btn secondary"
            onClick={handleCopy}
            disabled={status === "copied"}
          >
            {status === "copied" ? "Copied" : "Copy to clipboard"}
          </button>
          <button
            className="first-launch-btn ghost"
            onClick={handleSkip}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
