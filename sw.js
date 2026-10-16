// Service worker de Mi Presupuesto: solo recibe avisos (no guarda la app en caché).
// El push llega vacío; aquí se piden los avisos nuevos a la hoja con la clave guardada en este aparato.
var API_URL = 'https://script.google.com/macros/s/AKfycbzO4KpgedAHfkCy9pDL_Jqidkr0O8jir2CKr_GAs_3_qDaL1uPJb1q0Z8Zmy03zkADvAg/exec';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function idb(modo, fn) {
  return new Promise(function (ok, ko) {
    var r = indexedDB.open('presupuesto', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onerror = function () { ko(r.error); };
    r.onsuccess = function () {
      var tx = r.result.transaction('kv', modo), st = tx.objectStore('kv'), q = fn(st);
      tx.oncomplete = function () { ok(q && q.result); };
      tx.onerror = function () { ko(tx.error); };
    };
  });
}
function leer(k) { return idb('readonly', function (st) { return st.get(k); }); }
function guardar(k, v) { return idb('readwrite', function (st) { st.put(v, k); }); }

self.addEventListener('push', function (e) {
  e.waitUntil((async function () {
    var avisos = [];
    try {
      var k = await leer('k'), desde = (await leer('desde')) || 0;
      var res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ k: k, fn: 'avisosPush', args: [desde] }) });
      var j = await res.json();
      if (j.ok) avisos = j.data || [];
    } catch (err) { /* sin conexión: se muestra el aviso genérico */ }
    if (!avisos.length) {
      return self.registration.showNotification('Mi Presupuesto', { body: 'Tienes un aviso nuevo. Abre la app para verlo.', icon: 'icono-192.png', tag: 'generico' });
    }
    await guardar('desde', Math.max.apply(null, avisos.map(function (a) { return a.t; })));
    await Promise.all(avisos.map(function (a) {
      return self.registration.showNotification(a.titulo, { body: a.cuerpo || '', icon: 'icono-192.png', tag: a.id });
    }));
  })());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    return cs.length ? cs[0].focus() : self.clients.openWindow('./');
  }));
});
