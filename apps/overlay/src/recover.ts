// 直播软件比星临先打开时自动连上：在直播软件里登记「看门程序」（public/sw.js）。
// 之后再打开特效页时星临还没运行，直播软件会先显示透明的等待页，星临一开就自动换成特效页，不用手动刷新。
// 浏览器只在本机地址（127.0.0.1）和 https 下允许登记；服务器版用 http://IP 访问时用不了，
// 不过服务器一直开着，本来也用不上

/** 能不能自动连上：true 已登记，false 这个直播软件不支持，null 还在登记（或开发模式） */
let state: boolean | null = null;

export function recoverState(): boolean | null {
  return state;
}

/** 登记好（或者失败）时完成；最多等 waitMs，不耽误特效页启动 */
export function setupRecover(waitMs = 1500): Promise<void> {
  if (import.meta.env.DEV) return Promise.resolve();
  const sw = (navigator as Partial<Navigator>).serviceWorker;
  if (!sw || !isSecureContext) {
    state = false;
    return Promise.resolve();
  }
  // 这次就是经它打开的：直播软件关掉再开它还在
  if (sw.controller) state = true;
  const done = sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then(
    () => void (state = true),
    (e: unknown) => {
      state = false;
      console.warn('[星临] 没能开启自动连接（直播软件比星临先打开时需要手动刷新）', e);
    },
  );
  return Promise.race([done, new Promise<void>((r) => setTimeout(r, waitMs))]);
}
