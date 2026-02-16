import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, StaleWhileRevalidate, CacheFirst, NetworkFirst } from "serwist";
import { CacheableResponsePlugin } from "serwist";
import { ExpirationPlugin } from "serwist";

// This declares that all self.* properties belong to the service worker.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Cesium assets - network-first to prevent stale workers/widgets
    {
      matcher: /\/cesium\/.*/i,
      handler: new NetworkFirst({
        cacheName: "cesium-assets",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 24 * 60 * 60, // 1 day
          }),
        ],
      }),
    },
    // Keep key app pages available for offline read-only navigation.
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        (url.pathname === "/mes-voyages" ||
          url.pathname.startsWith("/trip/") ||
          url.pathname.startsWith("/profil")),
      handler: new NetworkFirst({
        cacheName: "app-pages-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 60,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          }),
          new CacheableResponsePlugin({
            statuses: [0, 200],
          }),
        ],
      }),
    },
    ...defaultCache,
    // Cache trip API responses with stale-while-revalidate
    {
      matcher: /^https?:\/\/[^/]+\/api\/trips\/.*/i,
      handler: new StaleWhileRevalidate({
        cacheName: "trip-api-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          }),
          new CacheableResponsePlugin({
            statuses: [0, 200],
          }),
        ],
      }),
    },
    // Cache images with cache-first strategy and 30-day expiry
    {
      matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: new CacheFirst({
        cacheName: "images-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          }),
        ],
      }),
    },
    // Cache external images (Unsplash, avatars)
    {
      matcher: /^https?:\/\/(images\.unsplash\.com|i\.pravatar\.cc)\/.*/i,
      handler: new CacheFirst({
        cacheName: "external-images-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          }),
          new CacheableResponsePlugin({
            statuses: [0, 200],
          }),
        ],
      }),
    },
    // Cache Google Fonts CSS with stale-while-revalidate
    {
      matcher: /^https?:\/\/fonts\.googleapis\.com\/.*/i,
      handler: new StaleWhileRevalidate({
        cacheName: "google-fonts-stylesheets",
      }),
    },
    // Cache Google Fonts files with cache-first strategy
    {
      matcher: /^https?:\/\/fonts\.gstatic\.com\/.*/i,
      handler: new CacheFirst({
        cacheName: "google-fonts-webfonts",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 30,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
          }),
          new CacheableResponsePlugin({
            statuses: [0, 200],
          }),
        ],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
