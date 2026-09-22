import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: "web-dom",
          include: ["ui/**/*.dom.test.js"],
          environment: "jsdom",
          testTimeout: 10000,
          hookTimeout: 10000,
        },
      },
    ],
  },
});
