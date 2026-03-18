import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { AuthorizationRequiredPayload, LinkPromptPayload, ToolResult } from '../types.js';

export function schemaToJsonSchema(schema: z.ZodTypeAny) {
  const jsonSchema = zodToJsonSchema(schema as any, { target: 'jsonSchema7' }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function toStructuredContent(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

export function structuredTextResult(text: string, structuredContent?: Record<string, unknown>, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    isError,
  };
}

export function textResult(payload: unknown): ToolResult {
  return structuredTextResult(JSON.stringify(payload, null, 2), toStructuredContent(payload));
}

export function markdownTextResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredTextResult(text, structuredContent);
}

export function plainTextResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredTextResult(text, structuredContent);
}

export function errorResult(message: string): ToolResult {
  return structuredTextResult(JSON.stringify({ error: message }), { error: message }, true);
}

export function buildGoogleAuthLinkPrompt(payload: {
  userId: string;
  authUrl: string;
  title?: string;
  message?: string;
  nextStep?: string;
}): LinkPromptPayload {
  return {
    status: 'authorization_link_ready',
    provider: 'google',
    userId: payload.userId,
    title: payload.title ?? '구글 MCP 연동을 시작하겠습니다.',
    message: payload.message ?? '아래 링크를 눌러 Google 계정을 연결해 주세요.',
    authUrl: payload.authUrl,
    markdownLink: `[구글 계정 연결 시작](${payload.authUrl})`,
    nextStep: payload.nextStep ?? '연결이 완료되면 원래 대화로 돌아와 다시 요청해 주세요.',
  };
}

export function formatGoogleAuthMarkdown(payload: LinkPromptPayload): string {
  const parts = [
    payload.title,
    '',
    payload.message,
  ];

  if (payload.markdownLink) {
    parts.push('', payload.markdownLink);
  }

  if (payload.nextStep) {
    parts.push('', `다음 단계: ${payload.nextStep}`);
  }

  return parts.join('\n');
}

export function buildShortGoogleAuthMessage(shortUrl: string, retryInstruction: string): string {
  return [
    'Google authorization required.',
    shortUrl,
    retryInstruction,
  ].join('\n');
}

export function authorizationRequiredResult(payload: AuthorizationRequiredPayload): ToolResult {
  return plainTextResult(buildShortGoogleAuthMessage(payload.authUrl, payload.retryInstruction), payload as unknown as Record<string, unknown>);
}
