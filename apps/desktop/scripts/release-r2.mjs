// 发布时把安装包和服务器版代码包传到星临自己的备用下载地址（Cloudflare R2，https://dl.maasky.com/），
// GitHub 连不上时桌面版和服务器版从这里下载。在 GitHub 打包流程里运行（.github/workflows/desktop.yml），用 aws 命令上传：
//   node release-r2.mjs publish <标签> <安装包目录> <代码包>   上传，再删掉旧版本
//   node release-r2.mjs check                                试一下能不能上传和下载（手动试打包时运行）
// 需要环境变量 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET（GitHub 仓库的 Secrets）
//
// 存放位置：
//   desktop/Starfall-<版本>-win-x64-setup.exe(.blockmap)  安装包和差量更新用的 blockmap
//   desktop/latest.yml   最新正式版（正式版用户查新版本）
//   desktop/beta.yml     最新的测试版或正式版，哪个新用哪个（测试版用户查新版本）
//   server/starfall.bundle  服务器版代码包：main 和全部版本标签（git bundle）
// 正式版留最近 3 个；测试版只留最新的 1 个，而且比最新正式版旧的不留
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_BASE = 'https://dl.maasky.com/';
export const KEEP_STABLE = 3;

const INSTALLER = /^desktop\/Starfall-(.+)-win-x64-setup\.exe(\.blockmap)?$/;

/** 拆开版本号：1.9.0-beta.2 → { core: [1, 9, 0], pre: ['beta', 2] } */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) throw new Error(`版本号不对：${v}`);
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? +p : p)) : [] };
}

/** 比较版本号（和 semver 一样：同一个版本号，测试版比正式版旧；beta.10 比 beta.9 新） */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const isPrerelease = (v) => parse(v).pre.length > 0;

/** latest.yml / beta.yml 里的版本号 */
export function ymlVersion(text) {
  return /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null;
}

/** 这次发布后，beta.yml 要不要换成这次的（原来没有、或者比这次旧才换） */
export const shouldReplaceBeta = (version, betaYml) => {
  const old = betaYml ? ymlVersion(betaYml) : null;
  return !old || compareVersions(version, old) > 0;
};

/**
 * 要删掉的旧安装包：正式版留最近 KEEP_STABLE 个；测试版只留最新的 1 个，而且要比最新正式版新。
 * 刚发布的版本一定留着
 */
export function planCleanup(keys, current) {
  const versions = new Set();
  for (const k of keys) {
    const m = INSTALLER.exec(k);
    if (m) versions.add(m[1]);
  }
  const desc = [...versions].sort((a, b) => compareVersions(b, a));
  const stable = desc.filter((v) => !isPrerelease(v));
  const keep = new Set(stable.slice(0, KEEP_STABLE));
  const beta = desc.find(isPrerelease);
  if (beta && (!stable.length || compareVersions(beta, stable[0]) > 0)) keep.add(beta);
  keep.add(current);
  return keys.filter((k) => {
    const m = INSTALLER.exec(k);
    return m && !keep.has(m[1]);
  });
}

// ---------- 上传（aws 命令，GitHub 的 Ubuntu 电脑上自带） ----------

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（在 GitHub 仓库的 Settings → Secrets and variables → Actions 里添加）`);
  return v;
}

function aws(...args) {
  return execFileSync('aws', [...args, '--endpoint-url', `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: env('R2_ACCESS_KEY_ID'),
      AWS_SECRET_ACCESS_KEY: env('R2_SECRET_ACCESS_KEY'),
      AWS_DEFAULT_REGION: 'auto',
      // R2 不支持新版 aws 命令默认加的校验方式
      AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
      AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
    },
  });
}

const s3 = (key) => `s3://${env('R2_BUCKET')}/${key}`;

/** 版本号固定的文件长期缓存；latest.yml、代码包这类会被覆盖的不缓存 */
function put(file, key, { fixed = false, type = 'application/octet-stream' } = {}) {
  console.log(`上传 ${key}（${(fs.statSync(file).size / 1024 / 1024).toFixed(1)}MB）`);
  aws(
    's3',
    'cp',
    file,
    s3(key),
    '--only-show-errors',
    '--content-type',
    type,
    '--cache-control',
    fixed ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

function listKeys(prefix) {
  const out = aws('s3api', 'list-objects-v2', '--bucket', env('R2_BUCKET'), '--prefix', prefix, '--output', 'json');
  return out.trim() ? (JSON.parse(out).Contents ?? []).map((o) => o.Key) : [];
}

/** 读一个文件的内容；没有这个文件时为 null */
const getText = (key) => (listKeys(key).includes(key) ? aws('s3', 'cp', s3(key), '-', '--only-show-errors') : null);

/** 上传后从公开地址读回来核对，确认用户那边能下载到（不给 expect 时只看文件在不在） */
async function verifyPublic(key, expect) {
  const r = await fetch(PUBLIC_BASE + key, { method: expect === undefined ? 'HEAD' : 'GET', cache: 'no-store' });
  if (!r.ok) throw new Error(`上传后从 ${PUBLIC_BASE}${key} 读不到（${r.status}）：检查存储桶的自定义域名`);
  if (expect !== undefined && (await r.text()) !== expect)
    throw new Error(`${PUBLIC_BASE}${key} 读到的内容和上传的不一样`);
}

async function publish(tag, dir, bundle) {
  const version = tag.replace(/^v/, '');
  const channel = isPrerelease(version) ? 'beta' : 'latest';
  // 打包工具测试版也只生成 latest.yml（内容是这个测试版）
  const ymlFile = [`${channel}.yml`, 'latest.yml'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!ymlFile) throw new Error(`${dir} 里没有 latest.yml`);
  const yml = fs.readFileSync(ymlFile, 'utf8');
  if (ymlVersion(yml) !== version)
    throw new Error(`${path.basename(ymlFile)} 里的版本号 ${ymlVersion(yml)} 和标签 ${tag} 不一致`);
  const exe = `Starfall-${version}-win-x64-setup.exe`;
  for (const f of [exe, `${exe}.blockmap`]) if (!fs.existsSync(path.join(dir, f))) throw new Error(`找不到 ${f}`);

  // 先传安装包，最后才换 yml：用户查到新版本时安装包一定已经在了
  put(path.join(dir, exe), `desktop/${exe}`, { fixed: true });
  put(path.join(dir, `${exe}.blockmap`), `desktop/${exe}.blockmap`, { fixed: true });
  put(bundle, 'server/starfall.bundle');
  const ymlKeys = channel === 'latest' ? ['desktop/latest.yml'] : [];
  if (shouldReplaceBeta(version, getText('desktop/beta.yml'))) ymlKeys.push('desktop/beta.yml');
  else console.log('beta.yml 里已经是更新的版本，不换');
  for (const key of ymlKeys) put(ymlFile, key, { type: 'text/yaml; charset=utf-8' });
  await verifyPublic(`desktop/${exe}`);
  await verifyPublic('server/starfall.bundle');
  for (const key of ymlKeys) await verifyPublic(key, yml);

  const old = planCleanup(listKeys('desktop/'), version);
  for (const key of old) {
    console.log(`删掉旧版本 ${key}`);
    aws('s3', 'rm', s3(key), '--only-show-errors');
  }
  console.log(`已上传 ${tag} 到 ${PUBLIC_BASE}`);
}

async function check() {
  const key = 'check/upload-test.txt';
  const text = `星临上传测试 ${new Date().toISOString()}\n`;
  const file = path.join(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? '/tmp', 'r2-')), 'test.txt');
  fs.writeFileSync(file, text);
  put(file, key, { type: 'text/plain; charset=utf-8' });
  await verifyPublic(key, text);
  aws('s3', 'rm', s3(key), '--only-show-errors');
  console.log(`能上传，也能从 ${PUBLIC_BASE} 下载。现在有：`);
  for (const k of listKeys('')) console.log(`  ${k}`);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'publish' && args.length === 3) await publish(args[0], args[1], args[2]);
  else if (cmd === 'check') await check();
  else {
    console.error('用法：node release-r2.mjs publish <标签> <安装包目录> <代码包> | check');
    process.exit(2);
  }
}
