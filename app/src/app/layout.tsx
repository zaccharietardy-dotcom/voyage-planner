import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth";
import { Header } from "@/components/layout";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Narae Voyage - Planifie et partage tes voyages",
  description: "Planifie et partage tes voyages avec tes amis. L'IA génère ton itinéraire personnalisé en 2 minutes.",
  keywords: ["voyage", "planification", "itinéraire", "IA", "collaboration", "gratuit"],
  authors: [{ name: "Narae Voyage" }],
  manifest: '/manifest.json',
  openGraph: {
    title: "Narae Voyage - Planifie et partage tes voyages",
    description: "L'IA génère ton itinéraire personnalisé en 2 minutes. Gratuit et collaboratif.",
    type: "website",
    locale: "fr_FR",
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Narae',
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
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
