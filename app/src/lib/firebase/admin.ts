import admin from 'firebase-admin';

function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccount) {
    console.warn('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_KEY not set — push notifications disabled');
    return null;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccount)),
    });
    return admin;
  } catch (err) {
    console.error('[firebase-admin] Failed to initialize:', err);
    return null;
  }
}

/**
 * Send a push notification to a specific device token.
 */
export async function sendPushNotification(options: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<boolean> {
  const fb = getFirebaseAdmin();
  if (!fb) return false;

  try {
    await fb.messaging().send({
      token: options.token,
      notification: {
        title: options.title,
        body: options.body,
      },
      data: options.data,
      webpush: {
        fcmOptions: {
          link: options.data?.url || '/',
        },
      },
    });
    return true;
  } catch (err) {
    console.error('[firebase-admin] Send failed:', err);
    return false;
  }
}

/**
 * Send push notification to multiple device tokens.
 */
export async function sendPushToMultiple(options: {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<number> {
  const fb = getFirebaseAdmin();
  if (!fb || options.tokens.length === 0) return 0;

  try {
    const response = await fb.messaging().sendEachForMulticast({
      tokens: options.tokens,
      notification: {
        title: options.title,
        body: options.body,
      },
      data: options.data,
    });
    return response.successCount;
  } catch (err) {
    console.error('[firebase-admin] sendMulti failed:', err);
    return 0;
  }
}
