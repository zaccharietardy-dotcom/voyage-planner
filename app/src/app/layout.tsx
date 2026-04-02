import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth";
import { Header, BottomNav } from "@/components/layout";
import { Toaster } from "sonner";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, OG_IMAGE_DEFAULT, LOCALE } from "@/lib/seo";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { I18nProvider } from "@/lib/i18n";
import { PageTransition } from "@/components/layout/PageTransition";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import {
  getPublicEnv,
  isExternalMarketingScriptEnabled,
  isFeedbackWidgetEnabled,
} from "@/lib/runtime-config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Planifie et partage tes voyages`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "voyage",
    "planification",
    "itinéraire",
    "Narae",
    "collaboration",
    "gratuit",
    "planificateur de voyage",
    "expertise",
  ],
  authors: [{ name: SITE_NAME }],
  manifest: "/manifest.json",
  openGraph: {
    title: `${SITE_NAME} — Planifie et partage tes voyages`,
    description:
      "Notre algorithme génère votre itinéraire personnalisé en 2 minutes. Gratuit et collaboratif.",
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: OG_IMAGE_DEFAULT,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — Planificateur de voyage expert`,
      },
    ],
    locale: LOCALE,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Planifie et partage tes voyages`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_DEFAULT],
  },
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon-32x32.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Narae",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1628" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publicEnv = getPublicEnv();
  const enableExternalMarketingScript = isExternalMarketingScriptEnabled();
  const enableFeedbackWidget = isFeedbackWidgetEnabled();

  return (
    <html lang="fr" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('voyage-theme');var d=document.documentElement;if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){d.classList.add('dark')}else{d.classList.add('light')}}catch(e){}})()`,
          }}
        />
        <Script
          id="sw-register"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

                var cacheVersion = 'native-cache-v4';
                var capacitor = window.Capacitor;
                var nativeFromRuntime = false;
                var nativeFromUA = /capacitor/i.test(navigator.userAgent || '');

                try {
                  nativeFromRuntime = Boolean(
                    capacitor &&
                    (typeof capacitor.isNativePlatform === 'function'
                      ? capacitor.isNativePlatform()
                      : capacitor.platform === 'ios' || capacitor.platform === 'android')
                  );
                } catch (e) {
                  nativeFromRuntime = false;
                }

                var isNative = nativeFromRuntime || nativeFromUA;
                if (!('serviceWorker' in navigator)) return;

                function clearNativeCaches() {
                  try {
                    if (!window.caches || typeof window.caches.keys !== 'function') return Promise.resolve();

                    return window.caches.keys().then(function(keys) {
                      return Promise.all(keys.map(function(key) { return window.caches.delete(key); }));
                    });
                  } catch (e) {
                    return Promise.resolve();
                  }
                }

                function unregisterWorkers() {
                  return navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    return Promise.all(registrations.map(function(registration) { return registration.unregister(); }));
                  });
                }

                window.addEventListener('load', function() {
                  if (isNative) {
                    var appliedVersion = null;
                    try {
                      appliedVersion = window.localStorage.getItem('narae-native-cache-version');
                    } catch (e) {
                      appliedVersion = null;
                    }

                    if (appliedVersion !== cacheVersion) {
                      unregisterWorkers()
                        .catch(function() {})
                        .then(clearNativeCaches)
                        .finally(function() {
                          try {
                            window.localStorage.setItem('narae-native-cache-version', cacheVersion);
                          } catch (e) {}

                          window.location.reload();
                        });
                    } else {
                      unregisterWorkers().catch(function() {});
                    }

                    return;
                  }

                  navigator.serviceWorker.register('/sw.js?v=2026-02-16-3', { scope: '/' })
                    .then(function(registration) {
                      console.log('SW registered:', registration.scope);
                    })
                    .catch(function(error) {
                      console.error('SW registration failed:', error);
                    });
                });
              })();
            `,
          }}
        />
        {enableExternalMarketingScript && (
          <Script
            src="https://emrldtp.com/NDk0NDIw.js?t=494420"
            strategy="afterInteractive"
          />
        )}
        <JsonLd
          id="jsonld-organization"
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE_NAME,
            url: publicEnv.NEXT_PUBLIC_SITE_URL,
            logo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/logo-narae.png`,
            description: SITE_DESCRIPTION,
            sameAs: [],
          }}
        />
        <JsonLd
          id="jsonld-website"
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: publicEnv.NEXT_PUBLIC_SITE_URL,
            inLanguage: "fr",
            description: SITE_DESCRIPTION,
            potentialAction: {
              "@type": "SearchAction",
              target: `${publicEnv.NEXT_PUBLIC_SITE_URL}/explore?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider defaultTheme="system" storageKey="voyage-theme">
          <I18nProvider>
            <AuthProvider>
              <AnalyticsProvider>
                <Header />
                <main className="pt-16 pb-24 md:pb-0">
                  <PageTransition>{children}</PageTransition>
                </main>
                <BottomNav />
                <Toaster
                  position="bottom-right"
                  toastOptions={{
                    classNames: {
                      toast: 'bg-background border-border',
                      title: 'text-foreground',
                      description: 'text-muted-foreground',
                    },
                  }}
                />
              </AnalyticsProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        <CookieConsentBanner />
        {enableFeedbackWidget && <FeedbackWidget />}
      </body>
    </html>
  );
}
