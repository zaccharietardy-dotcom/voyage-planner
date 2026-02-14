import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth";
import { Header } from "@/components/layout";
import { Toaster } from "sonner";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, OG_IMAGE_DEFAULT, LOCALE } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

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
    "IA",
    "collaboration",
    "gratuit",
    "planificateur de voyage",
    "intelligence artificielle",
  ],
  authors: [{ name: SITE_NAME }],
  manifest: "/manifest.json",
  openGraph: {
    title: `${SITE_NAME} — Planifie et partage tes voyages`,
    description:
      "L'IA génère ton itinéraire personnalisé en 2 minutes. Gratuit et collaboratif.",
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: OG_IMAGE_DEFAULT,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — Planificateur de voyage IA`,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('voyage-theme');var d=document.documentElement;if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){d.classList.add('dark')}else{d.classList.add('light')}}catch(e){}})()`,
          }}
        />
        <Script
          src="https://emrldtp.com/NDk0NDIw.js?t=494420"
          strategy="afterInteractive"
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE_NAME,
            url: SITE_URL,
            logo: `${SITE_URL}/logo-narae.png`,
            description: SITE_DESCRIPTION,
            sameAs: [],
          }}
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: SITE_URL,
            inLanguage: "fr",
            description: SITE_DESCRIPTION,
            potentialAction: {
              "@type": "SearchAction",
              target: `${SITE_URL}/explore?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} antialiased`}
      >
        <ThemeProvider defaultTheme="system" storageKey="voyage-theme">
          <AuthProvider>
            <Header />
            <main className="pt-16">
              {children}
            </main>
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
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
