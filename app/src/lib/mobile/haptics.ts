import { isNativeApp } from './runtime';

export const hapticImpactLight = async () => {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (e) {
    console.error('Haptics error:', e);
  }
};

export const hapticImpactMedium = async () => {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch (e) {
    console.error('Haptics error:', e);
  }
};

export const hapticSelection = async () => {
  if (!isNativeApp()) return;
  try {
    const { Haptics } = await import('@capacitor/haptics');
    await Haptics.selectionStart();
  } catch (e) {
    console.error('Haptics error:', e);
  }
};
