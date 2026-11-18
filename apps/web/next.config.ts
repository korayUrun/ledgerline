import type { NextConfig } from "next";

// Next reads .env files from apps/web only; the project keeps one .env at the
// repo root. Loaded here because this file runs first, in the server process.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

const nextConfig: NextConfig = {
  // @ledgerline/schemas ships TypeScript source, not built JavaScript, so Next
  // must compile it like the app's own files.
  transpilePackages: ["@ledgerline/schemas"],
  experimental: {
    // The shared packages import "./money.js" while the file on disk is money.ts:
    // that is how Node's ESM resolution (and tsc with NodeNext) expects TypeScript
    // imports to be written. Webpack needs to be told to try .ts for a .js import.
    // Turbopack has no such option yet, which is why the scripts pass --webpack.
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
  // Next 16 writes an AGENTS.md into the app on `next dev`; we keep our own docs.
  agentRules: false,
};

export default nextConfig;
