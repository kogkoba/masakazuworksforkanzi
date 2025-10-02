// キャッシュ名（更新時は v2, v3… と変える）
const CACHE_NAME = "kanji-cache-v1";

// キャッシュするファイル一覧
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/pen.js",
  "./js/grade.js",
  "./js/storage.js",
  "./data/problems.json",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png"
];

// インストール時にキャッシュへ保存
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

// 古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

// ネットワークが無理ならキャッシュを使う
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
