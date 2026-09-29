// 特效页、管理后台的版本：从构建好的入口页里读出入口脚本名（带哈希）。
// 重新构建后版本变化：在线的旧特效页会在空闲时自动刷新（直播软件里不用手动刷新浏览器源），旧后台页面顶部提示刷新。
import fs from 'node:fs';
import path from 'node:path';
import { OVERLAY_BUILD_RE } from '@starfall/shared';

export class BuildVersion {
  private readonly file: string;
  private cached: { mtimeMs: number; build: string | null } | null = null;

  constructor(dist: string) {
    this.file = path.join(dist, 'index.html');
  }

  /** 现在的版本；还没构建时为 null */
  current(): string | null {
    try {
      const st = fs.statSync(this.file);
      if (this.cached?.mtimeMs !== st.mtimeMs) this.cached = { mtimeMs: st.mtimeMs, build: fs.readFileSync(this.file, 'utf8').match(OVERLAY_BUILD_RE)?.[0] ?? null };
      return this.cached.build;
    } catch {
      return null;
    }
  }

  /** 定时检查，版本变了就回调（重新构建特效页后不用重启服务）。返回停止函数 */
  watch(onChange: (build: string) => void, intervalMs = 10_000): () => void {
    let last = this.current();
    const timer = setInterval(() => {
      const b = this.current();
      if (b && b !== last) onChange(b);
      last = b ?? last;
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
