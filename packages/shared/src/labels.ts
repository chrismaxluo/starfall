// 给人看的名称（前后端共用，不依赖 Zod，管理后台和特效页可以单独引入）

/** 固定的身份档位 */
export const TIERS = ['gov', 'adm', 'cap', 'mod', 'nor'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_NAMES: Record<Tier, string> = { gov: '总督', adm: '提督', cap: '舰长', mod: '房管', nor: '普通观众' };

/** 事件最终的处理结果，写入事件记录 */
export const PLAY_STATUS = {
  played: '已播放',
  queued: '排队中',
  no_rule: '未命中规则',
  blacklist: '黑名单',
  paused: '已暂停',
  offline: '未开播',
  cooldown: '冷却中',
  once: '本场已播过',
  no_overlay: '特效页不在线',
  dropped: '队列已满，丢弃',
  cleared: '已清空',
  duplicate: '重复消息',
} as const;
export type PlayStatus = keyof typeof PLAY_STATUS;

export const POSITION_NAMES = { bl: '左下', br: '右下', top: '顶部', center: '居中' } as const;
