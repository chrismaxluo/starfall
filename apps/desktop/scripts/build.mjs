// 准备打包用的文件（electron-builder 打包前运行）：
//   stage/      程序本体（会打进 app.asar）：主进程、页面桥接、本机服务（各打成一个文件）、图标、package.json
//   stage-res/  放到安装目录 resources 下的文件：管理后台、特效页、数据库迁移文件（ffprobe 由 GitHub 打包流程另外下载到 bin/）
// 需要先在仓库根目录运行 pnpm build（构建后台和特效页）
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(DESKTOP, '../..');
const STAGE = path.join(DESKTOP, 'stage');
const RES = path.join(DESKTOP, 'stage-res');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

for (const dist of ['apps/admin/dist', 'apps/overlay/dist']) {
  if (!fs.existsSync(path.join(ROOT, dist, 'index.html'))) throw new Error(`${dist} 不存在：先在仓库根目录运行 pnpm build`);
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(RES, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // 原生模块和更新模块装在 stage/node_modules 里，不打进文件
  external: ['electron', 'electron-updater', 'better-sqlite3'],
  // 服务端代码用 import.meta.dirname 算默认路径（电脑版都用环境变量覆盖，这里只是不让它报错）
  define: { 'import.meta.dirname': '__dirname' },
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [path.join(DESKTOP, 'src/main.ts')], outfile: path.join(STAGE, 'main.cjs') });
await build({ ...common, entryPoints: [path.join(DESKTOP, 'src/preload.ts')], outfile: path.join(STAGE, 'preload.cjs') });
await build({ ...common, entryPoints: [path.join(DESKTOP, 'src/server.ts')], outfile: path.join(STAGE, 'server.cjs'), sourcemap: 'inline' }); // 日志里的出错位置对应到源代码

fs.copyFileSync(path.join(DESKTOP, 'resources/icon.ico'), path.join(STAGE, 'icon.ico'));

// 版本号跟仓库根目录一致；运行时依赖用 desktop/package.json 里锁定的版本
const root = readJson(path.join(ROOT, 'package.json'));
const desktop = readJson(path.join(DESKTOP, 'package.json'));
fs.writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: 'starfall',
      productName: 'Starfall',
      version: root.version,
      description: '星临：B 站直播间互动特效工具',
      author: 'chrismaxluo',
      license: root.license,
      homepage: 'https://github.com/chrismaxluo/starfall',
      main: 'main.cjs',
      dependencies: desktop.dependencies,
    },
    null,
    2,
  ),
);

const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(RES, to), { recursive: true });
copy('apps/admin/dist', 'admin');
copy('apps/overlay/dist', 'overlay');
copy('apps/server/drizzle', 'drizzle');

console.log(`已准备好 ${root.version}：${path.relative(ROOT, STAGE)}、${path.relative(ROOT, RES)}`);
