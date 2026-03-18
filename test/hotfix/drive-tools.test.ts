import test from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../../src/logger.js';
import { executeDriveTool } from '../../src/tools/driveTools.ts';
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

test('drive.search returns compact text with ids and structured content', async () => {
  const { driveMock, ctx } = createContext();
  driveMock.service.files.list._setImpl(async () => ({
    data: {
      files: Array.from({ length: 10 }, (_, index) => ({
        id: `file-${index + 1}`,
        name: index === 3 ? '2026-03-04_케이프_슈퍼콤 출고정보(송장번호).xlsx' : `조직 운영 메모 ${index + 1}`,
        mimeType: 'application/vnd.google-apps.document',
        createdTime: '2026-03-10T18:00:00Z',
        modifiedTime: `2026-03-10T18:0${index}:00Z`,
        webViewLink: `https://docs.google.com/document/d/file-${index + 1}/edit`,
      })),
      nextPageToken: 'next-1',
    },
  }));

  const result = await executeDriveTool('drive.search', { query: '케이프 슈퍼콤 출고', pageSize: 25 }, ctx);
  assert.ok(result);
  assert.match(result!.content[0].text, /Filename-prioritized search/i);
  assert.match(result!.content[0].text, /Showing the top 8 ranked match/);
  assert.equal((result!.structuredContent as any).files[0].id, 'file-4');
  assert.equal((result!.structuredContent as any).files.length, 8);
  assert.equal((result!.structuredContent as any).nextPageToken, 'next-1');

  const listCall = driveMock.tracker.getCalls('files.list')[0];
  assert.equal(listCall.args[0].corpora, 'allDrives');
  assert.equal(listCall.args[0].pageSize, 20);
  assert.match(listCall.args[0].q, /name contains/);
  assert.equal(listCall.args[0].orderBy, undefined);
});

test('drive.read returns readable content and structured content', async () => {
  const { driveMock, ctx } = createContext();
  driveMock.service.files.get._setImpl(async () => ({
    data: {
      id: 'doc-1',
      name: '강의 초안',
      mimeType: 'application/vnd.google-apps.document',
    },
  }));
  driveMock.service.files.export._setImpl(async () => ({
    data: '첫 줄\n둘째 줄',
  }));

  const result = await executeDriveTool('drive.read', { fileId: 'doc-1' }, ctx);
  assert.ok(result);
  assert.match(result!.content[0].text, /fileId: doc-1/);
  assert.match(result!.content[0].text, /첫 줄/);
  assert.equal((result!.structuredContent as any).content, '첫 줄\n둘째 줄');
});

test('drive.read refuses export when Drive says canDownload is false', async () => {
  const { driveMock, ctx } = createContext();
  driveMock.service.files.get._setImpl(async () => ({
    data: {
      id: 'doc-1',
      name: '잠긴 문서',
      mimeType: 'application/vnd.google-apps.document',
      capabilities: {
        canDownload: false,
      },
    },
  }));

  const result = await executeDriveTool('drive.read', { fileId: 'doc-1' }, ctx);
  assert.ok(result);
  assert.equal(result!.isError, true);
  assert.match(result!.content[0].text, /cannot be downloaded or exported/i);
  assert.equal(driveMock.tracker.getCalls('files.export').length, 0);
});
