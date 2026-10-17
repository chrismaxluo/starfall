// 特效页的「看门程序」（Service Worker），由 src/recover.ts 在直播软件里登记，只管 /overlay/ 下的页面打开。
// - 星临开着：照常从星临拿最新的页面，不用存货（星临更新后照样是新版本）。
// - 星临没开（直播软件比星临先打开）或服务正在重启：不显示出错页，先显示一个透明的等待页，
//   每 2 秒问一次，能连上星临了就刷新成真正的特效页，不用在直播软件里手动刷新。
// 直播软件的内核比较旧（直播姬是 Chrome 95），这里只用老写法，不经过打包
'use strict';

var WAIT_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>星临 · 等待连接</title>' +
  '<style>html,body{margin:0;background:transparent}</style></head><body><script>' +
  '(function(){' +
  'function later(){setTimeout(check,2000)}' +
  'function check(){fetch(location.href,{cache:"no-store"}).then(function(r){if(r.ok)location.reload();else later()},later)}' +
  'later()' +
  '})()' +
  '</script></body></html>';

function waiting() {
  return new Response(WAIT_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (e) {
  // 只管打开页面；页面里的脚本、图片、视频、连接都不经过这里
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      // 经反向代理访问时，服务没起来代理会回 502 / 503 / 504
      return r.status >= 502 && r.status <= 504 ? waiting() : r;
    }, waiting),
  );
});
