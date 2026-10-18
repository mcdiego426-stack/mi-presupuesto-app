// Service worker de Mi Presupuesto:
// - Guarda la pantalla de la app en el aparato para que abra al instante aunque la red esté lenta
//   (se muestra la copia guardada y se actualiza en segundo plano para la siguiente vez).
// - Recibe avisos: el push llega vacío; aquí se piden los avisos nuevos a la hoja con la clave del aparato.
var API_URL = 'https://script.google.com/macros/s/AKfycbzO4KpgedAHfkCy9pDL_Jqidkr0O8jir2CKr_GAs_3_qDaL1uPJb1q0Z8Zmy03zkADvAg/exec';

var CACHE = 'presupuesto-app';
var ARCHIVOS = ['./', 'manifest.webmanifest', 'icono-180.png', 'icono-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).catch(function () {}));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

// Solo archivos de la app (mismo sitio). Las llamadas a la hoja de Google siempre van a la red.
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  var clave = req.mode === 'navigate' ? './' : req;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(clave, { ignoreSearch: true }).then(function (guardada) {
      // no-cache: siempre pregunta a GitHub si hay versión nueva (no usa la copia de 10 min del navegador)
      var red = fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) {
          c.put(clave, res.clone());
          // Si la pantalla cambió, avisa a la app para que se recargue con la versión nueva
          if (guardada && req.mode === 'navigate') {
            Promise.all([guardada.clone().text(), res.clone().text()]).then(function (t) {
              if (t[0] !== t[1]) self.clients.matchAll({ type: 'window' }).then(function (cs) {
                cs.forEach(function (cl) { cl.postMessage('nueva-version'); });
              });
            });
          }
        }
        return res;
      });
      if (guardada) { e.waitUntil(red.catch(function () {})); return guardada; }
      return red;
    });
  }));
});

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

// Los pushes se atienden uno por uno: si llegan dos casi juntos, el segundo ya ve el "desde" nuevo
// y no vuelve a mostrar los mismos avisos.
var cola = Promise.resolve();
self.addEventListener('push', function (e) {
  var tarea = cola.then(mostrarAvisos);
  cola = tarea.catch(function () {});
  e.waitUntil(tarea);
});

function mostrarAvisos() {
  return (async function () {
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
  })();
}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    return cs.length ? cs[0].focus() : self.clients.openWindow('./');
  }));
});
