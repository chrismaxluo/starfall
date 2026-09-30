// 生成测试用的 SVGA：fixtures/media/slots.svga（2.x）和 slots-v1.svga（1.x）。
// 图层：avatar 头像、frame 头像框、badge 图标、nickname 昵称、welcome 欢迎语，另有一个不替换的 deco 装饰
import fs from 'node:fs';
import path from 'node:path';
import { encodeSvga1, encodeSvga2, png, still } from './svga.mjs';

const OUT = path.resolve(import.meta.dirname, '../../../fixtures/media');
const solid = (w, h, rgba) => png(w, h, () => rgba);
const disc = (s, rgba) => png(s, s, (x, y) => ((x - s / 2) ** 2 + (y - s / 2) ** 2 < (s / 2) ** 2 ? rgba : [0, 0, 0, 0]));
const F = 30;
const images = {
  avatar: disc(100, [200, 120, 160, 255]),
  frame: disc(140, [220, 220, 230, 120]),
  badge: solid(48, 48, [80, 150, 255, 255]),
  nickname: solid(300, 60, [255, 255, 255, 60]),
  welcome: solid(400, 40, [255, 255, 255, 40]),
  deco: solid(50, 50, [255, 200, 0, 255]),
};
const sprites = [
  { imageKey: 'deco', frames: still(F, { x: 10, y: 10, width: 50, height: 50 }) },
  { imageKey: 'avatar', frames: still(F, { x: 40, y: 40, width: 100, height: 100 }) },
  { imageKey: 'frame', frames: still(F, { x: 20, y: 20, width: 140, height: 140 }) },
  { imageKey: 'badge', frames: still(F, { x: 560, y: 20, width: 48, height: 48 }) },
  { imageKey: 'nickname', frames: still(F, { x: 180, y: 40, width: 300, height: 60 }) },
  { imageKey: 'welcome', frames: still(F, { x: 180, y: 110, width: 400, height: 40 }) },
];
const movie = { width: 640, height: 180, fps: 15, frames: F, images, sprites };
fs.writeFileSync(path.join(OUT, 'slots.svga'), encodeSvga2(movie));
// 1.x：图层名字用别的常见写法，测试自动对应
const v1 = { ...movie, images: { head: images.avatar, nick: images.nickname, deco: images.deco }, sprites: [
  { imageKey: 'head', frames: still(F, { x: 40, y: 40, width: 100, height: 100 }) },
  { imageKey: 'nick', frames: still(F, { x: 180, y: 40, width: 300, height: 60 }) },
  { imageKey: 'deco', frames: still(F, { x: 10, y: 10, width: 50, height: 50 }) },
] };
fs.writeFileSync(path.join(OUT, 'slots-v1.svga'), await encodeSvga1(v1));
console.log('ok', fs.statSync(path.join(OUT, 'slots.svga')).size, fs.statSync(path.join(OUT, 'slots-v1.svga')).size);
