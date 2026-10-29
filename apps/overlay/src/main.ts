// 入口：同一个程序有四种页面，都作为浏览器源放进 B站直播姬 / OBS
// - 特效页：/overlay/?output=1&key=...
// - 弹幕列表：/overlay/?output=1&key=...&chat=1
// - 送礼名单：/overlay/?output=1&key=...&gifts=1
// - 点歌窗口：/overlay/?output=1&key=...&music=1
// 几种页面共用一个入口脚本（名字带构建哈希），都能按它自动更新
import './fonts.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/600.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-serif-sc/600.css';
import '@fontsource/noto-serif-sc/900.css';

import { setupRecover } from './recover.ts';

const q = new URLSearchParams(location.search);
// 直播软件比星临先打开时，星临一开就自动连上（不用手动刷新浏览器源）。
// 先等登记完（本机一般几毫秒，最多 1.5 秒）再启动页面，连上星临时上报的环境里才有准确结果
void setupRecover().then(() => {
  if (q.get('chat') === '1') void import('./chat.ts');
  else if (q.get('gifts') === '1') void import('./gifts.ts');
  else if (q.get('music') === '1') void import('./music.ts');
  else void import('./fx.ts');
});
