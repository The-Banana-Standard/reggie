import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Extracts the content of a CSS rule block matching a given selector.
 * Returns the text inside the outermost braces.
 */
function extractRuleBlock(css: string, selectorPattern: RegExp): string | null {
  const idx = css.search(selectorPattern);
  if (idx === -1) return null;

  const afterSelector = css.indexOf("{", idx);
  if (afterSelector === -1) return null;

  let depth = 0;
  let start = afterSelector;
  for (let i = afterSelector; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    if (depth === 0) {
      return css.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Parses CSS property declarations from a rule block string.
 * Returns a map of property name -> value (trimmed, without trailing semicolons).
 */
function parseDeclarations(block: string): Record<string, string> {
  const decls: Record<string, string> = {};
  // Match standard property declarations (handles var() and multi-value shorthand)
  const regex = /([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block)) !== null) {
    decls[match[1].trim()] = match[2].trim();
  }
  return decls;
}

/**
 * Parses CSS custom properties from a selector block.
 */
function parseThemeVars(css: string, selectorPattern: RegExp): Record<string, string> {
  const block = extractRuleBlock(css, selectorPattern);
  if (!block) return {};

  const vars: Record<string, string> = {};
  const propRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = propRegex.exec(block)) !== null) {
    vars[`--${match[1]}`] = match[2].trim();
  }
  return vars;
}

describe("Activity panel CSS", () => {
  let css: string;
  let panelDecls: Record<string, string>;
  let widePanelDecls: Record<string, string>;
  let darkVars: Record<string, string>;
  let lightVars: Record<string, string>;

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, "..", "globals.css");
    css = fs.readFileSync(cssPath, "utf-8");

    const panelBlock = extractRuleBlock(css, /\.activity-panel\s*\{/);
    panelDecls = panelBlock ? parseDeclarations(panelBlock) : {};

    const wideBlock = extractRuleBlock(css, /\.activity-panel\.wide\s*\{/);
    widePanelDecls = wideBlock ? parseDeclarations(wideBlock) : {};

    darkVars = parseThemeVars(css, /:root\s*\{/);
    lightVars = parseThemeVars(css, /\[data-theme="light"\]\s*\{/);
  });

  describe("parsing sanity checks", () => {
    it("finds the .activity-panel rule block", () => {
      expect(Object.keys(panelDecls).length).toBeGreaterThan(0);
    });

    it("finds the .activity-panel.wide rule block", () => {
      expect(Object.keys(widePanelDecls).length).toBeGreaterThan(0);
    });
  });

  describe("width values", () => {
    it("base panel width is 320px", () => {
      expect(panelDecls["width"]).toBe("320px");
    });

    it("wide panel width is 480px", () => {
      expect(widePanelDecls["width"]).toBe("480px");
    });
  });

  it("border-left uses 2px solid with accent-border-medium variable", () => {
    expect(panelDecls["border-left"]).toBe("2px solid var(--accent-border-medium)");
  });

  describe("shadow values", () => {
    it("dark theme --shadow-panel is -6px 0 20px rgba(0, 0, 0, 0.4)", () => {
      expect(darkVars["--shadow-panel"]).toBe("-6px 0 20px rgba(0, 0, 0, 0.4)");
    });

    it("light theme --shadow-panel is -6px 0 20px rgba(0, 0, 0, 0.12)", () => {
      expect(lightVars["--shadow-panel"]).toBe("-6px 0 20px rgba(0, 0, 0, 0.12)");
    });
  });

  describe("overlay behavior preserved", () => {
    it("has position absolute for overlay effect", () => {
      expect(panelDecls["position"]).toBe("absolute");
    });

    it("has z-index 20 to sit above main content", () => {
      expect(panelDecls["z-index"]).toBe("20");
    });

    it("uses box-shadow via --shadow-panel variable", () => {
      expect(panelDecls["box-shadow"]).toBe("var(--shadow-panel)");
    });
  });

  it("has width transition of 0.2s ease", () => {
    expect(panelDecls["transition"]).toBe("width 0.2s ease");
  });

  describe("layout anchoring", () => {
    it("is anchored to the top of the viewport", () => {
      expect(panelDecls["top"]).toBe("0");
    });

    it("is anchored to the bottom of the viewport", () => {
      expect(panelDecls["bottom"]).toBe("0");
    });

    it("is positioned 40px from the right (next to activity-bar)", () => {
      expect(panelDecls["right"]).toBe("40px");
    });
  });
});
