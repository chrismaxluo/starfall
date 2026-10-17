// 本机服务用哪个端口。直播软件里填的特效地址带着端口，端口一变就连不上，所以：
// - 每次都先用 17520（大部分人地址里是它）；用不了再试以前用过的，再往后找空的；
// - 以前用过、这次也空着的端口一起开着（服务同时接收，见 server/src/extra-ports.ts），直播软件里填的是哪个都能连上。
// 这里不碰 Electron，方便单独测试（main.ts 用）

export const HOME_PORT = 17520;
/** 最多记住几个用过的端口 */
const KEEP = 4;
/** 往后找空端口最多找几个 */
const SCAN = 20;

export interface PortPlan {
  /** 这次用的端口 */
  port: number;
  /** 同时接收连接的以前用过的端口 */
  extra: number[];
  /** 记下来的用过的端口（新的在前），下次启动传回来 */
  used: number[];
}

/** used：以前用过的端口（新的在前）；canListen：这个端口现在能不能用 */
export async function planPorts(used: number[], canListen: (p: number) => Promise<boolean>, home = HOME_PORT): Promise<PortPlan> {
  const order = [home, ...used.filter((p) => p !== home)];
  for (let p = home + 1; p < home + SCAN; p++) if (!order.includes(p)) order.push(p);
  let port: number | null = null;
  for (const p of order) {
    if (await canListen(p)) {
      port = p;
      break;
    }
  }
  if (port === null) throw new Error(`端口 ${home}–${home + SCAN - 1} 都被占用了`);
  const extra: number[] = [];
  for (const p of used) if (p !== port && !extra.includes(p) && (await canListen(p))) extra.push(p);
  return { port, extra, used: [port, ...used.filter((p) => p !== port)].slice(0, KEEP) };
}

/** 特效页没连上时怎么办：端口变了要换地址，否则多半是先开了直播软件，刷新一下 */
export function fixText(app: string, port: number, home = HOME_PORT): string {
  if (port !== home) return `这次 ${home} 端口被别的程序占用，星临临时改用 ${port}：到「直播软件输出」复制新地址，换掉${app}里的特效地址（以后新旧地址都能连上）。`;
  return `在${app}里右键特效源，点「刷新」。（先开直播软件、后开星临时会这样）`;
}
