// 弹幕点歌的设置：Zod 定义，接口校验和类型共用。
import { z } from 'zod';
import { DANMU_WHO_ALL, DanmuWhoSchema, QUICK_GLOBAL_RE } from './rules.ts';

/** 指令：1 – 8 个字，不能有空格（观众发「点歌 歌名」，指令后面是歌名） */
const Cmd = z
  .string()
  .trim()
  .min(1, '指令不能为空')
  .max(8, '指令最多 8 个字')
  .refine((s) => !/\s/.test(s), '指令里不能有空格');

export const MUSIC_BANNED_MAX = 500;
export const MUSIC_STYLES = ['card', 'vinyl', 'capsule', 'glass', 'journal', 'minimal'] as const;
export const MUSIC_WORDS_MAX = 100;

export const MusicSettingsSchema = z
  .object({
    /** 点歌总开关：关着时不理会点歌弹幕，正在放的也停下 */
    enabled: z.boolean(),
    cmdRequest: Cmd,
    cmdSkip: Cmd,
    cmdCancel: Cmd,
    /** 观众查自己点的歌排第几、还要等多久 */
    cmdMine: Cmd,
    /** 谁能点歌（和弹幕规则同样的选法） */
    who: DanmuWhoSchema,
    /** 每人同时最多排几首 */
    perUser: z.number().int().min(1).max(10),
    /** 同一个人两次点歌至少隔多少秒 */
    userCdSec: z.number().int().min(0).max(3600),
    /** 列表最多几首（不算正在放的） */
    queueMax: z.number().int().min(1).max(100),
    /** 歌最长几秒，超过的不收 */
    maxDurationSec: z.number().int().min(60).max(3600),
    /** 同一首歌放过之后多少分钟内不能再点（0 为不限） */
    repeatMin: z.number().int().min(0).max(1440),
    /** 大航海点的歌排在普通观众前面 */
    guardFirst: z.boolean(),
    /** 谁能切歌：点这首歌的人、房管（主播一直能切） */
    skipByRequester: z.boolean(),
    skipByMod: z.boolean(),
    /** 歌从哪里找：网易云、本地歌库；两个都开时 localFirst 决定先找哪个 */
    sourceNetease: z.boolean(),
    sourceLocal: z.boolean(),
    localFirst: z.boolean(),
    /** 音量 0 – 100 */
    volume: z.number().int().min(0).max(100),
    /** 音量均衡：边放边测每首歌有多响，太响的调小、太轻的调大 */
    normalize: z.boolean(),
    /** 有带声音的特效时把音乐调小；duckPct 是调到原来的百分之几 */
    duck: z.boolean(),
    duckPct: z.number().int().min(0).max(90),
    /** 下播后自动暂停，下次开播接着放 */
    autoPause: z.boolean(),
    // 画面
    /** 点歌窗口的样子：常规的玻璃卡片、黑胶唱片、细长胶囊；风格样式流光、手帐（日系）、灵动岛 */
    style: z.enum(MUSIC_STYLES),
    side: z.enum(['left', 'right']),
    size: z.enum(['normal', 'large']),
    showQueue: z.number().int().min(0).max(5),
    lyrics: z.boolean(),
    lyricsTrans: z.boolean(),
    /** 不收的歌：歌名或歌手里有这些字 */
    blockWords: z.array(z.string().trim().min(1).max(30)).max(MUSIC_WORDS_MAX),
    /** 不收的某一首歌（列表、历史里点「这首歌以后不收」）：按这一首本身记，别的版本、名字相近的歌不受影响 */
    blockSongs: z.array(z.object({ source: z.enum(['netease', 'local']), id: z.string().min(1).max(40), name: z.string().max(200) }).strict()).max(MUSIC_WORDS_MAX),
    /** 不让点歌的观众 */
    bannedUids: z.array(z.number().int().positive()).max(MUSIC_BANNED_MAX),
    /** 桌面版的全局快捷键：切歌、暂停 / 继续（例如 Ctrl+Alt+N），不用时为 null */
    hotkeySkip: z.string().regex(QUICK_GLOBAL_RE, '快捷键要按住 Ctrl、Alt 或 Shift 再按一个数字、字母或 F1–F12').nullable(),
    hotkeyPause: z.string().regex(QUICK_GLOBAL_RE, '快捷键要按住 Ctrl、Alt 或 Shift 再按一个数字、字母或 F1–F12').nullable(),
  })
  .strict();
export type MusicSettings = z.infer<typeof MusicSettingsSchema>;
export const MusicSettingsPatchSchema = MusicSettingsSchema.partial().strict();

export const MUSIC_DEFAULTS: MusicSettings = {
  enabled: false,
  cmdRequest: '点歌',
  cmdSkip: '切歌',
  cmdCancel: '取消点歌',
  cmdMine: '我的歌',
  who: DANMU_WHO_ALL,
  perUser: 1,
  userCdSec: 30,
  queueMax: 20,
  maxDurationSec: 420,
  repeatMin: 30,
  guardFirst: true,
  skipByRequester: true,
  skipByMod: true,
  sourceNetease: true,
  sourceLocal: true,
  localFirst: true,
  volume: 70,
  normalize: true,
  duck: true,
  duckPct: 30,
  autoPause: true,
  style: 'glass',
  side: 'left',
  size: 'normal',
  showQueue: 3,
  lyrics: true,
  lyricsTrans: true,
  blockWords: [],
  blockSongs: [],
  bannedUids: [],
  hotkeySkip: null,
  hotkeyPause: null,
};
