// 运行配置：全部可以用环境变量覆盖，方便以后在 Windows 版里换成用户目录。
import path from 'node:path';
import { DEFAULT_PORT } from '@starfall/shared';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export interface Config {
  port: number;
  host: string;
  /** 数据目录：数据库、素材文件、加密密钥、备份 */
  dataDir: string;
  /** 构建好的管理后台和特效页 */
  adminDist: string;
  overlayDist: string;
  /** 主播所在时区，用于"今天"（专属规则有效期、每日统计） */
  timeZone: string;
  /** 放在反向代理后面时填代理的地址（例如 127.0.0.1），按 X-Forwarded-For / X-Forwarded-Proto 识别真实来源和 HTTPS */
  trustProxy: string | false;
  /** 电脑版：只允许本机访问，后台不用密码（由 apps/desktop 启动时设置 STARFALL_DESKTOP=1） */
  desktop: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.STARFALL_DATA || path.join(REPO_ROOT, 'data'));
  const desktop = env.STARFALL_DESKTOP === '1';
  return {
    port: Number(env.STARFALL_PORT) || DEFAULT_PORT,
    // 电脑版后台没有密码，只能听本机地址
    host: desktop ? '127.0.0.1' : env.STARFALL_HOST || '0.0.0.0',
    dataDir,
    adminDist: path.resolve(env.STARFALL_ADMIN_DIST || path.join(REPO_ROOT, 'apps/admin/dist')),
    overlayDist: path.resolve(env.STARFALL_OVERLAY_DIST || path.join(REPO_ROOT, 'apps/overlay/dist')),
    timeZone: env.STARFALL_TZ || 'Asia/Shanghai',
    trustProxy: desktop ? false : env.STARFALL_TRUST_PROXY || false,
    desktop,
  };
}

export const paths = (dataDir: string) => ({
  db: path.join(dataDir, 'starfall.db'),
  secretKey: path.join(dataDir, 'secret.key'),
  assets: path.join(dataDir, 'assets'),
  tmp: path.join(dataDir, 'tmp'),
  backups: path.join(dataDir, 'backups'),
});
