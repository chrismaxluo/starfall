// 忘记后台密码时在服务器上运行：pnpm reset-password
// 生成新的随机密码并显示出来（也写入 data/initial-password.txt），原来的登录全部失效。服务不需要重启。
process.umask(0o077);
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { paths } from '../config.ts';
import { AdminAuth } from '../services/auth.ts';
import { Secret } from '../services/secret.ts';
import { SettingsStore } from '../services/settings.ts';

const config = loadConfig();
const p = paths(config.dataDir);
const db = openDb(p.db);
const auth = new AdminAuth(new SettingsStore(db), Secret.load(p.secretKey), config.dataDir);
const pw = auth.resetPassword();
db.$client.close();

// 服务以专用账号（starfall）运行。用 root 运行这个命令时，数据库的临时文件和密码文件可能变成 root 所有，
// 服务随后无法写入：把它们交还给数据目录的所有者
if (process.getuid?.() === 0) {
  const owner = fs.statSync(config.dataDir);
  if (owner.uid !== 0) {
    for (const f of [p.db, `${p.db}-wal`, `${p.db}-shm`, path.join(config.dataDir, 'initial-password.txt')]) {
      if (fs.existsSync(f) && fs.statSync(f).uid !== owner.uid) fs.chownSync(f, owner.uid, owner.gid);
    }
  }
}
process.stdout.write(`已重置星临管理后台密码。\n新密码：${pw}\n（也保存在 ${config.dataDir}/initial-password.txt，登录后请在「设置」里改成自己的密码）\n原来已登录的浏览器需要用新密码重新登录。\n`);
