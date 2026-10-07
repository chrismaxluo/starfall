// B站扫码登录：申请二维码 → 每 2 秒查询一次状态 → 成功后保存（加密）。扫码弹窗和新手引导共用
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { get, post } from './api.ts';
import { refreshStatus } from './store.ts';
import { toast } from './toast.ts';

export type QrState = 'loading' | 'waiting' | 'scanned' | 'expired' | 'success' | 'error';

/** auto：挂载时就申请二维码；否则调用 start() 再申请 */
export function useQrLogin(onSuccess: () => void, auto = true) {
  const img = ref('');
  const st = ref<QrState>('loading');
  const err = ref('');
  /** 连着查询失败（断网、星临没在运行）：页面上提示，不要一直写「请扫一扫」 */
  const offline = ref(false);
  let fails = 0;
  let key = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  async function start(): Promise<void> {
    st.value = 'loading';
    try {
      const r = await post<{ key: string; image: string }>('/api/bili/qrcode');
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
      const r = await get<{ state: QrState; account?: { name: string } }>(`/api/bili/qrcode/${encodeURIComponent(key)}`);
      fails = 0;
      offline.value = false;
      st.value = r.state;
      if (r.state === 'success' || r.state === 'expired') stop();
      if (r.state === 'success') {
        await refreshStatus();
        toast(`已登录 B站账号：${r.account?.name ?? ''}`);
        onSuccess();
      }
    } catch {
      // 网络抖动时下次再查；连着 3 次失败才提示
      if (++fails >= 3) offline.value = true;
    }
  }
  onMounted(() => auto && void start());
  onBeforeUnmount(stop);
  return { img, st, err, offline, start, stop };
}
