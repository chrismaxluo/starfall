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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.STARFALL_DATA || path.join(REPO_ROOT, 'data'));
  return {
    port: Number(env.STARFALL_PORT) || DEFAULT_PORT,
    host: env.STARFALL_HOST || '0.0.0.0',
    dataDir,
    adminDist: path.join(REPO_ROOT, 'apps/admin/dist'),
    overlayDist: path.join(REPO_ROOT, 'apps/overlay/dist'),
  };
}

export const paths = (dataDir: string) => ({
  db: path.join(dataDir, 'starfall.db'),
  secretKey: path.join(dataDir, 'secret.key'),
  assets: path.join(dataDir, 'assets'),
  tmp: path.join(dataDir, 'tmp'),
  backups: path.join(dataDir, 'backups'),
});
