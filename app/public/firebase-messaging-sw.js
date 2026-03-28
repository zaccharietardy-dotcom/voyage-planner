/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDs3KZVBPajTYmkuINabbXMfUVDgC09wfI',
  authDomain: 'narre-ee011.firebaseapp.com',
  projectId: 'narre-ee011',
  storageBucket: 'narre-ee011.firebasestorage.app',
  messagingSenderId: '113387989960',
  appId: '1:113387989960:web:8e84b78b5d334d36ff2efd',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Narae Voyage';
  const options = {
    body: payload.notification?.body || '',
    icon: '/logo-narae.png',
    badge: '/favicon-32x32.png',
    data: payload.data,
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/mes-voyages';
  event.waitUntil(clients.openWindow(url));
});
