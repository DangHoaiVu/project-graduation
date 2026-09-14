'use client';

import { useEffect } from 'react';
import { registerNotificationServiceWorker, onServiceWorkerMessage } from '@/app/lib/notification-client';

export function NotificationManager() {
  useEffect(() => {
    // 1. Register Service Worker for push notifications & silent dismiss
    void registerNotificationServiceWorker();

    // 2. Listen to service worker postMessage events
    const unsubscribe = onServiceWorkerMessage((event) => {
      if (event.data?.type === 'NOTIFICATION_DISMISSED') {
        console.log('[NotificationManager] Stale notification dismissed:', event.data.tag);
      } else if (event.data?.type === 'NOTIFICATION_RECEIVED') {
        console.log('[NotificationManager] Notification received:', event.data.payload);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return null;
}

