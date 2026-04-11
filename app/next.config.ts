import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

const workspaceRoot = path.resolve(__dirname, "..");
const enableExternalMarketingScript =
  process.env.NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT === "true"
  || process.env.NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT === "1";

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn", "info"] }
      : false,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "staticcdn.viator.com" },
      { protocol: "https", hostname: "hq.viator.com" },
      { protocol: "https", hostname: "media.viator.com" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "cf.bstatic.com" },
      { protocol: "https", hostname: "serpapi.com" },
    ],
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://*.vercel-scripts.com${enableExternalMarketingScript ? ' https://emrldtp.com' : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://images.unsplash.com https://i.pravatar.cc https://*.googleapis.com https://*.gstatic.com https://*.basemaps.cartocdn.com https://*.sentry.io",
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co https://*.googleapis.com https://*.sentry.io https://serpapi.com https://*.basemaps.cartocdn.com https://nominatim.openstreetmap.org https://overpass-api.de https://*.stripe.com https://vitals.vercel-insights.com https://va.vercel-scripts.com${enableExternalMarketingScript ? ' https://emrldtp.com' : ''}`,
      "frame-src 'self' https://*.stripe.com",
      "worker-src 'self' blob:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://appleid.apple.com",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=()',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: csp,
          },
        ],
      },
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
    ];
  },
  // Note: Serwist requires webpack for production builds.
  // Use `next dev --webpack` for local dev if needed (see package.json scripts).
};

export default withSentryConfig(withSerwist(withBundleAnalyzer(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
