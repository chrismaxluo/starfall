import { describe, expect, it } from 'vitest';
import { compareVersions, planCleanup, shouldReplaceBeta, ymlVersion } from './release-r2.mjs';

const exe = (v) => [`desktop/Starfall-${v}-win-x64-setup.exe`, `desktop/Starfall-${v}-win-x64-setup.exe.blockmap`];

describe('备用下载地址：版本号', () => {
  it('和 semver 一样比较：测试版比同号正式版旧，beta.10 比 beta.9 新', () => {
    const sorted = ['1.10.0', '1.8.0-beta.1', '1.9.0', '1.8.0', '1.9.0-beta.10', '1.9.0-beta.9', 'v1.7.1'].sort(
      compareVersions,
    );
    expect(sorted).toEqual(['v1.7.1', '1.8.0-beta.1', '1.8.0', '1.9.0-beta.9', '1.9.0-beta.10', '1.9.0', '1.10.0']);
    expect(compareVersions('1.8.0', 'v1.8.0')).toBe(0);
    expect(() => compareVersions('1.8', '1.8.0')).toThrow();
  });

  it('读 latest.yml 里的版本号', () => {
    expect(ymlVersion('version: 1.8.0\nfiles:\n  - url: x.exe\n')).toBe('1.8.0');
    expect(ymlVersion("version: '1.9.0-beta.1'\n")).toBe('1.9.0-beta.1');
    expect(ymlVersion('files: []\n')).toBeNull();
  });

  it('beta.yml 原来没有或比这次旧才换', () => {
    expect(shouldReplaceBeta('1.8.0', null)).toBe(true);
    expect(shouldReplaceBeta('1.9.0-beta.1', 'version: 1.8.0\n')).toBe(true);
    expect(shouldReplaceBeta('1.9.0', 'version: 1.9.0-beta.2\n')).toBe(true);
    // 出了更新的测试版以后才发的旧版本修复，测试版用户不退回去
    expect(shouldReplaceBeta('1.8.1', 'version: 1.9.0-beta.1\n')).toBe(false);
  });
});

describe('备用下载地址：删旧版本', () => {
  it('正式版留最近 3 个，测试版只留比正式版新的最新 1 个；别的文件不动', () => {
    const keys = [
      ...['1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.8.0-beta.2', '1.9.0-beta.1', '1.9.0-beta.2'].flatMap(exe),
      'desktop/latest.yml',
      'desktop/beta.yml',
      'server/starfall.bundle',
    ];
    expect(planCleanup(keys, '1.9.0-beta.2')).toEqual([
      ...exe('1.5.0'),
      ...exe('1.8.0-beta.2'),
      ...exe('1.9.0-beta.1'),
    ]);
  });

  it('正式版发布后，同号和更旧的测试版都删掉', () => {
    const keys = ['1.8.0', '1.9.0-beta.3', '1.9.0'].flatMap(exe);
    expect(planCleanup(keys, '1.9.0')).toEqual(exe('1.9.0-beta.3'));
  });

  it('刚发布的版本一定留着（例如给旧版本补发的修复）', () => {
    const keys = ['1.7.0', '1.8.0', '1.9.0', '2.0.0', '1.6.5'].flatMap(exe);
    expect(planCleanup(keys, '1.6.5')).toEqual(exe('1.7.0'));
  });
});
