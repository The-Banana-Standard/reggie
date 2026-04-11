import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DetailedInstallStatus {
  version: string;
  bundledVersion: string;
  needsSetup: boolean;
  agentCount: number;
  commandCount: number;
  hookCount: number;
  toolSearchConfigured: boolean;
}

interface InstallResult {
  installed: boolean;
  version: string;
  needsSetup: boolean;
  message: string;
}

type ReinstallState = "idle" | "reinstalling" | "success" | "error";

export function SettingsPanel() {
  const [status, setStatus] = useState<DetailedInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reinstallState, setReinstallState] = useState<ReinstallState>("idle");
  const [reinstallMessage, setReinstallMessage] = useState("");
  const [envStatus, setEnvStatus] = useState<"idle" | "adding" | "added" | "copied">("idle");
  const [envMessage, setEnvMessage] = useState("");
  const [exportLine, setExportLine] = useState("export ENABLE_TOOL_SEARCH=auto:5");
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(() => {
    setLoading(true);
    invoke<DetailedInstallStatus>("get_detailed_install_status")
      .then((result) => {
        setStatus(result);
        setLoading(false);
      })
      .catch(() => {
        setStatus(null);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    invoke<string>("get_shell_export_line")
      .then(setExportLine)
      .catch(() => { /* keep default */ });
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const handleReinstall = useCallback(async () => {
    setReinstallState("reinstalling");
    setReinstallMessage("");
    try {
      const result = await invoke<InstallResult>("force_reinstall");
      setReinstallState("success");
      setReinstallMessage(result.message);
      // Refresh the status after reinstall.
      loadStatus();
    } catch (err) {
      setReinstallState("error");
      setReinstallMessage(`Failed: ${err}`);
    }
  }, [loadStatus]);

  const handleAddToProfile = useCallback(async () => {
    setEnvStatus("adding");
    try {
      const result = await invoke<string>("add_to_shell_profile");
      setEnvMessage(result);
      setEnvStatus("added");
      // Refresh status to pick up any changes.
      loadStatus();
    } catch (err) {
      setEnvMessage(`Failed: ${err}`);
      setEnvStatus("idle");
    }
  }, [loadStatus]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportLine);
    } catch {
      setEnvMessage("Copy failed -- add manually: " + exportLine);
      return;
    }

    setEnvStatus("copied");
    setEnvMessage("Copied to clipboard");

    try {
      await invoke("complete_setup");
    } catch { /* non-fatal */ }
  }, [exportLine]);

  if (loading) {
    return (
      <div className="settings-panel">
        <h3 className="settings-panel-title">Settings</h3>
        <div className="settings-empty">Loading...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="settings-panel">
        <h3 className="settings-panel-title">Settings</h3>
        <div className="settings-empty">Unable to load install status</div>
      </div>
    );
  }

  const hasUpdate = status.version !== status.bundledVersion && status.version !== "";

  return (
    <div className="settings-panel">
      <h3 className="settings-panel-title">Settings</h3>

      {/* ── Reggie System ── */}
      <div className="settings-section">
        <div className="settings-section-header">Reggie System</div>

        <div className="settings-info-grid">
          <div className="settings-info-row">
            <span className="settings-info-label">Installed</span>
            <span className="settings-info-value">
              {status.version || "none"}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">Bundled</span>
            <span className="settings-info-value">
              {status.bundledVersion}
              {hasUpdate && (
                <span className="settings-update-badge">update available</span>
              )}
            </span>
          </div>
        </div>

        <div className="settings-counts">
          <div className="settings-count-item">
            <span className="settings-count-number">{status.agentCount}</span>
            <span className="settings-count-label">agents</span>
          </div>
          <div className="settings-count-item">
            <span className="settings-count-number">{status.commandCount}</span>
            <span className="settings-count-label">commands</span>
          </div>
          <div className="settings-count-item">
            <span className="settings-count-number">{status.hookCount}</span>
            <span className="settings-count-label">hooks</span>
          </div>
        </div>

        <button
          className="settings-btn primary"
          onClick={handleReinstall}
          disabled={reinstallState === "reinstalling"}
        >
          {reinstallState === "reinstalling"
            ? "Reinstalling..."
            : reinstallState === "success"
              ? "Reinstalled"
              : "Reinstall"}
        </button>

        {reinstallMessage && (
          <div className={`settings-message ${reinstallState === "success" ? "success" : reinstallState === "error" ? "error" : ""}`}>
            {reinstallMessage}
          </div>
        )}
      </div>

      {/* ── Environment ── */}
      <div className="settings-section">
        <div className="settings-section-header">Environment</div>

        <div className="settings-env-status">
          <span className="settings-info-label">ENABLE_TOOL_SEARCH</span>
          <span className={`settings-env-indicator ${status.toolSearchConfigured ? "configured" : "not-configured"}`}>
            {status.toolSearchConfigured ? "configured" : "not set"}
          </span>
        </div>

        <p className="settings-env-description">
          This environment variable lets Claude Code automatically discover and use
          Reggie agents and commands without being told where they are. Set to{" "}
          <code>auto:5</code>, it allows up to 5 tool-search results per query.
        </p>

        <div className="settings-env-code">
          <code>{exportLine}</code>
        </div>

        {!status.toolSearchConfigured && (
          <div className="settings-env-actions">
            <button
              className="settings-btn primary"
              onClick={handleAddToProfile}
              disabled={envStatus === "adding" || envStatus === "added"}
            >
              {envStatus === "adding"
                ? "Adding..."
                : envStatus === "added"
                  ? "Added"
                  : "Add to shell profile"}
            </button>
            <button
              className="settings-btn secondary"
              onClick={handleCopy}
              disabled={envStatus === "copied"}
            >
              {envStatus === "copied" ? "Copied" : "Copy to clipboard"}
            </button>
          </div>
        )}

        {envMessage && (
          <div className={`settings-message ${envStatus === "added" || envStatus === "copied" ? "success" : ""}`}>
            {envMessage}
          </div>
        )}
      </div>
    </div>
  );
}
