import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'TravelSphere - Explore le monde',
  description: 'Découvre des itinéraires de voyage et partage tes aventures avec la communauté',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TravelSphere',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0f',
};

export default function V2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* PWA meta tags */}
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="TravelSphere" />
      {/* Cesium CSS */}
      <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      {children}
    </>
  );
}
