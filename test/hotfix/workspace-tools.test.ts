import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { google } from 'googleapis';
import type { Logger } from '../../src/logger.js';
import { executeWorkspaceTool } from '../../src/tools/workspaceTools.ts';
import { createDriveMock } from '../helpers/mock-google-apis.ts';

function createLoggerStub(): Logger {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger,
  };
  return logger;
}

function createContext() {
  const driveMock = createDriveMock();
  return {
    driveMock,
    ctx: {
      userId: 'alice',
      oauthClient: {} as any,
      drive: driveMock.service as any,
      logger: createLoggerStub(),
      requestId: 'req-1',
    },
  };
}

test('sheets.read falls back to parsing uploaded xlsx files', async () => {
  const { driveMock, ctx } = createContext();
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['date', 'qty'],
    ['2026-03-04', 42],
    ['2026-03-05', 19],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Shipments');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  driveMock.service.files.get._setImpl(async (params: { alt?: string }) => {
    if (params.alt === 'media') {
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    }

    return {
      data: {
        id: 'file-1',
        name: '2026-03-04_케이프_슈퍼콤 출고정보(송장번호).xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        webViewLink: 'https://docs.google.com/spreadsheets/d/file-1/edit?rtpof=true&sd=true',
      },
    };
  });

  const originalSheetsFactory = (google as any).sheets;
  (google as any).sheets = () => {
    throw new Error('Native Google Sheets API should not be used for uploaded xlsx files');
  };

  try {
    const result = await executeWorkspaceTool(
      'sheets.read',
      {
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/file-1/edit?rtpof=true&sd=true',
        range: 'A1:B3',
      },
      ctx,
    );

    assert.ok(result);
    assert.match(result!.content[0].text, /source: office_spreadsheet/);
    assert.match(result!.content[0].text, /date\tqty/);
    assert.match(result!.content[0].text, /2026-03-04\t42/);
    assert.equal((result!.structuredContent as any).values[1][0], '2026-03-04');
    assert.equal((result!.structuredContent as any).sheetName, 'Shipments');
  } finally {
    (google as any).sheets = originalSheetsFactory;
  }
});

test('sheets.read refuses xlsx download when Drive says canDownload is false', async () => {
  const { driveMock, ctx } = createContext();
  driveMock.service.files.get._setImpl(async (params: { alt?: string }) => {
    if (params.alt === 'media') {
      throw new Error('media download should not run when canDownload=false');
    }

    return {
      data: {
        id: 'file-2',
        name: 'locked.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        capabilities: {
          canDownload: false,
        },
      },
    };
  });

  const result = await executeWorkspaceTool(
    'sheets.read',
    {
      spreadsheetId: 'file-2',
      range: 'A1:B3',
    },
    ctx,
  );

  assert.ok(result);
  assert.equal(result!.isError, true);
  assert.match(result!.content[0].text, /cannot be downloaded/i);
});

test('sheets.read refuses oversized xlsx files before parsing', async () => {
  const { driveMock, ctx } = createContext();
  const oversizedBuffer = Buffer.alloc((5 * 1024 * 1024) + 1, 0);

  driveMock.service.files.get._setImpl(async (params: { alt?: string }) => {
    if (params.alt === 'media') {
      return { data: oversizedBuffer.buffer.slice(oversizedBuffer.byteOffset, oversizedBuffer.byteOffset + oversizedBuffer.byteLength) };
    }

    return {
      data: {
        id: 'file-3',
        name: 'oversized.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    };
  });

  const result = await executeWorkspaceTool(
    'sheets.read',
    {
      spreadsheetId: 'file-3',
      range: 'A1:B3',
    },
    ctx,
  );

  assert.ok(result);
  assert.equal(result!.isError, true);
  assert.match(result!.content[0].text, /too large to parse safely/i);
});
