self.addEventListener('install', event => {
  console.log('📦 Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('🚀 Service Worker activated');
});

self.addEventListener('fetch', event => {
  // 기본 통과 처리 (캐시 사용 안 할 경우)
  event.respondWith(fetch(event.request));
});

// 푸시 알림 클릭 처리
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
