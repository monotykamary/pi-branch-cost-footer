import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      // index.ts imports truncateToWidth / visibleWidth by value; the other
      // @earendil-works/* imports are type-only and erased by esbuild, so
      // only pi-tui needs a stub here.
      "@earendil-works/pi-tui": path.resolve(__dirname, "tests/__mocks__/pi-tui.ts"),
    },
  },
});
