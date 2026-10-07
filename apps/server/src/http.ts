// 接口约定：出错时统一返回 { error: { code, message } }，message 是给人看的中文说明。
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { issueText } from './zod-text.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, 'invalid_input', first ? issueText(first) : '填的内容不正确', r.error.issues);
  }
  return r.data;
}

export function sendError(reply: FastifyReply, e: HttpError): FastifyReply {
  return reply.status(e.status).send({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}
