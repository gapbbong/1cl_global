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

// 푸시 알림 클릭 처리 (사용 시)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // 필요한 동작 추가 가능
});
