import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
      },
      formats: ["es"],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    outDir: "dist/es",
  },
  test: {
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: ["src"],
    },
    browser: {
      enabled: true,
      instances: [
        {
          browser: "chromium",
        },
        {
          browser: "firefox",
        },
        {
          browser: "webkit",
        },
      ],
      provider: "playwright",
      headless: true,
    },
    // Ensure test files are included
    include: ["tests/**/*.test.ts"],
  },
});
