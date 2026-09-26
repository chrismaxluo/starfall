// 加密：B 站登录信息等敏感数据用 AES-256-GCM 加密后存入数据库。
// 密钥保存在 data/secret.key（权限 600），首次启动时生成，不随配置导出，也不备份到外部。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Secret {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('密钥长度必须为 32 字节');
    this.key = key;
  }

  /** 读取密钥文件，不存在时生成 */
  static load(file: string): Secret {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    return new Secret(Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'));
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }

  decrypt(token: string): string {
    const [v, iv, tag, data] = token.split('.');
    if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('无法识别的密文格式');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  }

  /** 签名（用于后台登录会话） */
  hmac(data: string): string {
    return crypto.createHmac('sha256', this.key).update(data).digest('base64url');
  }
}
