// 上传前在浏览器里先检查：格式、大小（不然大文件传到一半被拒，看到的会是"连不上服务"）
import { MAX_UPLOAD_BYTES } from '@starfall/shared/labels';
import { fileSize } from './format.ts';

export const ANIM_EXT = ['webm', 'mp4', 'svga', 'json', 'gif', 'png', 'apng', 'webp', 'jpg', 'jpeg'];
export const AUDIO_EXT = ['mp3', 'wav', 'ogg'];

/** 有问题时返回给主播看的说明，没问题返回 null；kind 是要传的种类 */
export function checkFile(f: File, kind: 'anim' | 'audio' | 'any' = 'any'): string | null {
  const ext = (/\.([^.]+)$/.exec(f.name)?.[1] ?? '').toLowerCase();
  const ok = kind === 'anim' ? ANIM_EXT : kind === 'audio' ? AUDIO_EXT : [...ANIM_EXT, ...AUDIO_EXT];
  if (!ok.includes(ext)) {
    if (['mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'].includes(ext)) return `「${f.name}」是 ${ext.toUpperCase()} 视频，星临用不了：请转成透明 WebM（推荐）或 MP4 再传`;
    return `「${f.name}」的格式用不了。${kind === 'audio' ? '音效支持 MP3、WAV、OGG' : '动画支持 WebM、MP4、SVGA、Lottie（.json）、GIF、PNG、APNG、WebP、JPG'}`;
  }
  if (f.size > MAX_UPLOAD_BYTES) return `「${f.name}」太大了（${fileSize(f.size)}），单个文件不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
  return null;
}
