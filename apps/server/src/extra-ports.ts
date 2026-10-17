// 桌面版：除了这次用的端口，在以前用过的端口上也接收连接，交给同一个服务处理。
// 端口被占用、换过端口时，直播软件里填的可能还是旧地址；新旧地址都能连上，就不用改来改去
import net from 'node:net';
import type { Server } from 'node:http';

/** 开不成的端口（这次被占用）调用 onError，不影响其他端口。返回关闭函数 */
export function listenExtra(server: Server, ports: number[], host: string, onError: (port: number, e: Error) => void): () => void {
  const list = ports.map((port) => {
    const s = net.createServer((sock) => server.emit('connection', sock));
    s.on('error', (e) => onError(port, e));
    s.listen(port, host);
    return s;
  });
  return () => {
    for (const s of list) s.close();
  };
}

/** 环境变量 STARFALL_EXTRA_PORTS（逗号分隔）里的端口，去掉格式不对的和主端口 */
export function parseExtraPorts(value: string | undefined, main: number): number[] {
  const ports = (value ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536 && p !== main);
  return [...new Set(ports)];
}
