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

interface UninstallReport {
  filesRemoved: string[];
  settingsHookRemoved: boolean;
  shellProfileRemoved: boolean;
  versionFileRemoved: boolean;
  overlaysPreserved: string[];
}

type ReinstallState = "idle" | "reinstalling" | "success" | "error";
type UninstallState = "idle" | "uninstalling" | "success" | "error";

export function SettingsPanel() {
  const [status, setStatus] = useState<DetailedInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reinstallState, setReinstallState] = useState<ReinstallState>("idle");
  const [reinstallMessage, setReinstallMessage] = useState("");
  const [envStatus, setEnvStatus] = useState<"idle" | "adding" | "added" | "copied">("idle");
  const [envMessage, setEnvMessage] = useState("");
  const [exportLine, setExportLine] = useState("export ENABLE_TOOL_SEARCH=auto:5");
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Danger Zone / uninstall state
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [uninstallRemoveShellProfile, setUninstallRemoveShellProfile] = useState(false);
  const [uninstallState, setUninstallState] = useState<UninstallState>("idle");
  const [uninstallError, setUninstallError] = useState("");
  const [uninstallReport, setUninstallReport] = useState<UninstallReport | null>(null);

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

  const openUninstallModal = useCallback(() => {
    setUninstallModalOpen(true);
    setUninstallState("idle");
    setUninstallError("");
    setUninstallReport(null);
    setUninstallRemoveShellProfile(false);
  }, []);

  const closeUninstallModal = useCallback(() => {
    if (uninstallState === "uninstalling") return;
    setUninstallModalOpen(false);
  }, [uninstallState]);

  const handleConfirmUninstall = useCallback(async () => {
    setUninstallState("uninstalling");
    setUninstallError("");
    setUninstallReport(null);
    try {
      const report = await invoke<UninstallReport>("uninstall_reggie_files", {
        removeShellProfile: uninstallRemoveShellProfile,
      });
      setUninstallReport(report);
      setUninstallState("success");
      // Refresh install status — the user just reset Reggie.
      loadStatus();
    } catch (err) {
      setUninstallState("error");
      setUninstallError(`Failed: ${err}`);
    }
  }, [uninstallRemoveShellProfile, loadStatus]);

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

      {/* ── Danger Zone ── */}
      <div className="settings-section settings-section-danger">
        <div className="settings-section-header settings-section-header-danger">Danger Zone</div>

        <p className="settings-env-description">
          Remove all Reggie-installed files from <code>~/.claude/</code>. Your own
          agents, commands, and local overlay files will be preserved.
        </p>

        <button
          className="settings-btn danger"
          onClick={openUninstallModal}
        >
          Remove Reggie Files
        </button>
      </div>

      {uninstallModalOpen && (
        <div
          className="settings-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="uninstall-modal-title"
        >
          <div className="settings-modal">
            <h4 id="uninstall-modal-title" className="settings-modal-title">
              Remove Reggie Files?
            </h4>

            {uninstallState !== "success" && (
              <>
                <p className="settings-modal-body">
                  This will remove Reggie-installed files from <code>~/.claude/</code>
                  and clean Reggie's hook entry from <code>settings.json</code>. Your
                  own files and any local overlays are preserved.
                </p>

                <div className="settings-modal-section">
                  <div className="settings-modal-section-title">Will be removed</div>
                  <ul className="settings-modal-list">
                    <li>All <code>reggie-*</code> agents, commands, and docs (Reggie-installed files)</li>
                    <li>Reggie stats hook (<code>track-stats.sh</code>)</li>
                    <li><code>mcp-registry.yaml</code> and <code>skills-registry.yaml</code> (Reggie-managed)</li>
                    <li>Stats hook entry in <code>settings.json</code> (backed up as <code>settings.json.bak</code>)</li>
                    <li>Reggie version tracking files</li>
                  </ul>
                </div>

                <div className="settings-modal-section">
                  <div className="settings-modal-section-title">Will be preserved</div>
                  <ul className="settings-modal-list">
                    <li>Your own agents/commands (non-<code>reggie-</code>prefixed)</li>
                    <li><code>mcp-registry.local.yaml</code> and <code>skills-registry.local.yaml</code> overlays</li>
                    <li>Other entries in <code>settings.json</code></li>
                    <li>Claude Code sessions and other Claude Code data</li>
                  </ul>
                </div>

                <label className="settings-modal-checkbox">
                  <input
                    type="checkbox"
                    checked={uninstallRemoveShellProfile}
                    onChange={(e) => setUninstallRemoveShellProfile(e.target.checked)}
                    disabled={uninstallState === "uninstalling"}
                  />
                  <span>
                    Also remove <code>ENABLE_TOOL_SEARCH</code> line from shell profile
                  </span>
                </label>
              </>
            )}

            {uninstallState === "success" && uninstallReport && (
              <div className="settings-message success settings-modal-result">
                <div>
                  Removed {uninstallReport.filesRemoved.length} file
                  {uninstallReport.filesRemoved.length === 1 ? "" : "s"}.
                </div>
                {uninstallReport.settingsHookRemoved && (
                  <div>Cleaned Reggie hook from settings.json (backup saved).</div>
                )}
                {uninstallReport.versionFileRemoved && (
                  <div>Removed Reggie version tracking file.</div>
                )}
                {uninstallReport.shellProfileRemoved && (
                  <div>Removed ENABLE_TOOL_SEARCH line from shell profile.</div>
                )}
                {uninstallReport.overlaysPreserved.length > 0 && (
                  <div>
                    Preserved {uninstallReport.overlaysPreserved.length} local overlay
                    {uninstallReport.overlaysPreserved.length === 1 ? "" : "s"}.
                  </div>
                )}
              </div>
            )}

            {uninstallState === "error" && uninstallError && (
              <div className="settings-message error settings-modal-result">
                {uninstallError}
              </div>
            )}

            <div className="settings-modal-actions">
              {uninstallState === "success" ? (
                <button
                  className="settings-btn secondary"
                  onClick={closeUninstallModal}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    className="settings-btn secondary"
                    onClick={closeUninstallModal}
                    disabled={uninstallState === "uninstalling"}
                  >
                    Cancel
                  </button>
                  <button
                    className="settings-btn danger"
                    onClick={handleConfirmUninstall}
                    disabled={uninstallState === "uninstalling"}
                  >
                    {uninstallState === "uninstalling"
                      ? "Removing..."
                      : "Remove Reggie Files"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
