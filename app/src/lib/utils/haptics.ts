'use client';

import { Capacitor } from '@capacitor/core';

/**
 * UTILITY: Haptic Feedback Wrapper
 * 
 * Optimized for Premium feel:
 * - Real physical impact vibrations are DISABLED as requested.
 * - Soft 'selection' haptics are ENABLED to provide subtle native feedback.
 */

/**
 * Trigger a light impact haptic feedback (DISABLED - kept for API compatibility)
 */
export async function hapticImpactLight() {
  // Disabled per user preference
}

/**
 * Trigger a medium impact haptic feedback (DISABLED - kept for API compatibility)
 */
export async function hapticImpactMedium() {
  // Disabled per user preference
}

/**
 * Trigger a very soft selection change haptic feedback (ENABLED)
 * This is the subtle "click" felt when scrolling or selecting, not a vibration.
 */
export async function hapticSelection() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Haptics } = await import('@capacitor/haptics');
      await Haptics.selectionChanged();
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Trigger a success notification haptic feedback (DISABLED)
 */
export async function hapticSuccess() {
  // Disabled per user preference
}
