import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hub } from './hub.ts';
import { BuildVersion } from './build-version.ts';

const html = (name: string) => `<!doctype html><script type="module" crossorigin src="/overlay/assets/${name}"></script>`;

describe('特效页、后台的版本', () => {
  afterEach(() => vi.useRealTimers());

  it('从入口页读出入口脚本名，重新构建后变化；没构建时为 null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ov-'));
    const b = new BuildVersion(dir);
    expect(b.current()).toBeNull();
    fs.writeFileSync(path.join(dir, 'index.html'), html('index-Ab_1.js'));
    expect(b.current()).toBe('index-Ab_1.js');
    fs.writeFileSync(path.join(dir, 'index.html'), html('index-Cd-2.js'));
    fs.utimesSync(path.join(dir, 'index.html'), new Date(), new Date(Date.now() + 5000));
    expect(b.current()).toBe('index-Cd-2.js');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('定时检查：版本变了才通知', () => {
    vi.useFakeTimers();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ov-'));
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, html('index-a.js'));
    const got: string[] = [];
    const stop = new BuildVersion(dir).watch((v) => got.push(v), 1000);
    vi.advanceTimersByTime(3000);
    expect(got).toEqual([]);
    fs.writeFileSync(file, html('index-b.js'));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(3000);
    expect(got).toEqual(['index-b.js']);
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('特效页连接时告诉它现在的版本', () => {
    const sent: string[] = [];
    const hub = new Hub({ build: () => 'index-x.js' });
    const output = { id: 1, name: '竖屏', app: 'livehime', orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9, scale: 100, liteMode: 'auto' } as never;
    hub.addOverlay({ send: (d) => sent.push(d), close: () => undefined }, output, []);
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: 'hello', build: 'index-x.js' });
  });
});
