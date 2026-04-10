import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Parses CSS custom properties from a selector block in globals.css.
 * Returns a map of variable name -> value.
 */
function parseThemeVars(css: string, selectorPattern: RegExp): Record<string, string> {
  const blockMatch = css.match(selectorPattern);
  if (!blockMatch) return {};

  const block = blockMatch[1];
  const vars: Record<string, string> = {};
  const propRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = propRegex.exec(block)) !== null) {
    vars[`--${match[1]}`] = match[2].trim();
  }
  return vars;
}

/**
 * Converts a hex color (#rrggbb or #rgb) to { r, g, b } (0-255).
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Calculates relative luminance per WCAG 2.1 spec.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculates WCAG contrast ratio between two hex colors.
 * Returns a value >= 1.
 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns the perceived lightness (0-100) of a hex color using the
 * WCAG relative luminance formula. Higher = lighter.
 */
function perceivedLightness(hex: string): number {
  return relativeLuminance(hex) * 100;
}

describe("Light theme CSS custom properties", () => {
  let lightVars: Record<string, string>;
  let darkVars: Record<string, string>;

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, "..", "globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");
    lightVars = parseThemeVars(cssContent, /\[data-theme="light"\]\s*\{([^}]+)\}/);
    darkVars = parseThemeVars(cssContent, /:root\s*\{([^}]+)\}/);
  });

  describe("parsing sanity checks", () => {
    it("finds the light theme block with variables", () => {
      expect(Object.keys(lightVars).length).toBeGreaterThan(0);
    });

    it("finds the dark theme block with variables", () => {
      expect(Object.keys(darkVars).length).toBeGreaterThan(0);
    });
  });

  describe("background variables have correct values", () => {
    it("--bg-primary is #fefdf2", () => {
      expect(lightVars["--bg-primary"]).toBe("#fefdf2");
    });

    it("--bg-secondary is #fafaeb", () => {
      expect(lightVars["--bg-secondary"]).toBe("#fafaeb");
    });

    it("--bg-tertiary is #f4f4e3", () => {
      expect(lightVars["--bg-tertiary"]).toBe("#f4f4e3");
    });

    it("--bg-hover is #eeeedb", () => {
      expect(lightVars["--bg-hover"]).toBe("#eeeedb");
    });

    it("--bg-selected is #e2f2d4", () => {
      expect(lightVars["--bg-selected"]).toBe("#e2f2d4");
    });

    it("--border-color is #d8d8c8", () => {
      expect(lightVars["--border-color"]).toBe("#d8d8c8");
    });
  });

  describe("visual hierarchy is maintained (lighter to darker progression)", () => {
    it("bg-primary is lighter than bg-secondary", () => {
      const primaryL = perceivedLightness(lightVars["--bg-primary"]);
      const secondaryL = perceivedLightness(lightVars["--bg-secondary"]);
      expect(primaryL).toBeGreaterThan(secondaryL);
    });

    it("bg-secondary is lighter than bg-tertiary", () => {
      const secondaryL = perceivedLightness(lightVars["--bg-secondary"]);
      const tertiaryL = perceivedLightness(lightVars["--bg-tertiary"]);
      expect(secondaryL).toBeGreaterThan(tertiaryL);
    });

    it("bg-tertiary is lighter than bg-hover", () => {
      const tertiaryL = perceivedLightness(lightVars["--bg-tertiary"]);
      const hoverL = perceivedLightness(lightVars["--bg-hover"]);
      expect(tertiaryL).toBeGreaterThan(hoverL);
    });

    it("border-color is darker than all background colors", () => {
      const borderL = perceivedLightness(lightVars["--border-color"]);
      const bgVarNames = [
        "--bg-primary",
        "--bg-secondary",
        "--bg-tertiary",
        "--bg-hover",
      ];
      for (const varName of bgVarNames) {
        const bgL = perceivedLightness(lightVars[varName]);
        expect(borderL).toBeLessThan(bgL);
      }
    });
  });

  describe("WCAG AA text contrast ratios against new backgrounds", () => {
    const WCAG_AA_NORMAL = 4.5;

    const backgroundVars = [
      "--bg-primary",
      "--bg-secondary",
      "--bg-tertiary",
      "--bg-hover",
      "--bg-selected",
    ];

    const textVars = ["--text-primary", "--text-secondary", "--text-muted"];

    for (const textVar of textVars) {
      for (const bgVar of backgroundVars) {
        it(`${textVar} against ${bgVar} meets AA (>= 4.5:1)`, () => {
          const ratio = contrastRatio(lightVars[textVar], lightVars[bgVar]);
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
        });
      }
    }
  });

  describe("green accent is unchanged", () => {
    it("--accent-orange (green in light mode) is #05c250", () => {
      expect(lightVars["--accent-orange"]).toBe("#05c250");
    });

    it("--accent-orange-dim is #049e42", () => {
      expect(lightVars["--accent-orange-dim"]).toBe("#049e42");
    });

    it("--border-active is #05c250", () => {
      expect(lightVars["--border-active"]).toBe("#05c250");
    });
  });

  describe("light theme is genuinely light (backgrounds have high luminance)", () => {
    const bgVarNames = [
      "--bg-primary",
      "--bg-secondary",
      "--bg-tertiary",
      "--bg-hover",
      "--bg-selected",
    ];

    for (const varName of bgVarNames) {
      it(`${varName} has luminance above 80%`, () => {
        const lightness = perceivedLightness(lightVars[varName]);
        expect(lightness).toBeGreaterThan(80);
      });
    }
  });

  describe("dark theme is not affected", () => {
    it("dark --bg-primary remains #0D0D0D", () => {
      expect(darkVars["--bg-primary"].toLowerCase()).toBe("#0d0d0d");
    });

    it("dark --bg-secondary remains #141414", () => {
      expect(darkVars["--bg-secondary"]).toBe("#141414");
    });

    it("dark --border-color remains #2A2A2A", () => {
      expect(darkVars["--border-color"].toLowerCase()).toBe("#2a2a2a");
    });

    it("dark accent-orange remains #FF6B00", () => {
      expect(darkVars["--accent-orange"].toLowerCase()).toBe("#ff6b00");
    });
  });

  describe("light theme overrides are a subset of dark theme variables", () => {
    it("every variable in light theme exists in dark theme", () => {
      const lightKeys = Object.keys(lightVars);
      const darkKeys = Object.keys(darkVars);
      for (const key of lightKeys) {
        expect(darkKeys).toContain(key);
      }
    });
  });
});
