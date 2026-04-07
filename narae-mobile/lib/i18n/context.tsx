import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, NativeModules } from 'react-native';
import { translations, type Locale, type TranslationKey } from './translations';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const LOCALE_KEY = 'narae-locale';
const SUPPORTED_LOCALES: Locale[] = ['fr', 'en', 'es', 'de', 'it', 'pt'];

function detectDeviceLocale(): Locale {
  // 1. Intl API — most reliable in modern React Native
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      const code = intlLocale.split(/[-_]/)[0].toLowerCase() as Locale;
      if (SUPPORTED_LOCALES.includes(code)) return code;
    }
  } catch {}

  // 2. NativeModules fallback
  try {
    let deviceLocale: string | undefined;
    if (Platform.OS === 'ios') {
      deviceLocale =
        NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0];
    } else {
      deviceLocale = NativeModules.I18nManager?.localeIdentifier;
    }
    if (deviceLocale) {
      const code = deviceLocale.split(/[-_]/)[0].toLowerCase() as Locale;
      if (SUPPORTED_LOCALES.includes(code)) return code;
    }
  } catch {}

  return 'fr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectDeviceLocale);

  useEffect(() => {
    AsyncStorage.getItem(LOCALE_KEY).then((stored) => {
      if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
        setLocaleState(stored as Locale);
      }
    });
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    AsyncStorage.setItem(LOCALE_KEY, newLocale);
  }, []);

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    let text: string = translations[locale]?.[key] || translations['fr'][key] || key;

    if (params) {
      for (const [param, value] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), String(value));
      }
    }

    return text;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export function useTranslation() {
  return useI18n();
}
