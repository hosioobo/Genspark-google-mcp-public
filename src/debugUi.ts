export function debugPageHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
  <html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Google MCP Debug Console</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div class="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-end gap-3">
            <h1 class="text-3xl font-bold">GenSpark 비교 실험용 Debug Console</h1>
            <span class="text-xs uppercase tracking-[0.2em] text-amber-300">temporary</span>
          </div>
          <p class="mt-3 max-w-4xl text-sm text-slate-300">이 페이지는 synthetic MCP client와 raw trace viewer를 동시에 제공하는 임시 디버그 도구입니다. 인메모리 저장이므로 인스턴스 재시작/스케일아웃 시 로그가 사라질 수 있습니다. 토큰은 마스킹되지만 문서 본문은 raw로 남을 수 있습니다.</p>
        </div>
        <a href="/admin/ui" class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">관리자 UI로 돌아가기</a>
      </div>

      <section class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        권장 순서: <strong>로그 시작</strong> → GenSpark 또는 Synthetic Runner 실행 → <strong>로그 종료</strong> → raw 요청/응답 비교
      </section>

      <div class="grid gap-6 xl:grid-cols-[420px,1fr]">
        <section class="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">Synthetic Runner</h2>
            <span id="runnerState" class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">idle</span>
          </div>

          <form id="runnerForm" class="mt-5 space-y-4">
            <div>
              <label class="mb-1 block text-sm text-slate-300">userId</label>
              <input id="runnerUserId" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="alice" required />
            </div>
            <div>
              <label class="mb-1 block text-sm text-slate-300">bearer token</label>
              <textarea id="runnerBearerToken" class="h-24 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono" placeholder="Bearer token 값을 붙여넣으세요." required></textarea>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-sm text-slate-300">interval (seconds)</label>
                <input id="runnerInterval" type="number" min="1" value="3" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="mb-1 block text-sm text-slate-300">pageSize</label>
                <input id="runnerPageSize" type="number" min="1" max="100" value="20" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label class="mb-1 block text-sm text-slate-300">Accept header preset</label>
              <select id="runnerAccept" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                <option value="application/json, text/event-stream">application/json, text/event-stream</option>
                <option value="text/event-stream, application/json">text/event-stream, application/json</option>
                <option value="application/json">application/json only (invalid control case)</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm text-slate-300">queries (one per line)</label>
              <textarea id="runnerQueries" class="h-36 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">organization management leadership
조직 운영
리더십</textarea>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400" type="submit">실행</button>
              <button id="runnerStop" class="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-200 hover:bg-red-500/10" type="button">중지</button>
              <button id="runnerCopyAll" class="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800" type="button">결과 전체 복사</button>
            </div>
            <p id="runnerError" class="hidden text-sm text-red-300"></p>
          </form>
        </section>

        <section class="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-xl font-semibold">Trace Viewer</h2>
              <p class="mt-1 text-sm text-slate-400">synthetic 요청과 실제 GenSpark 요청을 같은 capture 안에서 비교합니다.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button id="traceStart" class="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-300">로그 시작</button>
              <button id="traceStop" class="rounded-lg border border-cyan-500/40 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10">로그 종료</button>
              <button id="traceRefresh" class="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">새로고침</button>
              <button id="traceClear" class="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-200 hover:bg-red-500/10">모두 비우기</button>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
            <span id="captureStatus" class="text-slate-300">active capture: none</span>
            <label class="flex items-center gap-2">
              <span class="text-slate-400">source filter</span>
              <select id="traceSourceFilter" class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm">
                <option value="all">all</option>
                <option value="synthetic">synthetic</option>
                <option value="external">external</option>
              </select>
            </label>
            <button id="traceCopyCapture" class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800" type="button">선택 capture 복사</button>
          </div>

          <div class="mt-5 grid gap-6 xl:grid-cols-[320px,1fr]">
            <div>
              <h3 class="mb-2 text-sm font-medium text-slate-300">Capture Sessions</h3>
              <div id="captureList" class="space-y-2"></div>
            </div>
            <div>
              <h3 class="mb-2 text-sm font-medium text-slate-300">Selected Capture</h3>
              <div id="traceDetail" class="space-y-4"></div>
            </div>
          </div>
        </section>
      </div>

      <section class="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">Synthetic Raw Output</h2>
          <span id="syntheticCount" class="text-sm text-slate-400">0 step(s)</span>
        </div>
        <div id="syntheticSteps" class="mt-5 space-y-4"></div>
      </section>
    </div>

    <script>
      const BASE_URL = ${JSON.stringify(baseUrl)};
      const runnerForm = document.getElementById('runnerForm');
      const runnerState = document.getElementById('runnerState');
      const runnerError = document.getElementById('runnerError');
      const runnerStop = document.getElementById('runnerStop');
      const runnerCopyAll = document.getElementById('runnerCopyAll');
      const syntheticSteps = document.getElementById('syntheticSteps');
      const syntheticCount = document.getElementById('syntheticCount');
      const captureList = document.getElementById('captureList');
      const traceDetail = document.getElementById('traceDetail');
      const captureStatus = document.getElementById('captureStatus');
      const traceSourceFilter = document.getElementById('traceSourceFilter');

      let selectedCaptureId = null;
      let selectedCapture = null;
      let runState = {
        running: false,
        stopRequested: false,
        sessionId: null,
        steps: [],
      };

      function setRunnerState(label, classes) {
        runnerState.textContent = label;
        runnerState.className = 'rounded-full px-3 py-1 text-xs ' + classes;
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      async function copyText(value) {
        await navigator.clipboard.writeText(value);
      }

      function prettyJson(value) {
        return JSON.stringify(value, null, 2);
      }

      function parseJsonSafe(text) {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }

      function parseToolResultEnvelope(rawResponse) {
        const parsed = parseJsonSafe(rawResponse);
        if (!parsed) return null;
        return parsed.result || parsed;
      }

      function formatRequestSnapshot(headers, rawBody) {
        return prettyJson({
          headers,
          body: parseJsonSafe(rawBody) || rawBody,
        });
      }

      function buildParsedSummary(rawResponse) {
        const parsed = parseJsonSafe(rawResponse);
        if (!parsed) {
          return 'Response is not valid JSON.';
        }

        const toolResult = parsed.result || parsed;
        return prettyJson({
          jsonrpc: parsed.jsonrpc || null,
          id: parsed.id || null,
          isError: !!parsed.error || toolResult.isError || false,
          rpcErrorCode: parsed.error ? parsed.error.code : null,
          rpcErrorMessage: parsed.error ? parsed.error.message : null,
          hasStructuredContent: !!toolResult.structuredContent,
          filesCount: Array.isArray(toolResult.structuredContent && toolResult.structuredContent.files) ? toolResult.structuredContent.files.length : null,
          nextPageToken: toolResult.structuredContent ? toolResult.structuredContent.nextPageToken ?? null : null,
          contentPreview: Array.isArray(toolResult.content) && toolResult.content[0] && toolResult.content[0].type === 'text'
            ? toolResult.content[0].text.slice(0, 220)
            : null,
        });
      }

      async function api(path, options) {
        const response = await fetch(path, options);
        const text = await response.text();
        const payload = parseJsonSafe(text);
        if (!response.ok) {
          throw new Error((payload && payload.error) || text || '요청 실패');
        }
        return payload;
      }

      async function refreshCaptures() {
        const payload = await api('/admin/debug/captures');
        captureStatus.textContent = 'active capture: ' + (payload.activeCaptureId || 'none');
        captureList.innerHTML = '';

        if (!payload.captures.length) {
          captureList.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-4 text-sm text-slate-500">capture 없음</div>';
          traceDetail.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-8 text-sm text-slate-500">capture를 선택하세요.</div>';
          selectedCapture = null;
          selectedCaptureId = null;
          return;
        }

        payload.captures.forEach((capture) => {
          const button = document.createElement('button');
          button.className = 'w-full rounded-2xl border px-3 py-3 text-left text-sm ' + (capture.id === selectedCaptureId ? 'border-cyan-400 bg-cyan-400/10 text-cyan-50' : 'border-slate-800 bg-slate-950 text-slate-200');
          button.innerHTML = [
            '<div class="flex items-center justify-between gap-2">',
            '<span class="font-medium">' + escapeHtml(capture.id.slice(0, 8)) + '</span>',
            '<span class="text-xs ' + (capture.status === 'active' ? 'text-emerald-300' : 'text-slate-400') + '">' + escapeHtml(capture.status) + '</span>',
            '</div>',
            '<div class="mt-1 text-xs text-slate-400">records: ' + capture.recordCount + '</div>',
            '<div class="mt-1 text-xs text-slate-500">' + escapeHtml(capture.startedAt) + '</div>',
          ].join('');
          button.addEventListener('click', async () => {
            selectedCaptureId = capture.id;
            await loadCapture(capture.id);
            await refreshCaptures();
          });
          captureList.appendChild(button);
        });

        if (!selectedCaptureId && payload.captures[0]) {
          selectedCaptureId = payload.captures[0].id;
          await loadCapture(selectedCaptureId);
          await refreshCaptures();
        }
      }

      async function loadCapture(captureId) {
        selectedCapture = await api('/admin/debug/captures/' + encodeURIComponent(captureId));
        renderCaptureDetail();
      }

      function filteredRecords(records) {
        const source = traceSourceFilter.value;
        if (source === 'all') return records;
        return records.filter((record) => record.source === source);
      }

      function renderCaptureDetail() {
        if (!selectedCapture) {
          traceDetail.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-8 text-sm text-slate-500">capture를 선택하세요.</div>';
          return;
        }

        const records = filteredRecords(selectedCapture.records || []);
        if (!records.length) {
          traceDetail.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-8 text-sm text-slate-500">선택한 필터에 해당하는 record가 없습니다.</div>';
          return;
        }

        traceDetail.innerHTML = records.map((record) => {
          const rawRequest = record.ingress && record.ingress.rawBody ? record.ingress.rawBody : '';
          const rawToolResult = record.preTool ? record.preTool.rawToolResult : '';
          const rawResponse = record.egress ? record.egress.rawBody : '';
          return [
            '<article class="rounded-3xl border border-slate-800 bg-slate-950 p-4">',
            '<div class="flex flex-wrap items-center justify-between gap-2">',
            '<div class="flex flex-wrap items-center gap-2 text-sm">',
            '<span class="rounded-full bg-slate-800 px-3 py-1">' + escapeHtml(record.source) + '</span>',
            '<span class="font-medium">' + escapeHtml(record.traceId) + '</span>',
            record.preTool ? '<span class="text-slate-400">' + escapeHtml(record.preTool.requestedTool + ' → ' + record.preTool.canonicalTool) + '</span>' : '',
            '</div>',
            '<button data-copy-record="' + escapeHtml(prettyJson(record)) + '" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">event 복사</button>',
            '</div>',
            '<div class="mt-3 grid gap-4 lg:grid-cols-3">',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">ingress</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(rawRequest) + '</textarea></div>',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">pre-tool</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(rawToolResult) + '</textarea></div>',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">egress</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(rawResponse) + '</textarea></div>',
            '</div>',
            '</article>',
          ].join('');
        }).join('');
      }

      function renderSyntheticSteps() {
        syntheticCount.textContent = runState.steps.length + ' step(s)';
        if (!runState.steps.length) {
          syntheticSteps.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-8 text-sm text-slate-500">실행 결과가 없습니다.</div>';
          return;
        }

        syntheticSteps.innerHTML = runState.steps.map((step, index) => {
          return [
            '<article class="rounded-3xl border border-slate-800 bg-slate-950 p-4">',
            '<div class="flex flex-wrap items-center justify-between gap-2">',
            '<div class="text-sm font-medium">' + escapeHtml(step.label) + '</div>',
            '<div class="flex flex-wrap gap-2">',
            '<button data-copy-request="' + escapeHtml(step.rawRequest) + '" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">request 복사</button>',
            '<button data-copy-response="' + escapeHtml(step.rawResponse) + '" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">response 복사</button>',
            '</div>',
            '</div>',
            '<div class="mt-3 grid gap-4 xl:grid-cols-3">',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">request</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(step.rawRequest) + '</textarea></div>',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">response</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(step.rawResponse) + '</textarea></div>',
            '<div><div class="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">parsed summary</div><textarea readonly class="h-56 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200">' + escapeHtml(step.parsedSummary) + '</textarea></div>',
            '</div>',
            '</article>',
          ].join('');
        }).join('');
      }

      async function sendMcpRequest(rawRequest, headers) {
        const response = await fetch('/mcp', {
          method: 'POST',
          headers,
          body: rawRequest,
        });
        const rawResponse = await response.text();
        const sessionId = response.headers.get('mcp-session-id');
        return {
          status: response.status,
          sessionId,
          rawResponse,
        };
      }

      async function bootstrapSyntheticSession(headers) {
        const initializeRequest = JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-' + Date.now(),
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: {
              name: 'synthetic-debug-ui',
              version: '0.1.0',
            },
          },
        }, null, 2);
        const initializeResult = await sendMcpRequest(initializeRequest, headers);
        runState.sessionId = initializeResult.sessionId;
        runState.steps.push({
          label: 'session bootstrap / initialize',
          rawRequest: formatRequestSnapshot(headers, initializeRequest),
          rawResponse: initializeResult.rawResponse,
          parsedSummary: buildParsedSummary(initializeResult.rawResponse),
        });

        const initializedRequest = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }, null, 2);
        const initializedResult = await sendMcpRequest(initializedRequest, {
          ...headers,
          'mcp-session-id': runState.sessionId,
        });
        const initializedHeaders = {
          ...headers,
          'mcp-session-id': runState.sessionId,
        };
        runState.steps.push({
          label: 'session bootstrap / notifications.initialized',
          rawRequest: formatRequestSnapshot(initializedHeaders, initializedRequest),
          rawResponse: initializedResult.rawResponse || '(empty response body)',
          parsedSummary: buildParsedSummary(initializedResult.rawResponse || ''),
        });
      }

      function buildToolCallRequest(query, pageSize) {
        return JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
          method: 'tools/call',
          params: {
            name: 'drive.search',
            arguments: {
              query,
              pageSize,
            },
          },
        }, null, 2);
      }

      runnerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (runState.running) return;

        const userId = document.getElementById('runnerUserId').value.trim();
        const bearerToken = document.getElementById('runnerBearerToken').value.trim();
        const intervalSeconds = Math.max(1, Number(document.getElementById('runnerInterval').value || 3));
        const pageSize = Math.max(1, Number(document.getElementById('runnerPageSize').value || 20));
        const acceptHeader = document.getElementById('runnerAccept').value;
        const queries = document.getElementById('runnerQueries').value.split('\\n').map((line) => line.trim()).filter(Boolean);

        runnerError.classList.add('hidden');
        runState = { running: true, stopRequested: false, sessionId: null, steps: [] };
        setRunnerState('running', 'bg-emerald-500/20 text-emerald-200');
        renderSyntheticSteps();

        const headers = {
          Accept: acceptHeader,
          Authorization: 'Bearer ' + bearerToken,
          'Content-Type': 'application/json',
          'x-user-id': userId,
          'x-debug-client': 'synthetic-ui',
        };

        try {
          await bootstrapSyntheticSession(headers);
          renderSyntheticSteps();

          for (let index = 0; index < queries.length; index += 1) {
            if (runState.stopRequested) break;

            const query = queries[index];
            const rawRequest = buildToolCallRequest(query, pageSize);
            const response = await sendMcpRequest(rawRequest, {
              ...headers,
              'mcp-session-id': runState.sessionId,
            });
            const requestHeaders = {
              ...headers,
              'mcp-session-id': runState.sessionId,
            };

            runState.steps.push({
              label: 'tools/call / drive.search / ' + query,
              rawRequest: formatRequestSnapshot(requestHeaders, rawRequest),
              rawResponse: response.rawResponse,
              parsedSummary: buildParsedSummary(response.rawResponse),
            });
            renderSyntheticSteps();
            await refreshCaptures();

            if (index < queries.length - 1 && !runState.stopRequested) {
              setRunnerState('waiting ' + intervalSeconds + 's', 'bg-amber-500/20 text-amber-200');
              await sleep(intervalSeconds * 1000);
              setRunnerState('running', 'bg-emerald-500/20 text-emerald-200');
            }
          }
        } catch (error) {
          runnerError.textContent = error.message;
          runnerError.classList.remove('hidden');
        } finally {
          runState.running = false;
          setRunnerState(runState.stopRequested ? 'stopped' : 'idle', runState.stopRequested ? 'bg-red-500/20 text-red-200' : 'bg-slate-800 text-slate-300');
          renderSyntheticSteps();
        }
      });

      runnerStop.addEventListener('click', () => {
        runState.stopRequested = true;
      });

      runnerCopyAll.addEventListener('click', async () => {
        await copyText(prettyJson(runState.steps));
      });

      document.getElementById('traceStart').addEventListener('click', async () => {
        await api('/admin/debug/captures/start', { method: 'POST' });
        await refreshCaptures();
      });

      document.getElementById('traceStop').addEventListener('click', async () => {
        await api('/admin/debug/captures/stop', { method: 'POST' });
        await refreshCaptures();
      });

      document.getElementById('traceRefresh').addEventListener('click', refreshCaptures);

      document.getElementById('traceClear').addEventListener('click', async () => {
        if (!confirm('모든 capture를 삭제할까요?')) return;
        await api('/admin/debug/captures', { method: 'DELETE' });
        await refreshCaptures();
      });

      document.getElementById('traceCopyCapture').addEventListener('click', async () => {
        if (!selectedCapture) return;
        await copyText(prettyJson(selectedCapture));
      });

      traceSourceFilter.addEventListener('change', renderCaptureDetail);

      document.addEventListener('click', async (event) => {
        const requestButton = event.target.closest('[data-copy-request]');
        if (requestButton) {
          await copyText(requestButton.getAttribute('data-copy-request'));
          return;
        }

        const responseButton = event.target.closest('[data-copy-response]');
        if (responseButton) {
          await copyText(responseButton.getAttribute('data-copy-response'));
          return;
        }

        const recordButton = event.target.closest('[data-copy-record]');
        if (recordButton) {
          await copyText(recordButton.getAttribute('data-copy-record'));
        }
      });

      setRunnerState('idle', 'bg-slate-800 text-slate-300');
      renderSyntheticSteps();
      refreshCaptures().catch((error) => {
        traceDetail.innerHTML = '<div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">' + escapeHtml(error.message) + '</div>';
      });
    </script>
  </body>
  </html>`;
}
