import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TitleBar } from "../TitleBar";
import type { SessionSummary } from "../../../hooks/useSessionTracking";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
  }),
}));

const defaultProps = {
  onGoHome: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TitleBar", () => {
  it("renders the Forge title text", () => {
    render(<TitleBar {...defaultProps} />);
    expect(screen.getByText("Forge")).toBeTruthy();
  });

  it("does not render status badge when no summary is provided", () => {
    render(<TitleBar {...defaultProps} />);
    expect(screen.queryByText("running")).toBeNull();
    expect(screen.queryByText("done")).toBeNull();
    expect(screen.queryByText("attention")).toBeNull();
    expect(screen.queryByText("groomed")).toBeNull();
  });

  it("does not render status badge when all counts are zero", () => {
    const summary: SessionSummary = {
      totalRunning: 0,
      totalNeedsAttention: 0,
      totalDone: 0,
      totalGroomed: 0,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.queryByText("running")).toBeNull();
    expect(screen.queryByText("done")).toBeNull();
    expect(screen.queryByText("attention")).toBeNull();
    expect(screen.queryByText("groomed")).toBeNull();
  });

  it("shows running count when totalRunning > 0", () => {
    const summary: SessionSummary = {
      totalRunning: 3,
      totalNeedsAttention: 0,
      totalDone: 0,
      totalGroomed: 0,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.getByText("3 running")).toBeTruthy();
  });

  it("shows attention count when totalNeedsAttention > 0", () => {
    const summary: SessionSummary = {
      totalRunning: 0,
      totalNeedsAttention: 2,
      totalDone: 0,
      totalGroomed: 0,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.getByText("2 attention")).toBeTruthy();
  });

  it("shows done count when totalDone > 0", () => {
    const summary: SessionSummary = {
      totalRunning: 0,
      totalNeedsAttention: 0,
      totalDone: 5,
      totalGroomed: 0,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.getByText("5 done")).toBeTruthy();
  });

  it("shows groomed count when totalGroomed > 0 and activity exists", () => {
    const summary: SessionSummary = {
      totalRunning: 1,
      totalNeedsAttention: 0,
      totalDone: 0,
      totalGroomed: 8,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.getByText("8 groomed")).toBeTruthy();
  });

  it("shows multiple status items when multiple counts are nonzero", () => {
    const summary: SessionSummary = {
      totalRunning: 2,
      totalNeedsAttention: 1,
      totalDone: 3,
      totalGroomed: 7,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    expect(screen.getByText("2 running")).toBeTruthy();
    expect(screen.getByText("1 attention")).toBeTruthy();
    expect(screen.getByText("3 done")).toBeTruthy();
    expect(screen.getByText("7 groomed")).toBeTruthy();
  });

  it("hides badge when only totalGroomed is nonzero but running/attention/done are all zero", () => {
    // hasActivity checks running, attention, done -- not groomed alone
    const summary: SessionSummary = {
      totalRunning: 0,
      totalNeedsAttention: 0,
      totalDone: 0,
      totalGroomed: 5,
    };
    render(<TitleBar {...defaultProps} summary={summary} />);
    // groomed only renders inside the hasActivity wrapper, so it should not appear
    expect(screen.queryByText("5 groomed")).toBeNull();
  });
});
