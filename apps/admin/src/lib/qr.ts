// 扫码登录（B站、网易云）：申请二维码 → 每 2 秒查询一次状态 → 成功后保存（加密）。扫码弹窗、新手引导、点歌共用
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { get, post } from './api.ts';
import { music } from './music.ts';
import type { MusicAccountStatus } from './music.ts';
import { refreshStatus } from './store.ts';
import { toast } from './toast.ts';

/** 两种扫码：申请二维码、查询状态的接口，登录成功后做什么 */
const KINDS = {
  bili: {
    start: '/api/bili/qrcode',
    poll: (k: string) => `/api/bili/qrcode/${encodeURIComponent(k)}`,
    done: async (r: { account?: { name?: string } }) => {
      await refreshStatus();
      toast(`已登录 B站账号：${r.account?.name ?? ''}`);
    },
  },
  netease: {
    start: '/api/music/qrcode',
    poll: (k: string) => `/api/music/qrcode/${encodeURIComponent(k)}`,
    done: async (r: { account?: MusicAccountStatus }) => {
      if (r.account) music.account = r.account;
      toast(`已登录网易云：${r.account?.name ?? ''}${r.account?.vip ? '（会员）' : '（不是会员：会员歌放不了）'}`);
    },
  },
} as const;

export type QrState = 'loading' | 'waiting' | 'scanned' | 'expired' | 'success' | 'error';

/** auto：挂载时就申请二维码；否则调用 start() 再申请 */
export function useQrLogin(onSuccess: () => void, auto = true, kind: keyof typeof KINDS = 'bili') {
  const api = KINDS[kind];
  const img = ref('');
  const st = ref<QrState>('loading');
  const err = ref('');
  /** 连着查询失败（断网、星临没在运行）：页面上提示，不要一直写「请扫一扫」 */
  const offline = ref(false);
  let fails = 0;
  let key = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 窗口已经关了：还没回来的二维码请求回来后不再开始查询 */
  let closed = false;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  async function start(): Promise<void> {
    st.value = 'loading';
    try {
      const r = await post<{ key: string; image: string }>(api.start);
      if (closed) return;
      key = r.key;
      img.value = r.image;
      st.value = 'waiting';
      fails = 0;
      offline.value = false;
      stop();
      timer = setInterval(poll, 2000);
    } catch (e) {
      st.value = 'error';
      err.value = e instanceof Error ? e.message : String(e);
    }
  }
  async function poll(): Promise<void> {
    try {
      const r = await get<{ state: QrState; account?: MusicAccountStatus }>(api.poll(key));
      fails = 0;
      offline.value = false;
      st.value = r.state;
      if (r.state === 'success' || r.state === 'expired') stop();
      if (r.state === 'success') {
        await api.done(r);
        onSuccess();
      }
    } catch {
      // 网络抖动时下次再查；连着 3 次失败才提示
      if (++fails >= 3) offline.value = true;
    }
  }
  onMounted(() => auto && void start());
  onBeforeUnmount(() => {
    closed = true;
    stop();
  });
  return { img, st, err, offline, start, stop };
}
