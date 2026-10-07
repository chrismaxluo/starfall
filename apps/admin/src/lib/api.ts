// 调用服务端接口。出错时抛出 ApiError，message 是服务端给的中文说明。
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 未登录（会话过期、密码被修改）时的处理，由 App 设置 */
let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function parse<T>(res: Response, url: string): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* 不是 JSON */
  }
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && url !== '/api/auth/login') onUnauthorized();
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `请求失败（${res.status}）`, e?.details);
  }
  return body as T;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', '连不上星临：请检查网络，或者星临有没有在运行');
  }
  return parse<T>(res, url);
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T>(url: string, body: unknown) => api<T>('PUT', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);

/** 上传文件（表单字段 file），onProgress 为 0 ~ 1 */
export function upload<T>(url: string, file: File, onProgress?: (p: number) => void, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const res = new Response(xhr.responseText, { status: xhr.status });
      parse<T>(res, url).then(resolve, reject);
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', '上传失败：连不上星临服务'));
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
