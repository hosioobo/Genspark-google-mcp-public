import * as XLSX from 'xlsx';

const OFFICE_SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/tab-separated-values',
]);

const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_ROWS = 80;
const MAX_TEXT_COLUMNS = 16;
const MAX_CELL_TEXT_LENGTH = 120;

export interface SpreadsheetReadPayload {
  spreadsheetId: string;
  name?: string | null;
  mimeType: string;
  range: string;
  source: 'google_sheets' | 'office_spreadsheet';
  webViewLink?: string | null;
  sheetName?: string;
  availableSheets?: string[];
  values: string[][];
  totalRows: number;
  previewRows: number;
  previewColumns: number;
  truncated: boolean;
}

function truncateCellText(value: string): string {
  if (value.length <= MAX_CELL_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_CELL_TEXT_LENGTH - 3)}...`;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return truncateCellText(String(value));
}

function trimTrailingEmptyRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((cell) => cell === '')) {
    end -= 1;
  }
  return rows.slice(0, end);
}

function splitSheetRange(range: string | undefined, defaultSheetName: string): { sheetName: string; cellRange: string } {
  if (!range) {
    return { sheetName: defaultSheetName, cellRange: 'A1:Z100' };
  }

  const separatorIndex = range.indexOf('!');
  if (separatorIndex === -1) {
    return { sheetName: defaultSheetName, cellRange: range };
  }

  const sheetName = range.slice(0, separatorIndex).replace(/^'/, '').replace(/'$/, '');
  return {
    sheetName: sheetName || defaultSheetName,
    cellRange: range.slice(separatorIndex + 1) || 'A1:Z100',
  };
}

function buildPreview(values: string[][]): { rows: string[][]; truncated: boolean } {
  const previewRows = values
    .slice(0, MAX_TEXT_ROWS)
    .map((row) => row.slice(0, MAX_TEXT_COLUMNS).map((cell) => truncateCellText(cell)));
  const truncated = values.length > MAX_TEXT_ROWS || values.some((row) => row.length > MAX_TEXT_COLUMNS);
  return { rows: previewRows, truncated };
}

export function isSpreadsheetMimeType(mimeType: string): boolean {
  return mimeType === GOOGLE_SHEETS_MIME_TYPE || OFFICE_SPREADSHEET_MIME_TYPES.has(mimeType);
}

export function isOfficeSpreadsheetMimeType(mimeType: string): boolean {
  return OFFICE_SPREADSHEET_MIME_TYPES.has(mimeType);
}

export function buildSpreadsheetReadPayload(input: {
  spreadsheetId: string;
  name?: string | null;
  mimeType: string;
  range: string;
  source: 'google_sheets' | 'office_spreadsheet';
  values: unknown[][];
  webViewLink?: string | null;
  sheetName?: string;
  availableSheets?: string[];
}): SpreadsheetReadPayload {
  const normalizedRows = trimTrailingEmptyRows(
    (input.values ?? []).map((row) => Array.isArray(row) ? row.map((value) => normalizeCellValue(value)) : [normalizeCellValue(row)]),
  );
  const preview = buildPreview(normalizedRows);
  return {
    spreadsheetId: input.spreadsheetId,
    name: input.name,
    mimeType: input.mimeType,
    range: input.range,
    source: input.source,
    webViewLink: input.webViewLink,
    sheetName: input.sheetName,
    availableSheets: input.availableSheets,
    values: normalizedRows,
    totalRows: normalizedRows.length,
    previewRows: preview.rows.length,
    previewColumns: preview.rows.reduce((max, row) => Math.max(max, row.length), 0),
    truncated: preview.truncated,
  };
}

export function formatSpreadsheetReadText(payload: SpreadsheetReadPayload): string {
  const lines = [
    `spreadsheetId: ${payload.spreadsheetId}`,
    `name: ${payload.name ?? '(untitled spreadsheet)'}`,
    `mimeType: ${payload.mimeType}`,
    `source: ${payload.source}`,
    `range: ${payload.range}`,
  ];

  if (payload.sheetName) {
    lines.push(`sheet: ${payload.sheetName}`);
  }

  if (payload.webViewLink) {
    lines.push(`webViewLink: ${payload.webViewLink}`);
  }

  lines.push(
    `rows: ${payload.totalRows}`,
    payload.truncated
      ? `preview: showing first ${payload.previewRows} row(s) and up to ${payload.previewColumns} column(s); narrow the range for more detail`
      : 'preview: full requested range shown below',
    '',
  );

  if (payload.values.length === 0) {
    lines.push('(No values found in the requested range)');
    return lines.join('\n');
  }

  const previewRows = payload.values
    .slice(0, MAX_TEXT_ROWS)
    .map((row) => row.slice(0, MAX_TEXT_COLUMNS).join('\t'));
  lines.push(...previewRows);
  return lines.join('\n');
}

export function parseSpreadsheetBuffer(input: {
  buffer: Buffer;
  spreadsheetId: string;
  name?: string | null;
  mimeType: string;
  range?: string;
  webViewLink?: string | null;
}): SpreadsheetReadPayload {
  if (input.buffer.byteLength > MAX_SPREADSHEET_BYTES) {
    throw new Error(`Spreadsheet file is too large to parse safely (${input.buffer.byteLength} bytes).`);
  }

  const workbook = XLSX.read(input.buffer, { type: 'buffer' });
  const availableSheets = workbook.SheetNames;
  const defaultSheetName = availableSheets[0];

  if (!defaultSheetName) {
    return buildSpreadsheetReadPayload({
      spreadsheetId: input.spreadsheetId,
      name: input.name,
      mimeType: input.mimeType,
      range: input.range ?? 'A1:Z100',
      source: 'office_spreadsheet',
      values: [],
      webViewLink: input.webViewLink,
      availableSheets,
    });
  }

  const selection = splitSheetRange(input.range, defaultSheetName);
  const sheetName = workbook.Sheets[selection.sheetName] ? selection.sheetName : defaultSheetName;
  const worksheet = workbook.Sheets[sheetName];
  const values = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    range: selection.cellRange,
    raw: false,
    defval: '',
  }) as unknown[][];

  return buildSpreadsheetReadPayload({
    spreadsheetId: input.spreadsheetId,
    name: input.name,
    mimeType: input.mimeType,
    range: `${sheetName}!${selection.cellRange}`,
    source: 'office_spreadsheet',
    values,
    webViewLink: input.webViewLink,
    sheetName,
    availableSheets,
  });
}
