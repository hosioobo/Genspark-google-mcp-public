import { z } from 'zod';
import { google } from 'googleapis';
import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { errorResult, schemaToJsonSchema, structuredTextResult, textResult } from './helpers.js';
import { resolveGoogleFileReference } from './googleFileReferences.js';
import {
  buildSpreadsheetReadPayload,
  formatSpreadsheetReadText,
  isOfficeSpreadsheetMimeType,
  parseSpreadsheetBuffer,
} from './spreadsheetFiles.js';

const docsReadSchema = z.object({ documentId: z.string().min(1) });
const docsWriteSchema = z.object({ documentId: z.string().optional(), name: z.string().min(1).optional(), content: z.string() });
const sheetsReadSchema = z.object({ spreadsheetId: z.string().min(1), range: z.string().default('A1:Z100') });
const sheetsWriteSchema = z.object({
  spreadsheetId: z.string().optional(),
  name: z.string().min(1),
  range: z.string().optional(),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});
const slidesReadSchema = z.object({ presentationId: z.string().min(1) });
const slidesWriteSchema = z.object({ presentationId: z.string().optional(), name: z.string().min(1), slides: z.array(z.object({ title: z.string(), body: z.string().optional() })) });

function extractTextRuns(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => extractTextRuns(item, out));
    return;
  }
  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const textRun = record.textRun;
  if (textRun && typeof textRun === 'object' && typeof (textRun as { content?: unknown }).content === 'string') {
    out.push((textRun as { content: string }).content);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'textRun') continue;
    extractTextRuns(value, out);
  }
}

function extractDocumentText(document: { body?: { content?: unknown[] } }): string {
  const out: string[] = [];
  extractTextRuns(document.body?.content ?? [], out);
  return out.join('').trim();
}

function buildGoogleDocWebViewLink(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

function buildGoogleSheetWebViewLink(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function canDownload(metadata: { capabilities?: { canDownload?: boolean | null } | null }): boolean {
  return metadata.capabilities?.canDownload !== false;
}

async function docsRead(input: z.infer<typeof docsReadSchema>, ctx: ToolContext): Promise<ToolResult> {
  const reference = resolveGoogleFileReference(input.documentId);
  const docs = google.docs({ version: 'v1', auth: ctx.oauthClient });
  const document = (await docs.documents.get({ documentId: reference.fileId })).data;
  const payload = {
    documentId: reference.fileId,
    title: document.title ?? 'Untitled Document',
    content: extractDocumentText(document),
    webViewLink: buildGoogleDocWebViewLink(reference.fileId),
  };
  return structuredTextResult([
    `documentId: ${payload.documentId}`,
    `title: ${payload.title}`,
    `webViewLink: ${payload.webViewLink}`,
    '',
    payload.content || '(Document is empty)',
  ].join('\n'), payload);
}

async function docsWrite(input: z.infer<typeof docsWriteSchema>, ctx: ToolContext): Promise<ToolResult> {
  const docs = google.docs({ version: 'v1', auth: ctx.oauthClient });
  const targetDocumentId = input.documentId ? resolveGoogleFileReference(input.documentId).fileId : undefined;

  if (!targetDocumentId) {
    if (!input.name) throw new Error('name is required when creating a Google Doc');
    const created = await docs.documents.create({ requestBody: { title: input.name } });
    const documentId = created.data.documentId;
    if (!documentId) throw new Error('Failed to create Google Doc');
    await docs.documents.batchUpdate({ documentId, requestBody: { requests: [{ insertText: { location: { index: 1 }, text: input.content } }] } });
    const payload = {
      status: 'created',
      documentId,
      title: input.name,
      updated: false,
      webViewLink: buildGoogleDocWebViewLink(documentId),
    };
    return structuredTextResult([
      `status: ${payload.status}`,
      `documentId: ${payload.documentId}`,
      `title: ${payload.title}`,
      `webViewLink: ${payload.webViewLink}`,
    ].join('\n'), payload);
  }

  await docs.documents.batchUpdate({
    documentId: targetDocumentId,
    requestBody: { requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: 2_000_000 } } }, { insertText: { location: { index: 1 }, text: input.content } }] },
  }).catch(async () => {
    const existing = await docs.documents.get({ documentId: targetDocumentId });
    const endIndex = existing.data.body?.content?.at(-1)?.endIndex ?? 1;
    await docs.documents.batchUpdate({
      documentId: targetDocumentId,
      requestBody: {
        requests: [
          ...(endIndex > 1 ? [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] : []),
          { insertText: { location: { index: 1 }, text: input.content } },
        ],
      },
    });
  });
  const payload = {
    status: 'updated',
    documentId: targetDocumentId,
    title: input.name ?? 'Existing Google Doc',
    updated: true,
    webViewLink: buildGoogleDocWebViewLink(targetDocumentId),
  };
  return structuredTextResult([
    `status: ${payload.status}`,
    `documentId: ${payload.documentId}`,
    `title: ${payload.title}`,
    `webViewLink: ${payload.webViewLink}`,
  ].join('\n'), payload);
}

async function sheetsRead(input: z.infer<typeof sheetsReadSchema>, ctx: ToolContext): Promise<ToolResult> {
  const reference = resolveGoogleFileReference(input.spreadsheetId);
  const metadata = await ctx.drive.files.get({
    fileId: reference.fileId,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, webViewLink, capabilities(canDownload)',
  });
  const mimeType = metadata.data.mimeType ?? 'application/octet-stream';

  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const sheets = google.sheets({ version: 'v4', auth: ctx.oauthClient });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: reference.fileId, range: input.range });
    const payload = buildSpreadsheetReadPayload({
      spreadsheetId: reference.fileId,
      name: metadata.data.name,
      mimeType,
      range: input.range,
      source: 'google_sheets',
      values: response.data.values ?? [],
      webViewLink: metadata.data.webViewLink ?? buildGoogleSheetWebViewLink(reference.fileId),
    });
    return structuredTextResult(formatSpreadsheetReadText(payload), payload as unknown as Record<string, unknown>);
  }

  if (isOfficeSpreadsheetMimeType(mimeType)) {
    if (!canDownload(metadata.data)) {
      return errorResult(`Google Drive reports that this spreadsheet cannot be downloaded. fileId=${reference.fileId}`);
    }
    const response = await ctx.drive.files.get({ fileId: reference.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    try {
      const payload = parseSpreadsheetBuffer({
        buffer: Buffer.from(response.data as ArrayBuffer),
        spreadsheetId: reference.fileId,
        name: metadata.data.name,
        mimeType,
        range: input.range,
        webViewLink: metadata.data.webViewLink,
      });
      return structuredTextResult(formatSpreadsheetReadText(payload), payload as unknown as Record<string, unknown>);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : 'Failed to parse spreadsheet file');
    }
  }

  return errorResult(`This file is not a readable spreadsheet. mimeType=${mimeType}`);
}

async function sheetsWrite(input: z.infer<typeof sheetsWriteSchema>, ctx: ToolContext): Promise<ToolResult> {
  const sheets = google.sheets({ version: 'v4', auth: ctx.oauthClient });
  const targetSpreadsheetId = input.spreadsheetId ? resolveGoogleFileReference(input.spreadsheetId).fileId : undefined;

  if (!targetSpreadsheetId) {
    const created = await sheets.spreadsheets.create({ requestBody: { properties: { title: input.name } } });
    const spreadsheetId = created.data.spreadsheetId;
    if (!spreadsheetId) throw new Error('Failed to create spreadsheet');
    await sheets.spreadsheets.values.update({ spreadsheetId, range: input.range ?? 'A1', valueInputOption: 'RAW', requestBody: { values: input.values } });
    return textResult({ spreadsheetId, title: input.name });
  }

  return textResult((await sheets.spreadsheets.values.update({
    spreadsheetId: targetSpreadsheetId,
    range: input.range ?? 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: input.values },
  })).data);
}

async function slidesRead(input: z.infer<typeof slidesReadSchema>, ctx: ToolContext): Promise<ToolResult> {
  const reference = resolveGoogleFileReference(input.presentationId);
  const slides = google.slides({ version: 'v1', auth: ctx.oauthClient });
  return textResult((await slides.presentations.get({ presentationId: reference.fileId })).data);
}

async function slidesWrite(input: z.infer<typeof slidesWriteSchema>, ctx: ToolContext): Promise<ToolResult> {
  const slides = google.slides({ version: 'v1', auth: ctx.oauthClient });
  let presentationId = input.presentationId ? resolveGoogleFileReference(input.presentationId).fileId : undefined;
  if (!presentationId) {
    const created = await slides.presentations.create({ requestBody: { title: input.name } });
    presentationId = created.data.presentationId ?? undefined;
    if (!presentationId) throw new Error('Failed to create presentation');
  }

  const requests: any[] = [];
  input.slides.forEach((slide, index) => {
    const slideId = `slide_${index}_${Date.now()}`;
    const titleId = `title_${index}_${Date.now()}`;
    const bodyId = `body_${index}_${Date.now()}`;
    requests.push({ createSlide: { objectId: slideId, insertionIndex: index, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' } } });
    requests.push({ insertText: { objectId: titleId, text: slide.title } });
    if (slide.body) requests.push({ insertText: { objectId: bodyId, text: slide.body } });
  });
  if (requests.length > 0) {
    await slides.presentations.batchUpdate({ presentationId, requestBody: { requests } }).catch(() => undefined);
  }
  return textResult({ presentationId, updatedSlides: input.slides.length });
}

export const workspaceToolDefinitions: ToolDefinition[] = [
  { name: 'docs.read', description: 'Read a Google Doc from a document ID or Google Docs link.', inputSchema: schemaToJsonSchema(docsReadSchema) },
  { name: 'docs.write', description: 'Create or replace a Google Doc.', inputSchema: schemaToJsonSchema(docsWriteSchema) },
  { name: 'sheets.read', description: 'Read a Google Sheet or an uploaded Excel spreadsheet from an ID or Google Sheets link.', inputSchema: schemaToJsonSchema(sheetsReadSchema) },
  { name: 'sheets.write', description: 'Create or update a Google Sheet.', inputSchema: schemaToJsonSchema(sheetsWriteSchema) },
  { name: 'slides.read', description: 'Read Google Slides metadata from an ID or Google Slides link.', inputSchema: schemaToJsonSchema(slidesReadSchema) },
  { name: 'slides.write', description: 'Create or update a presentation with basic slide content.', inputSchema: schemaToJsonSchema(slidesWriteSchema) },
];

const handlers: Record<string, (input: unknown, ctx: ToolContext) => Promise<ToolResult>> = {
  'docs.read': (input, ctx) => docsRead(docsReadSchema.parse(input), ctx),
  'docs.write': (input, ctx) => docsWrite(docsWriteSchema.parse(input), ctx),
  'sheets.read': (input, ctx) => sheetsRead(sheetsReadSchema.parse(input), ctx),
  'sheets.write': (input, ctx) => sheetsWrite(sheetsWriteSchema.parse(input), ctx),
  'slides.read': (input, ctx) => slidesRead(slidesReadSchema.parse(input), ctx),
  'slides.write': (input, ctx) => slidesWrite(slidesWriteSchema.parse(input), ctx),
};

export async function executeWorkspaceTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult | null> {
  const handler = handlers[name];
  return handler ? handler(input, ctx) : null;
}
