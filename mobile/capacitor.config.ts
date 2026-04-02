import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.naraevoyage.app',
  appName: 'Narae Voyage',
  server: {
    url: 'https://naraevoyage.com',
    cleartext: false,
  },
  ios: {
    scheme: 'com.naraevoyage.app',
    contentInset: 'automatic',
  },
  android: {
    backgroundColor: '#020617',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#020617',
      showSpinner: false,
      launchFadeOutDuration: 500,
    },
    StatusBar: {
      style: 'light',
      backgroundColor: '#020617',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
