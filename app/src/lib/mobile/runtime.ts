export type NativePlatform = 'ios' | 'android' | 'web';

type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  platform?: string;
  isNative?: boolean;
};

type NativeWindow = Window & {
  Capacitor?: CapacitorRuntime;
  webkit?: {
    messageHandlers?: {
      bridge?: unknown;
      capacitor?: unknown;
    };
  };
  androidBridge?: unknown;
  CapacitorAndroid?: unknown;
};

function getNativeWindow(): NativeWindow | null {
  if (typeof window === 'undefined') return null;
  return window as NativeWindow;
}

function getCapacitorRuntime(): CapacitorRuntime | null {
  return getNativeWindow()?.Capacitor || null;
}

function detectPlatformFromUserAgent(): NativePlatform {
  if (typeof navigator === 'undefined') return 'web';

  const userAgent = navigator.userAgent || '';
  if (!/capacitor/i.test(userAgent)) return 'web';

  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  return 'web';
}

function hasBridgeArtifacts(nativeWindow: NativeWindow): boolean {
  return Boolean(
    nativeWindow.webkit?.messageHandlers?.bridge ||
      nativeWindow.webkit?.messageHandlers?.capacitor ||
      nativeWindow.androidBridge ||
      nativeWindow.CapacitorAndroid
  );
}

export function isNativeApp(): boolean {
  const nativeWindow = getNativeWindow();
  if (!nativeWindow) return false;

  const runtime = getCapacitorRuntime();

  try {
    if (runtime && typeof runtime.isNativePlatform === 'function') {
      return Boolean(runtime.isNativePlatform());
    }

    if (runtime && typeof runtime.getPlatform === 'function') {
      const platform = runtime.getPlatform();
      return platform === 'ios' || platform === 'android';
    }

    if (runtime?.platform) {
      return runtime.platform === 'ios' || runtime.platform === 'android';
    }

    if (runtime?.isNative) {
      return true;
    }

    if (hasBridgeArtifacts(nativeWindow)) {
      return true;
    }

    return detectPlatformFromUserAgent() !== 'web';
  } catch {
    return false;
  }
}

export function getPlatform(): NativePlatform {
  if (!isNativeApp()) return 'web';

  const runtime = getCapacitorRuntime();

  try {
    const platform = runtime?.getPlatform?.() || runtime?.platform;
    if (platform === 'ios' || platform === 'android') {
      return platform;
    }
    return detectPlatformFromUserAgent();
  } catch {
    return detectPlatformFromUserAgent();
  }
}

export function isOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return !navigator.onLine;
}
