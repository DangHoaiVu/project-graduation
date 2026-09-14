'use client';

import { getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';
import { getDeviceId } from '@/app/lib/device-id';

/**
 * Client-side notification manager for LMS Assistant.
 * Handles Service Worker registration, permission requesting, and local notification dismissal.
 */

export async function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    return registration;
  } catch (err) {
    console.warn('[Notification] Failed to register service worker:', err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  // Browsers allow notifications only from HTTPS origins (localhost is the exception).
  if (!window.isSecureContext) {
    console.warn('[Notification] HTTPS is required before a device can grant notification permission.');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.warn('[Notification] Permission request error:', err);
    return 'denied';
  }
}

export async function registerFcmToken(userId: number): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return null;
  }

  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (Object.values(config).some(value => !value) || !vapidKey) {
    console.warn('[Notification] Firebase Web configuration is incomplete.');
    return null;
  }

  try {
    const app = getApps()[0] || initializeApp(config);
    const registration = await registerNotificationServiceWorker();
    if (!registration) return null;

    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return null;

    localStorage.setItem('fcmToken', token);
    await fetch('/api/fcm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token, deviceId: getDeviceId(), deviceType: 'web' }),
    });
    return token;
  } catch (err) {
    console.warn('[Notification] Failed to register FCM token:', err);
    return null;
  }
}

export async function dismissLocalNotificationByTag(tag: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications({ tag });
    notifications.forEach((n) => n.close());
    return true;
  } catch (err) {
    console.warn('[Notification] Failed to dismiss notification locally:', err);
    return false;
  }
}

export function onServiceWorkerMessage(callback: (event: MessageEvent) => void): () => void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  navigator.serviceWorker.addEventListener('message', callback);
  return () => {
    navigator.serviceWorker.removeEventListener('message', callback);
  };
}

