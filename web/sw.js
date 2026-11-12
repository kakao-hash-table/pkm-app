// 서비스 워커 — 알림만 맡는다(화면은 늘 서버에서 새로 받는다). 알림을 누르면 열린 창을 앞으로 가져와 그 채팅(채팅이 아니면 알림에 적힌 화면)을 열고, 없으면 새로 연다
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'PKM', {
    body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: m.url || '/', room: m.room || null, profile: (m.url && new URL(m.url, self.location.origin).searchParams.get('profile')) || null },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.filter(c => new URL(c.url).origin === self.location.origin);
    const w = mine.find(c => c.focused) || mine.find(c => c.visibilityState === 'visible') || mine[0];
    if (w){ await w.focus().catch(() => {}); w.postMessage({ type: 'pkm-open-chat', room: d.room, profile: d.profile, url: d.url }); return; }
    await self.clients.openWindow(url);
  })());
});
