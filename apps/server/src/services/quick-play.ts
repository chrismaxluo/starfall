// 素材快捷播放：主播在后台点按钮或按快捷键，马上在直播画面上播放选好的素材。
// 按钮列表整体保存（顺序、名字、快捷键一起改）；第一次使用时把弹幕规则里用到的素材放进去。
import { asc } from 'drizzle-orm';
import type { QuickButton, QuickButtonsInput } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { quickPlay, ruleDanmu } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { checkEffectIds } from './rules.ts';
import type { SettingsStore } from './settings.ts';

/** 已经放过默认按钮（之后删光了也不再自动放） */
const SEEDED_KEY = 'quickPlaySeeded';

export class QuickPlayStore {
  private readonly db: Db;
  private readonly settings: SettingsStore;

  constructor(db: Db, settings: SettingsStore) {
    this.db = db;
    this.settings = settings;
  }

  list(): QuickButton[] {
    return this.db.select().from(quickPlay).orderBy(asc(quickPlay.sort), asc(quickPlay.id)).all().map(({ sort: _s, ...b }) => b);
  }

  get(id: number): QuickButton {
    const b = this.list().find((x) => x.id === id);
    if (!b) throw new HttpError(404, 'not_found', '这个按钮已经删掉了，请刷新页面');
    return b;
  }

  /** 整体替换（按给出的顺序） */
  save(buttons: QuickButtonsInput): QuickButton[] {
    checkEffectIds(this.db, buttons.map((b) => b.effectId));
    this.db.transaction((tx) => {
      tx.delete(quickPlay).run();
      buttons.forEach((b, i) => tx.insert(quickPlay).values({ ...b, sort: i + 1 }).run());
    });
    this.settings.setRaw(SEEDED_KEY, true);
    return this.list();
  }

  /** 第一次使用：弹幕规则里用到的素材（按规则顺序、去掉重复），快捷键依次是 1–9 */
  seedOnce(): void {
    if (this.settings.getRaw<boolean>(SEEDED_KEY)) return;
    const ids = [...new Set(this.db.select({ effectId: ruleDanmu.effectId }).from(ruleDanmu).orderBy(asc(ruleDanmu.sort), asc(ruleDanmu.id)).all().map((r) => r.effectId))].filter((id): id is number => id !== null);
    this.save(ids.slice(0, 20).map((effectId, i) => ({ effectId, label: '', hotkey: i < 9 ? String(i + 1) : null, globalHotkey: null })));
  }
}
