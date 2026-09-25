// P0 技术验证：B 站扫码登录，保存登录信息供抓包使用。
// 用法：node spike/login.ts
// 二维码图片输出到 design/preview/assets/login-qr.png（预览服务可直接访问，不进 git），有效期约 3 分钟。
// 登录信息保存到 data/bili-account.json（权限 600，不进 git）。正式版会加密存储。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QR_PNG = path.join(ROOT, 'design/preview/assets/login-qr.png');
const ACCOUNT = path.join(ROOT, 'data/bili-account.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function get(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
  return { json: (await res.json()) as any, cookies: res.headers.getSetCookie() };
}

const STATUS: Record<number, string> = { 86101: '等待扫码', 86090: '已扫码，请在手机上确认', 86038: '二维码已过期', 0: '登录成功' };

async function main() {
  const gen = await get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate');
  if (gen.json.code !== 0) throw new Error(`申请二维码失败：${gen.json.code} ${gen.json.message}`);
  const { url, qrcode_key } = gen.json.data;
  fs.mkdirSync(path.dirname(QR_PNG), { recursive: true });
  execFileSync('npx', ['-y', 'qrcode@1.5.4', '-o', QR_PNG, '-w', '360', url], { stdio: 'ignore' });
  console.log(`二维码已生成：${path.relative(ROOT, QR_PNG)}`);

  let last = -1;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await get(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`);
    const code: number = poll.json.data?.code;
    if (code !== last) { console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${STATUS[code] ?? `未知状态 ${code}`}`); last = code; }
    if (code === 86038) break;
    if (code === 0) {
      const jar: Record<string, string> = {};
      for (const line of poll.cookies) {
        const [pair] = line.split(';');
        const k = pair.indexOf('=');
        if (k > 0) jar[pair.slice(0, k).trim()] = pair.slice(k + 1).trim();
      }
      const expires = poll.cookies.find((c) => c.startsWith('SESSDATA='))?.match(/Expires=([^;]+)/i)?.[1];
      fs.mkdirSync(path.dirname(ACCOUNT), { recursive: true });
      fs.writeFileSync(ACCOUNT, JSON.stringify({ savedAt: new Date().toISOString(), sessdataExpires: expires ?? null, refreshToken: poll.json.data.refresh_token, cookies: jar }, null, 2), { mode: 0o600 });
      console.log(`登录信息已保存：${path.relative(ROOT, ACCOUNT)}（UID ${jar.DedeUserID}，SESSDATA 有效期至 ${expires ?? '未知'}）`);
      console.log(`Cookie 字段：${Object.keys(jar).join(', ')}`);
      break;
    }
  }
  fs.rmSync(QR_PNG, { force: true });
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
