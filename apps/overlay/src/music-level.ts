// 点歌窗口的音量均衡：不同的歌录得有响有轻，换歌时音量会忽大忽小。
// 网易云给的响度信息是空的，所以边放边测：播放器的声音先经过一个分析器量出有多响（按音量滑块换算回原始响度），
// 和目标响度比，慢慢调一个增益。只往小调、不往大调：以前偏轻的歌会被调大，鼓点、高音这些最响的瞬间冲出上限，
// 后面的限幅器（浏览器自带的压缩器）压不干净，听起来破音。只调小就不会冲出上限，也不用再接限幅器
// 用的是浏览器的音频处理（Web Audio）：音乐地址必须允许跨域读取（网易云和星临自己的文件都允许），
// 而且音频处理要能马上开始（直播软件里可以）；条件不满足时不接，这首歌照常播放，只是不均衡。

/** 目标响度（dBFS，按 RMS 算）：流行歌通常在 -12 到 -9，老歌、轻音乐在 -20 左右 */
export const LEVEL_TARGET_DB = -14;
/** 最多调小多少 dB；不调大（见开头） */
export const LEVEL_MIN_DB = -9;
export const LEVEL_MAX_DB = 0;
/** 比这更轻的片段（前奏、间奏、静音）不算 */
const SILENCE = 0.004;

/** 按测到的响度算该调多少 dB */
export function levelGainDb(loudDb: number): number {
  return Math.min(LEVEL_MAX_DB, Math.max(LEVEL_MIN_DB, LEVEL_TARGET_DB - loudDb));
}

/** 一段采样的 RMS（按音量滑块换算回原始响度；太轻的返回 null） */
export function rmsOf(buf: Float32Array, volume: number): number | null {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  // 正在淡入淡出、音量几乎为 0 时量不准，不算
  if (volume < 0.02) return null;
  const rms = Math.sqrt(sum / buf.length) / volume;
  return rms < SILENCE ? null : rms;
}

export class Leveler {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private el: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loud: number | null = null;
  private since = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  enabled = true;

  /** 音频处理能不能马上开始（不能的话不接，免得没声音） */
  private ready(): boolean {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  /** 把这个播放器接进来；返回有没有接上 */
  attach(el: HTMLAudioElement): boolean {
    this.detach();
    if (!this.enabled || !this.ready() || !this.ctx) return false;
    try {
      const ctx = this.ctx;
      this.source = ctx.createMediaElementSource(el);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.gain = ctx.createGain();
      this.source.connect(this.analyser);
      this.analyser.connect(this.gain);
      this.gain.connect(ctx.destination);
      this.el = el;
      this.loud = null;
      this.since = performance.now();
      this.timer = setInterval(() => this.step(), 250);
      return true;
    } catch {
      this.detach();
      return false;
    }
  }

  /** 有没有接着播放器（这首歌的声音正经过音频处理） */
  active(): boolean {
    return this.el !== null;
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.source?.disconnect();
    } catch {
      /* 已经断开 */
    }
    this.source = this.analyser = this.gain = null;
    this.el = null;
  }

  /** 关掉均衡时：增益慢慢回到 1 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.gain && this.ctx) this.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.5);
  }

  /** 每 0.25 秒量一次：刚开始的 4 秒跟得快（尽快调到位），之后跟得慢（不会一会儿大一会儿小） */
  private step(): void {
    const { el, analyser, gain, ctx } = this;
    if (!el || !analyser || !gain || !ctx || el.paused || !this.enabled) return;
    analyser.getFloatTimeDomainData(this.buf);
    const rms = rmsOf(this.buf, el.volume);
    if (rms === null) return;
    const db = 20 * Math.log10(rms);
    const fast = performance.now() - this.since < 4000;
    this.loud = this.loud === null ? db : this.loud + (db - this.loud) * (fast ? 0.3 : 0.04);
    gain.gain.setTargetAtTime(10 ** (levelGainDb(this.loud) / 20), ctx.currentTime, fast ? 0.3 : 1.5);
  }
}
