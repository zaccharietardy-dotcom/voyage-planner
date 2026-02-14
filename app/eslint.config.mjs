import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Cesium assets
    "public/cesium/**",
    // Generated reports
    "coverage/**",
    // Debug scripts (non-runtime production code)
    "scripts/**",
    "test-pipeline.ts",
    "jest.setup.js",
  ]),
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: [
      "src/hooks/useRealtimeTrip.ts",
      "src/app/api/trips/[id]/proposals/route.ts",
      "src/app/api/proposals/[id]/vote/route.ts",
      "src/app/api/trips/[id]/route.ts",
      "src/components/trip/SharePanel.tsx",
      "src/app/trip/[id]/page.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
    },
  },
]);

export default eslintConfig;
