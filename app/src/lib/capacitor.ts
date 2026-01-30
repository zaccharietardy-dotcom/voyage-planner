/**
 * Capacitor native bridge utilities.
 * All functions are no-ops when running in a regular browser.
 */

let _isNative: boolean | null = null;

export function isNativePlatform(): boolean {
  if (_isNative !== null) return _isNative;
  try {
    // Capacitor injects this on native platforms
    _isNative = !!(window as any).Capacitor?.isNativePlatform();
  } catch {
    _isNative = false;
  }
  return _isNative;
}

export async function nativeShare(data: { title: string; text: string; url: string }) {
  if (!isNativePlatform()) return;
  const { Share } = await import('@capacitor/share');
  await Share.share(data);
}

export async function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'medium') {
  if (!isNativePlatform()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
  await Haptics.impact({ style: map[style] });
}
