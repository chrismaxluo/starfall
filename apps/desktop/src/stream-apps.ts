// 直播软件开着没有：main.ts 用 Windows 自带的 tasklist 列出正在运行的程序，这里按程序名认出直播软件（不碰 Electron，方便单独测试）

/** 程序名（小写）→ 显示的名字 */
export const STREAM_APPS: Record<string, string> = {
  'livehime.exe': '直播姬',
  'obs64.exe': 'OBS',
  'obs32.exe': 'OBS',
  'obs.exe': 'OBS',
};

/** 从 `tasklist /FO CSV /NH` 的输出里找直播软件，返回显示的名字；都没开为 null */
export function findStreamApp(csv: string): string | null {
  for (const line of csv.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim());
    const name = m ? STREAM_APPS[m[1]!.toLowerCase()] : undefined;
    if (name) return name;
  }
  return null;
}
