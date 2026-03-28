'use client';

function isNative(): boolean {
  try {
    return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  } catch { return false; }
}

/**
 * Trigger a light impact haptic feedback if running on a native device.
 */
export async function hapticImpactLight() {
  if (isNative()) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) {
      // Ignore errors if haptics fail
    }
  }
}

/**
 * Trigger a medium impact haptic feedback if running on a native device.
 */
export async function hapticImpactMedium() {
  if (isNative()) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Trigger a selection change haptic feedback if running on a native device.
 */
export async function hapticSelection() {
  if (isNative()) {
    try {
      const { Haptics } = await import('@capacitor/haptics');
      await Haptics.selectionChanged();
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Trigger a success notification haptic feedback if running on a native device.
 */
export async function hapticSuccess() {
  if (isNative()) {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
    } catch (e) {
      // Ignore
    }
  }
}
