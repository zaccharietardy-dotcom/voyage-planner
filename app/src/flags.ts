import { flag } from 'flags/next';

/**
 * Feature flags for Narae Voyage.
 * Flags are evaluated server-side in Server Components.
 * Toggle via Vercel Flags dashboard or Edge Config.
 */

export const showReferralSystem = flag<boolean>({
  key: 'show-referral-system',
  defaultValue: true,
  description: 'Show referral code card in profile and accept ?ref= codes on register',
  options: [
    { value: true, label: 'Enabled' },
    { value: false, label: 'Disabled' },
  ],
  decide() {
    return true;
  },
});

export const showPushNotifications = flag<boolean>({
  key: 'show-push-notifications',
  defaultValue: false,
  description: 'Show push notification permission prompt to users',
  options: [
    { value: true, label: 'Enabled' },
    { value: false, label: 'Disabled' },
  ],
  decide() {
    return false; // Enable once Firebase is fully tested
  },
});

export const showCesiumGlobe = flag<boolean>({
  key: 'show-cesium-globe',
  defaultValue: true,
  description: 'Show 3D Cesium globe on /globe page (heavy dependency)',
  options: [
    { value: true, label: 'Show' },
    { value: false, label: 'Hide' },
  ],
  decide() {
    return true;
  },
});

export const showFeedbackWidget = flag<boolean>({
  key: 'show-feedback-widget',
  defaultValue: true,
  description: 'Show floating feedback button for logged-in users',
  options: [
    { value: true, label: 'Show' },
    { value: false, label: 'Hide' },
  ],
  decide() {
    return true;
  },
});

export const showSocialProof = flag<boolean>({
  key: 'show-social-proof',
  defaultValue: true,
  description: 'Show stats and testimonials on landing page',
  options: [
    { value: true, label: 'Show' },
    { value: false, label: 'Hide' },
  ],
  decide() {
    return true;
  },
});
