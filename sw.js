self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d;
  try { d = e.data.json(); } catch { d = { title: 'CSIRT Toscana', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CSIRT Toscana', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/'));
});
