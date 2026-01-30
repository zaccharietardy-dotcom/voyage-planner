import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.naraevoyage.app',
  appName: 'Narae Voyage',
  server: {
    url: 'https://naraevoyage.com',
    cleartext: false,
  },
  ios: {
    scheme: 'Narae Voyage',
    contentInset: 'automatic',
  },
  android: {
    backgroundColor: '#0a1628',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a1628',
      showSpinner: false,
      launchFadeOutDuration: 500,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a1628',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
