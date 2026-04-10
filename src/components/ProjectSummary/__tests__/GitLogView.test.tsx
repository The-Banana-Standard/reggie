import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { GitLogView } from "../GitLogView";

// Sample git log lines for mocking
const sampleLines = [
  "* abc1234 (HEAD -> main, origin/main) Initial commit",
  "* def5678 Add feature",
  "* 1a2b3c4 (tag: v1.0) Release v1.0",
  "* 5e6f7a8 Fix bug",
  "* 9b0c1d2 Update README",
  "* 3e4f5a6 Refactor utils",
  "* 7f8a9b0 Add tests",
  "* c1d2e3f Improve performance",
  "* 4a5b6c7 Fix typo",
  "* 8d9e0f1 Add logging",
  "* 2b3c4d5 Cleanup code",
  "* 6e7f8a9 Add CI pipeline",
  "* 0c1d2e3 Update dependencies",
  "* a4b5c6d Initial scaffold",
  "* e8f9a0b Configure build system",
];

const defaultProps = {
  projectPath: "/test/project",
  isGitRepo: true,
};

describe("GitLogView", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
  });

  it("returns null when isGitRepo is false", () => {
    const { container } = render(
      <GitLogView projectPath="/test/project" isGitRepo={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null while loading", () => {
    // Never-resolving promise keeps the component in loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const { container } = render(<GitLogView {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows git log lines after loading", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeTruthy();
    });
    expect(screen.getByText("Add feature")).toBeTruthy();
  });

  it("shows only 10 lines when collapsed", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeTruthy();
    });

    const logLines = container.querySelectorAll(".git-log-line");
    expect(logLines.length).toBe(10);

    // The 11th line should not be visible
    expect(screen.queryByText("Cleanup code")).toBeNull();
  });

  it("shows all lines when expanded", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Show more/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Show more/));

    const logLines = container.querySelectorAll(".git-log-line");
    expect(logLines.length).toBe(sampleLines.length);

    // The 11th line should now be visible
    expect(screen.getByText("Cleanup code")).toBeTruthy();
    // Last line should be visible too
    expect(screen.getByText("Configure build system")).toBeTruthy();
  });

  it("toggle button text changes from Show more to Show less", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Show more/)).toBeTruthy();
    });

    // Should show the count of remaining lines
    const moreCount = sampleLines.length - 10;
    expect(screen.getByText(`Show more (${moreCount} more)`)).toBeTruthy();

    fireEvent.click(screen.getByText(/Show more/));

    expect(screen.getByText("Show less")).toBeTruthy();
    expect(screen.queryByText(/Show more/)).toBeNull();
  });

  it("clicking Show less collapses back to 10 lines", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Show more/)).toBeTruthy();
    });

    // Expand
    fireEvent.click(screen.getByText(/Show more/));
    expect(container.querySelectorAll(".git-log-line").length).toBe(sampleLines.length);

    // Collapse
    fireEvent.click(screen.getByText("Show less"));
    expect(container.querySelectorAll(".git-log-line").length).toBe(10);
    expect(screen.getByText(/Show more/)).toBeTruthy();
  });

  it("does not render toggle button when lines are 10 or fewer", async () => {
    const fewLines = sampleLines.slice(0, 8);
    mockInvoke.mockResolvedValue(fewLines);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeTruthy();
    });

    expect(screen.queryByText(/Show more/)).toBeNull();
    expect(screen.queryByText(/Show less/)).toBeNull();
  });

  it("does not render toggle button when lines are exactly 10", async () => {
    const exactlyTen = sampleLines.slice(0, 10);
    mockInvoke.mockResolvedValue(exactlyTen);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeTruthy();
    });

    expect(screen.queryByText(/Show more/)).toBeNull();
  });

  it("colorizes HEAD ref with git-ref-head class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD -> main) Some commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Some commit")).toBeTruthy();
    });

    const headSpan = container.querySelector(".git-ref-head");
    expect(headSpan).toBeTruthy();
    expect(headSpan!.textContent).toBe("HEAD");
  });

  it("colorizes branch ref with git-ref-branch class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD -> main) Some commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Some commit")).toBeTruthy();
    });

    const branchSpan = container.querySelector(".git-ref-branch");
    expect(branchSpan).toBeTruthy();
    expect(branchSpan!.textContent).toBe("main");
  });

  it("colorizes remote ref with git-ref-remote class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD -> main, origin/main) Some commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Some commit")).toBeTruthy();
    });

    const remoteSpan = container.querySelector(".git-ref-remote");
    expect(remoteSpan).toBeTruthy();
    expect(remoteSpan!.textContent).toBe("origin/main");
  });

  it("colorizes tag ref with git-ref-tag class", async () => {
    mockInvoke.mockResolvedValue([
      "* 1a2b3c4 (tag: v1.0) Release v1.0",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Release v1.0")).toBeTruthy();
    });

    const tagSpan = container.querySelector(".git-ref-tag");
    expect(tagSpan).toBeTruthy();
    expect(tagSpan!.textContent).toBe("tag: v1.0");
  });

  it("colorizes commit hash with git-hash class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 Some commit message",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Some commit message")).toBeTruthy();
    });

    const hashSpan = container.querySelector(".git-hash");
    expect(hashSpan).toBeTruthy();
    expect(hashSpan!.textContent).toBe("abc1234");
  });

  it("shows empty state for no commits", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No git history found.")).toBeTruthy();
    });
  });

  it("handles invoke error gracefully and shows empty state", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("git not found"));
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No git history found.")).toBeTruthy();
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to load git log:", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("calls invoke with get_git_log command and correct args on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_git_log", {
        projectPath: "/test/project",
        limit: 50,
      });
    });
  });

  it("reloads when projectPath changes", async () => {
    mockInvoke.mockResolvedValue(["* abc1234 First project commit"]);
    const { rerender } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("First project commit")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue(["* def5678 Second project commit"]);

    rerender(<GitLogView projectPath="/other/project" isGitRepo={true} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_git_log", {
        projectPath: "/other/project",
        limit: 50,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Second project commit")).toBeTruthy();
    });
  });

  it("resets expanded state when projectPath changes", async () => {
    mockInvoke.mockResolvedValue(sampleLines);
    const { container, rerender } = render(<GitLogView {...defaultProps} />);

    // Wait for lines and expand
    await waitFor(() => {
      expect(screen.getByText(/Show more/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Show more/));
    expect(container.querySelectorAll(".git-log-line").length).toBe(sampleLines.length);

    // Change project path
    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue(sampleLines);
    rerender(<GitLogView projectPath="/other/project" isGitRepo={true} />);

    // After reload, should be collapsed again
    await waitFor(() => {
      expect(container.querySelectorAll(".git-log-line").length).toBe(10);
    });
  });

  it("does not invoke get_git_log when isGitRepo is false", () => {
    render(<GitLogView projectPath="/test/project" isGitRepo={false} />);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("renders graph characters with git-graph-char class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 A commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("A commit")).toBeTruthy();
    });

    const graphSpan = container.querySelector(".git-graph-char");
    expect(graphSpan).toBeTruthy();
    expect(graphSpan!.textContent).toBe("* ");
  });

  it("renders decoration block with git-ref-decoration class", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD -> main) A commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("A commit")).toBeTruthy();
    });

    const decoSpan = container.querySelector(".git-ref-decoration");
    expect(decoSpan).toBeTruthy();
  });

  it("handles null result from invoke gracefully", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No git history found.")).toBeTruthy();
    });
  });

  it("parses multiple refs in a single decoration", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD -> main, origin/main, tag: v2.0) Multi-ref commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Multi-ref commit")).toBeTruthy();
    });

    expect(container.querySelector(".git-ref-head")).toBeTruthy();
    expect(container.querySelector(".git-ref-branch")).toBeTruthy();
    expect(container.querySelector(".git-ref-remote")).toBeTruthy();
    expect(container.querySelector(".git-ref-tag")).toBeTruthy();
  });

  it("handles line with no decoration and no hash", async () => {
    // A line that doesn't match the hash pattern (no 7+ hex chars after graph)
    mockInvoke.mockResolvedValue([
      "| Some merge text",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      const logLines = container.querySelectorAll(".git-log-line");
      expect(logLines.length).toBe(1);
    });

    // Should not have a hash span since there's no hash
    expect(container.querySelector(".git-hash")).toBeNull();
  });

  it("colorizes detached HEAD (standalone HEAD without branch arrow)", async () => {
    mockInvoke.mockResolvedValue([
      "* abc1234 (HEAD) Detached commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Detached commit")).toBeTruthy();
    });

    const headSpan = container.querySelector(".git-ref-head");
    expect(headSpan).toBeTruthy();
    expect(headSpan!.textContent).toBe("HEAD");

    // Should not have a branch span since HEAD is standalone
    expect(container.querySelector(".git-ref-branch")).toBeNull();
  });

  it("colorizes standalone branch ref without slash as branch", async () => {
    // A decoration with just a branch name (no HEAD, no remote, no tag)
    mockInvoke.mockResolvedValue([
      "* abc1234 (feature-branch) Branch-only commit",
    ]);
    const { container } = render(<GitLogView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Branch-only commit")).toBeTruthy();
    });

    const branchSpan = container.querySelector(".git-ref-branch");
    expect(branchSpan).toBeTruthy();
    expect(branchSpan!.textContent).toBe("feature-branch");
  });
});
