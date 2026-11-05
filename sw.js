/* АМЦ - service worker.
   Needed for three things: notifications on iOS (which only work through
   registration.showNotification in an installed web app), daily reminders
   (an empty web push from admin/push.php, the text is built here from the
   diary kept on the phone), and opening the diary without a connection. */

var VERSION = "amc-v4";
/* копия записей дневника для напоминаний: app.js кладёт её сюда при каждом
   сохранении, потому что service worker не видит localStorage */
var STATE_CACHE = "amc-state";
var STATE_URL = "/__amc_state";
var SHELL = [
  "./app.html",
  "./assets/css/style.css",
  "./assets/css/app.css",
  "./assets/js/main.js",
  "./assets/js/app.js",
  "./assets/img/doctor-ganzha.jpg",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./favicon.svg",
  "./manifest.json"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION && k !== STATE_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* pages come from the network first so edits land straight away,
     falling back to cache only when offline */
  if (req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./app.html");
        });
      })
    );
    return;
  }

  /* Stylesheets and scripts are the two things that actually change while the
     site is being worked on, and serving them stale meant a fix only appeared
     on the visit AFTER the one that fetched it. Network first, cache only as
     the offline fallback. */
  if (/\.(css|js)$/i.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  /* images and media do not change under the same name: cache first and
     refresh in the background */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "./app.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf("app.html") !== -1 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* ---------- ежедневное напоминание ---------- */

var DAY = 86400000;
function isoDay(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function todayDay() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function plural(n, one, few, many) {
  var a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
/* то же, что streak() в app.js: со дня после последнего срыва, иначе со старта */
function streakOf(st, kind) {
  var from = isoDay(st.start);
  ((st.slips && st.slips[kind]) || []).forEach(function (s) {
    var d = isoDay(s);
    if (d >= from) from = new Date(d.getTime() + DAY);
  });
  return Math.max(0, Math.round((todayDay() - from) / DAY) + 1);
}

var SUPPORT = [
  [1, "Первые дни самые трудные. Держитесь, дальше будет легче."],
  [4, "Организм уже говорит спасибо. Держитесь!"],
  [7, "Больше недели. Вы справляетесь."],
  [14, "Две недели. Это уже привычка, а не попытка."],
  [30, "Больше месяца. Это большой путь."],
  [90, "Три месяца. Вы живёте по-новому."],
  [365, "Больше года. Вы это сделали."]
];

function dailyMessage(st) {
  var n = new Date(), dow = n.getDay();
  if (!st || !st.start) return ["Дневник трезвости", "Отметьте сегодняшний день. Один день за раз."];
  var parts = [], top = 0;
  [["alcohol", "без алкоголя"], ["tobacco", "без сигарет"]].forEach(function (k) {
    if (!st[k[0]] || !st[k[0]].on) return;
    var d = streakOf(st, k[0]);
    top = Math.max(top, d);
    parts.push(d + " " + plural(d, "день", "дня", "дней") + " " + k[1]);
  });
  if (!parts.length) return ["Дневник трезвости", "Загляните в дневник: отметьте, как прошёл день."];
  var line = SUPPORT[0][1];
  SUPPORT.forEach(function (s) { if (top >= s[0]) line = s[1]; });
  if (dow === 5) line = "Сегодня пятница, самый частый день срыва. Вечер дома того стоит.";
  else if (dow === 6) line = "Выходной не повод. Ваши дни подряд дороже одного вечера.";
  return ["Уже " + parts.join(" и "), line];
}

self.addEventListener("push", function (e) {
  e.waitUntil(
    caches.open(STATE_CACHE)
      .then(function (c) { return c.match(STATE_URL); })
      .then(function (r) { return r ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (st) {
        var m = dailyMessage(st);
        return self.registration.showNotification(m[0], {
          body: m[1], tag: "amc-daily", lang: "ru",
          icon: "assets/img/icon-192.png", badge: "assets/img/icon-192.png",
          data: { url: "./app.html" }
        });
      })
  );
});
