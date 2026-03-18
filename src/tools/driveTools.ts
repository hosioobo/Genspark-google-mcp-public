import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { errorResult, schemaToJsonSchema, structuredTextResult, textResult } from './helpers.js';
import { resolveGoogleFileReference } from './googleFileReferences.js';
import { formatSpreadsheetReadText, isOfficeSpreadsheetMimeType, parseSpreadsheetBuffer } from './spreadsheetFiles.js';

const SEARCH_FETCH_LIMIT = 20;
const SEARCH_VISIBLE_LIMIT = 8;
const LIST_VISIBLE_LIMIT = 10;

const authToolSchema = z.object({});

const searchSchema = z.object({
  query: z.string().min(1),
  pageSize: z.number().int().min(1).max(100).default(10),
  pageToken: z.string().optional(),
  parentFolderId: z.string().optional(),
});
const metadataSchema = z.object({ fileId: z.string().min(1) });
const readSchema = z.object({ fileId: z.string().min(1), exportMimeType: z.string().optional() });
const writeSchema = z.object({
  fileId: z.string().optional(),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  content: z.string().optional(),
  parentFolderId: z.string().optional(),
  googleWorkspaceType: z.enum(['document', 'spreadsheet', 'presentation']).optional(),
});
const renameSchema = z.object({ fileId: z.string().min(1), newName: z.string().min(1) });
const moveSchema = z.object({ fileId: z.string().min(1), destinationFolderId: z.string().min(1) });
const copySchema = z.object({ fileId: z.string().min(1), newName: z.string().optional(), parentFolderId: z.string().optional() });
const createFolderSchema = z.object({ name: z.string().min(1), parentFolderId: z.string().optional() });
const listFolderChildrenSchema = z.object({
  folderId: z.string().min(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  pageToken: z.string().optional(),
});

type DriveFileSummary = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  parents?: string[] | null;
};

type DownloadCapabilityMetadata = {
  capabilities?: {
    canDownload?: boolean | null;
  } | null;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[\s_\-()[\].,]+/g, '');
}

function rankFileByQuery(file: DriveFileSummary, query: string): number {
  const name = file.name ?? '';
  const normalizedName = normalizeText(name);
  const normalizedQuery = normalizeText(query);

  if (!normalizedName) return 0;
  if (name === query) return 10_000;
  if (normalizedName === normalizedQuery) return 9_000;
  if (name.toLowerCase().startsWith(query.toLowerCase())) return 8_000;
  if (normalizedName.startsWith(normalizedQuery)) return 7_000;
  if (name.toLowerCase().includes(query.toLowerCase())) return 6_000;
  if (normalizedName.includes(normalizedQuery)) return 5_000;

  const queryTokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tokenHits = queryTokens.filter((token) => name.toLowerCase().includes(token.toLowerCase())).length;
  return tokenHits * 100;
}

function byRecentModifiedDesc(a: DriveFileSummary, b: DriveFileSummary): number {
  const left = Date.parse(a.modifiedTime ?? '') || 0;
  const right = Date.parse(b.modifiedTime ?? '') || 0;
  return right - left;
}

function rankFiles(files: DriveFileSummary[], query: string): DriveFileSummary[] {
  return [...files].sort((left, right) => {
    const scoreDiff = rankFileByQuery(right, query) - rankFileByQuery(left, query);
    if (scoreDiff !== 0) return scoreDiff;
    return byRecentModifiedDesc(left, right);
  });
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildSearchQuery(query: string, parentFolderId?: string): string {
  const escaped = escapeDriveQueryValue(query);
  const qParts = [
    'trashed = false',
    `(name contains '${escaped}' or fullText contains '${escaped}')`,
  ];

  if (parentFolderId) {
    qParts.push(`'${escapeDriveQueryValue(parentFolderId)}' in parents`);
  }

  return qParts.join(' and ');
}

function formatCompactFileListText(input: {
  files: DriveFileSummary[];
  totalMatches: number;
  visibleCount: number;
  truncated: boolean;
  nextPageToken: string | null;
  title: string;
}): string {
  const lines = [
    `${input.title} Found ${input.totalMatches} file(s) in this page.`,
    input.truncated
      ? `Showing the top ${input.visibleCount} ranked match(es). Reuse the file IDs below or request the next page.`
      : 'Reuse the exact file IDs below in later tool calls instead of repeating the same search.',
  ];

  if (input.files.length === 0) {
    lines.push('', 'No files matched.');
    return lines.join('\n');
  }

  input.files.forEach((file, index) => {
    lines.push(
      '',
      `${index + 1}. id=${file.id ?? '-'} | name=${file.name ?? '(untitled)'} | mimeType=${file.mimeType ?? 'unknown'} | modified=${file.modifiedTime ?? '-'}`,
    );
  });

  if (input.nextPageToken) {
    lines.push('', 'nextPageToken available in structuredContent');
  }

  return lines.join('\n');
}

function formatReadText(payload: { fileId: string; name?: string | null; mimeType: string; content: string; webViewLink?: string | null }): string {
  return [
    `fileId: ${payload.fileId}`,
    `name: ${payload.name ?? '(untitled)'}`,
    `mimeType: ${payload.mimeType}`,
    ...(payload.webViewLink ? [`webViewLink: ${payload.webViewLink}`] : []),
    '',
    payload.content,
  ].join('\n');
}

function canDownload(metadata: DownloadCapabilityMetadata): boolean {
  return metadata.capabilities?.canDownload !== false;
}

async function driveSearch(input: z.infer<typeof searchSchema>, ctx: ToolContext): Promise<ToolResult> {
  const requestedPageSize = input.pageSize;
  const fetchedPageSize = Math.min(Math.max(requestedPageSize, SEARCH_VISIBLE_LIMIT), SEARCH_FETCH_LIMIT);
  const response = await ctx.drive.files.list({
    q: buildSearchQuery(input.query, input.parentFolderId),
    pageSize: fetchedPageSize,
    pageToken: input.pageToken,
    corpora: 'allDrives',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'nextPageToken, files(id, name, mimeType, parents, webViewLink, modifiedTime, createdTime)',
  });

  const rankedFiles = rankFiles(response.data.files ?? [], input.query);
  const visibleFiles = rankedFiles.slice(0, SEARCH_VISIBLE_LIMIT);
  const payload = {
    query: input.query,
    requestedPageSize,
    fetchedPageSize,
    totalMatches: rankedFiles.length,
    returnedCount: visibleFiles.length,
    truncated: rankedFiles.length > visibleFiles.length || Boolean(response.data.nextPageToken),
    nextPageToken: response.data.nextPageToken ?? null,
    files: visibleFiles,
  };

  return structuredTextResult(
    formatCompactFileListText({
      title: 'Filename-prioritized search.',
      files: visibleFiles,
      totalMatches: payload.totalMatches,
      visibleCount: payload.returnedCount,
      truncated: payload.truncated,
      nextPageToken: payload.nextPageToken,
    }),
    payload,
  );
}

async function driveGetMetadata(input: z.infer<typeof metadataSchema>, ctx: ToolContext): Promise<ToolResult> {
  const reference = resolveGoogleFileReference(input.fileId);
  const response = await ctx.drive.files.get({
    fileId: reference.fileId,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, parents, webViewLink, webContentLink, modifiedTime, createdTime, size',
  });
  return textResult(response.data);
}

async function driveRead(input: z.infer<typeof readSchema>, ctx: ToolContext): Promise<ToolResult> {
  const reference = resolveGoogleFileReference(input.fileId);
  const metadata = await ctx.drive.files.get({
    fileId: reference.fileId,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, webViewLink, capabilities(canDownload)',
  });
  const mimeType = metadata.data.mimeType ?? 'application/octet-stream';

  if (mimeType.startsWith('application/vnd.google-apps')) {
    if (!canDownload(metadata.data)) {
      return errorResult(`Google Drive reports that this file cannot be downloaded or exported. fileId=${reference.fileId} mimeType=${mimeType}`);
    }
    const exportMimeType = input.exportMimeType ?? (
      mimeType === 'application/vnd.google-apps.document' ? 'text/plain' :
      mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' :
      'text/plain'
    );
    const response = await ctx.drive.files.export({ fileId: reference.fileId, mimeType: exportMimeType }, { responseType: 'text' });
    const payload = {
      fileId: reference.fileId,
      name: metadata.data.name,
      mimeType: exportMimeType,
      webViewLink: metadata.data.webViewLink,
      content: String(response.data ?? ''),
    };
    return structuredTextResult(formatReadText(payload), payload);
  }

  if (!canDownload(metadata.data)) {
    return errorResult(`Google Drive reports that this file cannot be downloaded or exported. fileId=${reference.fileId} mimeType=${mimeType}`);
  }

  const response = await ctx.drive.files.get({ fileId: reference.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data as ArrayBuffer);

  if (isOfficeSpreadsheetMimeType(mimeType)) {
    try {
      const payload = parseSpreadsheetBuffer({
        buffer,
        spreadsheetId: reference.fileId,
        name: metadata.data.name,
        mimeType,
        range: 'A1:Z100',
        webViewLink: metadata.data.webViewLink,
      });
      return structuredTextResult(formatSpreadsheetReadText(payload), payload as unknown as Record<string, unknown>);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : 'Failed to parse spreadsheet file');
    }
  }

  const text = mimeType.startsWith('text/') || mimeType === 'application/json'
    ? buffer.toString('utf8')
    : `[binary content omitted: ${buffer.byteLength} bytes, mimeType=${mimeType}]`;
  const payload = {
    fileId: reference.fileId,
    name: metadata.data.name,
    mimeType,
    webViewLink: metadata.data.webViewLink,
    content: text,
  };
  return structuredTextResult(formatReadText(payload), payload);
}

async function driveWrite(input: z.infer<typeof writeSchema>, ctx: ToolContext): Promise<ToolResult> {
  let mimeType = input.mimeType;
  if (!mimeType && input.googleWorkspaceType) {
    mimeType = {
      document: 'application/vnd.google-apps.document',
      spreadsheet: 'application/vnd.google-apps.spreadsheet',
      presentation: 'application/vnd.google-apps.presentation',
    }[input.googleWorkspaceType];
  }

  if (input.fileId) {
    const response = await ctx.drive.files.update({
      fileId: input.fileId,
      requestBody: { name: input.name },
      media: input.content !== undefined ? { mimeType: mimeType ?? 'text/plain', body: input.content } : undefined,
      supportsAllDrives: true,
      fields: 'id, name, mimeType, modifiedTime',
    });
    return textResult(response.data);
  }

  const response = await ctx.drive.files.create({
    requestBody: { name: input.name, mimeType, parents: input.parentFolderId ? [input.parentFolderId] : undefined },
    media: input.content !== undefined ? { mimeType: mimeType ?? 'text/plain', body: input.content } : undefined,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, parents, webViewLink',
  });
  return textResult(response.data);
}

async function driveRename(input: z.infer<typeof renameSchema>, ctx: ToolContext): Promise<ToolResult> {
  const response = await ctx.drive.files.update({
    fileId: input.fileId,
    requestBody: { name: input.newName },
    supportsAllDrives: true,
    fields: 'id, name, modifiedTime',
  });
  return textResult(response.data);
}

async function driveMove(input: z.infer<typeof moveSchema>, ctx: ToolContext): Promise<ToolResult> {
  const metadata = await ctx.drive.files.get({ fileId: input.fileId, supportsAllDrives: true, fields: 'parents' });
  const previousParents = (metadata.data.parents ?? []).join(',');
  const response = await ctx.drive.files.update({
    fileId: input.fileId,
    addParents: input.destinationFolderId,
    removeParents: previousParents || undefined,
    supportsAllDrives: true,
    fields: 'id, name, parents',
  });
  return textResult(response.data);
}

async function driveCopy(input: z.infer<typeof copySchema>, ctx: ToolContext): Promise<ToolResult> {
  const response = await ctx.drive.files.copy({
    fileId: input.fileId,
    requestBody: { name: input.newName, parents: input.parentFolderId ? [input.parentFolderId] : undefined },
    supportsAllDrives: true,
    fields: 'id, name, mimeType, parents, webViewLink',
  });
  return textResult(response.data);
}

async function driveCreateFolder(input: z.infer<typeof createFolderSchema>, ctx: ToolContext): Promise<ToolResult> {
  const response = await ctx.drive.files.create({
    requestBody: { name: input.name, mimeType: 'application/vnd.google-apps.folder', parents: input.parentFolderId ? [input.parentFolderId] : undefined },
    supportsAllDrives: true,
    fields: 'id, name, mimeType, parents, webViewLink',
  });
  return textResult(response.data);
}

async function driveListFolderChildren(input: z.infer<typeof listFolderChildrenSchema>, ctx: ToolContext): Promise<ToolResult> {
  const response = await ctx.drive.files.list({
    q: `'${input.folderId}' in parents and trashed = false`,
    pageSize: Math.min(input.pageSize, SEARCH_FETCH_LIMIT),
    pageToken: input.pageToken,
    corpora: 'allDrives',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'folder,name_natural,modifiedTime desc',
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, webViewLink)',
  });
  const allFiles = response.data.files ?? [];
  const visibleFiles = allFiles.slice(0, LIST_VISIBLE_LIMIT);
  const payload = {
    folderId: input.folderId,
    totalMatches: allFiles.length,
    returnedCount: visibleFiles.length,
    truncated: allFiles.length > visibleFiles.length || Boolean(response.data.nextPageToken),
    nextPageToken: response.data.nextPageToken ?? null,
    files: visibleFiles,
  };
  return structuredTextResult(
    formatCompactFileListText({
      title: 'Folder listing.',
      files: visibleFiles,
      totalMatches: payload.totalMatches,
      visibleCount: payload.returnedCount,
      truncated: payload.truncated,
      nextPageToken: payload.nextPageToken,
    }),
    payload,
  );
}

export const toolDefinitions: ToolDefinition[] = [
  { name: 'google_auth.status', description: 'Returns the current Google authorization state. Only call this tool when the user explicitly asks to check their Google authorization status.', inputSchema: schemaToJsonSchema(authToolSchema) },
  { name: 'google_auth.begin', description: 'Return the Google authorization URL for the current user. Only call this tool when the user explicitly wants to start Google authorization.', inputSchema: schemaToJsonSchema(authToolSchema) },
  { name: 'drive.search', description: 'Search Google Drive with filename-first ranking and compact results.', inputSchema: schemaToJsonSchema(searchSchema) },
  { name: 'drive.get_metadata', description: 'Read file metadata for a Drive file ID or Google Drive link.', inputSchema: schemaToJsonSchema(metadataSchema) },
  { name: 'drive.read', description: 'Read a Drive file ID or Google Drive link. Office spreadsheets are parsed into tabular text when possible.', inputSchema: schemaToJsonSchema(readSchema) },
  { name: 'drive.write', description: 'Create or update a file in Google Drive.', inputSchema: schemaToJsonSchema(writeSchema) },
  { name: 'drive.rename', description: 'Rename a file or folder.', inputSchema: schemaToJsonSchema(renameSchema) },
  { name: 'drive.move', description: 'Move a file or folder to another folder.', inputSchema: schemaToJsonSchema(moveSchema) },
  { name: 'drive.copy', description: 'Copy an existing file.', inputSchema: schemaToJsonSchema(copySchema) },
  { name: 'drive.create_folder', description: 'Create a new folder.', inputSchema: schemaToJsonSchema(createFolderSchema) },
  { name: 'drive.list_folder_children', description: 'List files directly under a folder with compact output.', inputSchema: schemaToJsonSchema(listFolderChildrenSchema) },
];

const handlers: Record<string, (input: unknown, ctx: ToolContext) => Promise<ToolResult>> = {
  'drive.search': (input, ctx) => driveSearch(searchSchema.parse(input), ctx),
  'drive.get_metadata': (input, ctx) => driveGetMetadata(metadataSchema.parse(input), ctx),
  'drive.read': (input, ctx) => driveRead(readSchema.parse(input), ctx),
  'drive.write': (input, ctx) => driveWrite(writeSchema.parse(input), ctx),
  'drive.rename': (input, ctx) => driveRename(renameSchema.parse(input), ctx),
  'drive.move': (input, ctx) => driveMove(moveSchema.parse(input), ctx),
  'drive.copy': (input, ctx) => driveCopy(copySchema.parse(input), ctx),
  'drive.create_folder': (input, ctx) => driveCreateFolder(createFolderSchema.parse(input), ctx),
  'drive.list_folder_children': (input, ctx) => driveListFolderChildren(listFolderChildrenSchema.parse(input), ctx),
};

export async function executeDriveTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult | null> {
  const handler = handlers[name];
  return handler ? handler(input, ctx) : null;
}
