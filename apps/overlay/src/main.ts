// 入口：同一个程序有两种页面，都作为浏览器源放进 B站直播姬 / OBS
// - 特效页：/overlay/?output=1&key=...
// - 弹幕列表：/overlay/?output=1&key=...&chat=1
// 两种页面共用一个入口脚本（名字带构建哈希），特效页、弹幕列表都能按它自动更新
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/600.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-serif-sc/600.css';
import '@fontsource/noto-serif-sc/900.css';

if (new URLSearchParams(location.search).get('chat') === '1') void import('./chat.ts');
else void import('./fx.ts');
