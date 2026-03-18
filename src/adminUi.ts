export function adminPageHtml(baseUrl: string, enableDebugUi = false): string {
  return `<!DOCTYPE html>
  <html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Google MCP 관리자 도구</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-100 text-slate-900">
    <div class="max-w-6xl mx-auto px-4 py-8">
      <div class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="flex items-end gap-2">
            <h1 class="text-3xl font-bold">Google MCP 관리자 도구</h1>
            <span class="text-sm text-slate-500">(v0.2a)</span>
          </div>
          <p class="text-slate-600 mt-2">관리자 세션은 1시간 유지됩니다. 세션 로그인 후 토큰 발급과 Kill Switch를 한 화면에서 처리할 수 있습니다.</p>
        </div>
        <div class="flex items-center gap-3">
          <span id="sessionBadge" class="hidden rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-sm font-medium">관리자 세션 활성</span>
          <a id="debugLink" href="/admin/debug/ui" class="hidden text-xs text-slate-400 hover:text-slate-600">debug</a>
          <button id="logoutButton" class="hidden rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">로그아웃</button>
        </div>
      </div>

      <section id="loginSection" class="bg-white rounded-2xl shadow p-6 mb-6">
        <h2 class="text-xl font-semibold mb-2">관리자 로그인</h2>
        <p class="text-sm text-slate-600 mb-4">관리자 키를 한 번 입력하면 1시간 동안 세션 쿠키로 유지됩니다. 브라우저에 raw 관리자 키를 계속 들고 다니지 않습니다.</p>
        <form id="loginForm" class="flex flex-col md:flex-row gap-3">
          <input id="adminKeyInput" type="password" autocomplete="off" class="flex-1 rounded-lg border border-slate-300 px-3 py-2" placeholder="ADMIN_KEY 입력" required />
          <button class="rounded-lg bg-black text-white px-4 py-2">세션 시작</button>
        </form>
        <p id="loginError" class="mt-3 text-sm text-red-600 hidden"></p>
      </section>

      <section id="dashboardSection" class="hidden space-y-6">
        <div class="bg-white rounded-2xl shadow p-3">
          <div class="flex gap-2">
            <button data-tab="issue" class="tab-button rounded-lg bg-black text-white px-4 py-2 text-sm">토큰 발급</button>
            <button data-tab="users" class="tab-button rounded-lg bg-slate-200 text-slate-700 px-4 py-2 text-sm">사용자 관리 / Kill Switch</button>
          </div>
        </div>

        <section id="tab-issue" class="tab-panel grid gap-6 lg:grid-cols-2">
          <div class="bg-white rounded-2xl shadow p-6">
            <h2 class="text-xl font-semibold mb-2">새 bearer token 발급</h2>
            <p class="text-sm text-slate-600 mb-2">사용자 ID는 소문자 영문(a-z)만 가능합니다. 예: <code class="bg-slate-100 px-1 py-0.5 rounded">harry</code></p>
            <p class="text-sm text-slate-500 mb-4">같은 이름이 이미 active 상태면 신규 issue는 막히고, 필요하면 reissue 또는 revoke & issue를 선택하세요.</p>
            <form id="issueForm" class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-1">사용자명 (소문자만)</label>
                <input id="issueUserId" type="text" pattern="[a-z]+" class="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="name" required />
              </div>
              <div id="issueUserStatus" class="hidden rounded-lg border px-3 py-2 text-sm"></div>
              <div class="flex flex-wrap gap-2">
                <button id="issueSubmitButton" class="rounded-lg bg-black text-white px-4 py-2" type="submit">issue</button>
                <button id="reissueButton" class="hidden rounded-lg border border-slate-300 bg-white px-4 py-2" type="button">reissue</button>
                <button id="revokeAndIssueButton" class="hidden rounded-lg border border-red-300 text-red-700 bg-white px-4 py-2" type="button">revoke & issue</button>
              </div>
            </form>
            <p id="issueError" class="mt-4 text-sm text-red-600 hidden"></p>
          </div>

          <div class="bg-white rounded-2xl shadow p-6">
            <h2 class="text-xl font-semibold mb-2">발급 후 GenSpark 설정</h2>
            <div id="issueResult" class="hidden mt-5 space-y-4">
              <div>
                <div class="text-sm font-medium mb-1">발급된 bearer token: (실제 토큰 값)</div>
                <textarea id="bearerTokenOutput" class="w-full h-28 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" readonly></textarea>
              </div>
              <div>
                <div class="text-sm font-medium mb-2">Genspark 새로운 MCP 서버 추가에서 아래와 같이 입력하세요.</div>
                <textarea id="fieldGuideOutput" class="w-full h-72 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" readonly></textarea>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-users" class="tab-panel hidden grid gap-6 lg:grid-cols-[320px,1fr]">
          <div class="bg-white rounded-2xl shadow p-6 space-y-4">
            <div>
              <h2 class="text-xl font-semibold mb-2">Kill Switch</h2>
              <p class="text-sm text-slate-600">Kill Switch는 해당 사용자의 bearer token과 저장된 Google OAuth 토큰을 즉시 비활성화합니다.</p>
            </div>
            <button id="loadUsersButton" class="rounded-lg bg-black text-white px-4 py-2">사용자 목록 새로고침</button>
            <div class="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <strong>Kill 후 해야 할 일</strong>
              <ul class="list-disc ml-5 mt-2 space-y-1">
                <li>기존 bearer token은 즉시 무효가 됩니다.</li>
                <li>같은 사용자에게  접근 권한을 다시 주려면 새 bearer token을 재발급하세요.</li>
                <li>Google 연결이 끊긴 경우 OAuth 연결 절차를 다시 진행해야 합니다.</li>
              </ul>
            </div>
            <div id="killGuide" class="hidden text-sm text-slate-700 bg-sky-50 border border-sky-200 rounded-lg p-3"></div>
            <p id="usersError" class="text-sm text-red-600 hidden"></p>
          </div>

          <div class="bg-white rounded-2xl shadow p-6">
            <h2 class="text-xl font-semibold mb-4">사용자 목록</h2>
            <div id="usersEmpty" class="text-sm text-slate-500">사용자 목록을 불러오세요. active 사용자는 reissue, 완전 초기화는 Kill Switch 후 issue를 사용하면 됩니다.</div>
            <div id="usersTableWrap" class="hidden overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left border-b">
                    <th class="py-2 pr-4">사용자명</th>
                    <th class="py-2 pr-4">상태</th>
                    <th class="py-2 pr-4">Bearer</th>
                    <th class="py-2 pr-4">최근 갱신</th>
                    <th class="py-2">액션</th>
                  </tr>
                </thead>
                <tbody id="usersTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </div>

    <script>
      const BASE_URL = ${JSON.stringify(baseUrl)};
      const ENABLE_DEBUG_UI = ${JSON.stringify(enableDebugUi)};
      const loginSection = document.getElementById('loginSection');
      const dashboardSection = document.getElementById('dashboardSection');
      const loginForm = document.getElementById('loginForm');
      const loginError = document.getElementById('loginError');
      const logoutButton = document.getElementById('logoutButton');
      const sessionBadge = document.getElementById('sessionBadge');
      const debugLink = document.getElementById('debugLink');
      const tabButtons = document.querySelectorAll('.tab-button');
      const tabPanels = document.querySelectorAll('.tab-panel');
      const issueForm = document.getElementById('issueForm');
      const issueError = document.getElementById('issueError');
      const issueResult = document.getElementById('issueResult');
      const bearerTokenOutput = document.getElementById('bearerTokenOutput');
      const fieldGuideOutput = document.getElementById('fieldGuideOutput');
      const issueUserStatus = document.getElementById('issueUserStatus');
      const issueSubmitButton = document.getElementById('issueSubmitButton');
      const reissueButton = document.getElementById('reissueButton');
      const revokeAndIssueButton = document.getElementById('revokeAndIssueButton');
      const loadUsersButton = document.getElementById('loadUsersButton');
      const usersError = document.getElementById('usersError');
      const usersEmpty = document.getElementById('usersEmpty');
      const usersTableWrap = document.getElementById('usersTableWrap');
      const usersTableBody = document.getElementById('usersTableBody');
      const killGuide = document.getElementById('killGuide');

      function setAuthenticatedUi(isAuthenticated) {
        loginSection.classList.toggle('hidden', isAuthenticated);
        dashboardSection.classList.toggle('hidden', !isAuthenticated);
        logoutButton.classList.toggle('hidden', !isAuthenticated);
        sessionBadge.classList.toggle('hidden', !isAuthenticated);
        debugLink.classList.toggle('hidden', !isAuthenticated || !ENABLE_DEBUG_UI);
      }

      function activateTab(tab) {
        tabButtons.forEach((button) => {
          const active = button.dataset.tab === tab;
          button.className = active
            ? 'tab-button rounded-lg bg-black text-white px-4 py-2 text-sm'
            : 'tab-button rounded-lg bg-slate-200 text-slate-700 px-4 py-2 text-sm';
        });
        tabPanels.forEach((panel) => {
          panel.classList.toggle('hidden', panel.id !== 'tab-' + tab);
        });
      }

      function statusBadge(text, color) {
        return '<span class="inline-flex rounded-full px-2 py-1 text-xs font-medium ' + color + '">' + text + '</span>';
      }

      async function refreshSession() {
        const response = await fetch('/admin/session/me');
        const payload = await response.json();
        setAuthenticatedUi(!!payload.authenticated);
        return payload.authenticated;
      }

      async function login(adminKey) {
        const response = await fetch('/admin/session/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '로그인 실패');
        }
        await refreshSession();
      }

      async function logout() {
        await fetch('/admin/session/logout', { method: 'POST' });
        issueResult.classList.add('hidden');
        killGuide.classList.add('hidden');
        await refreshSession();
      }

      function renderIssueGuide(userId, bearerToken, shortAuthUrl) {
        bearerTokenOutput.value = bearerToken;
        fieldGuideOutput.value = [
          '서버 이름: Private Google MCP',
          '서버 유형: StreamableHttp',
          '서버 URL: ' + BASE_URL + '/mcp',
          '서버 설명: Genspark와 Google Drive 연결하는 MCP 서버',
          '요청 헤더:',
          JSON.stringify({
            Authorization: 'Bearer ' + bearerToken,
            'x-user-id': userId,
            'Content-Type': 'application/json',
          }, null, 2),
          '',
          '사용자 Google 인증 시작 링크:',
          shortAuthUrl,
          '(만료되었거나 이미 사용된 링크면 관리자에게 새 링크를 요청하세요.)',
          '',
          '안내 문구:',
          '해당 사용자에게 위 링크를 클릭해 Google 인증을 완료하게 하세요.',
        ].join('\\n');
        issueResult.classList.remove('hidden');
      }

      async function fetchOAuthLink(userId) {
        const response = await fetch('/oauth/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'OAuth 링크 생성 실패');
        }
        return payload.authUrl;
      }

      async function lookupUser(userId) {
        const response = await fetch('/admin/users');
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '사용자 목록 조회 실패');
        }
        return (payload.users || []).find((user) => user.userId === userId) || null;
      }

      function resetIssueActions() {
        issueUserStatus.classList.add('hidden');
        issueUserStatus.className = 'hidden rounded-lg border px-3 py-2 text-sm';
        issueUserStatus.textContent = '';
        issueSubmitButton.classList.remove('hidden');
        issueSubmitButton.textContent = 'issue';
        reissueButton.classList.add('hidden');
        revokeAndIssueButton.classList.add('hidden');
      }

      function applyIssueActions(user) {
        resetIssueActions();
        if (!user) {
          issueUserStatus.className = 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700';
          issueUserStatus.textContent = '새 사용자입니다. issue 가능합니다.';
          issueUserStatus.classList.remove('hidden');
          return;
        }

        if (user.status === 'revoked') {
          issueUserStatus.className = 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700';
          issueUserStatus.textContent = 'revoked 사용자입니다. issue로 다시 시작할 수 있습니다.';
          issueUserStatus.classList.remove('hidden');
          issueSubmitButton.textContent = 'issue';
          return;
        }

        issueUserStatus.className = 'rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700';
        issueUserStatus.innerHTML = '이미 active 사용자입니다.<br>• bearer token만 새로 주려면 <strong>reissue</strong><br>• Google 연결까지 완전히 끊고 새로 시작하려면 <strong>revoke & issue</strong>';
        issueUserStatus.classList.remove('hidden');
        issueSubmitButton.classList.add('hidden');
        reissueButton.classList.remove('hidden');
        revokeAndIssueButton.classList.remove('hidden');
      }

      async function loadUsers() {
        usersError.classList.add('hidden');
        killGuide.classList.add('hidden');
        usersEmpty.classList.remove('hidden');
        usersEmpty.textContent = '불러오는 중...';
        usersTableWrap.classList.add('hidden');
        usersTableBody.innerHTML = '';

        try {
          const response = await fetch('/admin/users');
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || '사용자 목록 조회 실패');
          }

          const users = payload.users || [];
          if (!users.length) {
            usersEmpty.textContent = '등록된 사용자가 없습니다.';
            return;
          }

          usersEmpty.classList.add('hidden');
          usersTableWrap.classList.remove('hidden');

          for (const user of users) {
            const tr = document.createElement('tr');
            tr.className = 'border-b align-top';
            tr.innerHTML = [
              '<td class="py-3 pr-4 font-medium">' + user.userId + '</td>',
              '<td class="py-3 pr-4">' + (user.status === 'revoked' ? statusBadge('revoked', 'bg-red-100 text-red-700') : statusBadge('active', 'bg-emerald-100 text-emerald-700')) + '</td>',
              '<td class="py-3 pr-4">' + (user.hasBearer ? (user.bearerStatus === 'revoked' ? statusBadge('revoked', 'bg-red-100 text-red-700') : statusBadge('active', 'bg-blue-100 text-blue-700')) : '<span class="text-slate-400">none</span>') + '</td>',
              '<td class="py-3 pr-4 text-slate-600">' + (user.updatedAt || '-') + '</td>',
              '<td class="py-3"><div class="flex flex-wrap gap-2"><button data-user-id="' + user.userId + '" class="reissue-btn rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">reissue</button><button data-user-id="' + user.userId + '" class="revoke-btn rounded-lg border border-red-300 text-red-700 px-3 py-1.5 hover:bg-red-50">Kill Switch</button></div></td>',
            ].join('');
            usersTableBody.appendChild(tr);
          }

          document.querySelectorAll('.reissue-btn').forEach((button) => {
            button.addEventListener('click', async () => {
              const userId = button.getAttribute('data-user-id');
              button.disabled = true;
              usersError.classList.add('hidden');
              try {
                await rotateToken(userId);
                killGuide.innerHTML = '<strong>' + userId + ' 토큰 재발급 완료</strong><div class="mt-2">기존 Google OAuth 연결은 유지되고, bearer token만 새로 발급되었습니다. 토큰 발급 탭의 결과 영역에서 새 값을 복사해 사용하세요.</div>';
                killGuide.classList.remove('hidden');
                document.getElementById('issueUserId').value = userId;
                applyIssueActions(await lookupUser(userId));
                await loadUsers();
              } catch (error) {
                usersError.textContent = error.message;
                usersError.classList.remove('hidden');
              } finally {
                button.disabled = false;
              }
            });
          });

          document.querySelectorAll('.revoke-btn').forEach((button) => {
            button.addEventListener('click', async () => {
              const userId = button.getAttribute('data-user-id');
              if (!confirm(userId + ' 사용자를 즉시 차단할까요? 기존 bearer token과 Google 연결이 비활성화됩니다.')) {
                return;
              }
              button.disabled = true;
              try {
                const response = await fetch('/admin/revoke', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId }),
                });
                const payload = await response.json();
                if (!response.ok) {
                  throw new Error(payload.error || 'Kill Switch 실패');
                }
                killGuide.innerHTML = '<strong>' + userId + ' 사용자 차단 완료</strong><div class="mt-2">1) 이제 기존 bearer token은 작동하지 않습니다.<br>2) 다시 접근을 허용하려면 토큰 발급 탭에서 같은 이름으로 issue 하세요.<br>3) 필요하면 OAuth 연결을 다시 시작해 Google 권한을 재연결하세요.</div>';
                killGuide.classList.remove('hidden');
                await loadUsers();
              } catch (error) {
                usersError.textContent = error.message;
                usersError.classList.remove('hidden');
              } finally {
                button.disabled = false;
              }
            });
          });
        } catch (error) {
          usersError.textContent = error.message;
          usersError.classList.remove('hidden');
          usersEmpty.textContent = '사용자 목록을 불러오지 못했습니다.';
        }
      }

      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        loginError.classList.add('hidden');
        try {
          await login(document.getElementById('adminKeyInput').value.trim());
        } catch (error) {
          loginError.textContent = error.message;
          loginError.classList.remove('hidden');
        }
      });

      logoutButton.addEventListener('click', logout);

      tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
          activateTab(button.dataset.tab);
          if (button.dataset.tab === 'users') {
            loadUsers();
          }
        });
      });

      async function issueToken(userId) {
        const response = await fetch('/admin/issue-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '토큰 발급 실패');
        }
        const shortAuthUrl = await fetchOAuthLink(userId);
        renderIssueGuide(userId, payload.bearerToken, shortAuthUrl);
      }

      async function rotateToken(userId) {
        const response = await fetch('/admin/rotate-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '토큰 재발급 실패');
        }
        const shortAuthUrl = await fetchOAuthLink(userId);
        renderIssueGuide(userId, payload.bearerToken, shortAuthUrl);
      }

      async function revokeUser(userId) {
        const response = await fetch('/admin/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '사용자 차단 실패');
        }
      }

      issueForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        issueError.classList.add('hidden');
        issueResult.classList.add('hidden');

        const userId = document.getElementById('issueUserId').value.trim();

        try {
          const user = await lookupUser(userId);
          applyIssueActions(user);
          if (user && user.status !== 'revoked') {
            throw new Error('이미 active 사용자입니다. reissue 또는 revoke & issue를 사용하세요.');
          }
          await issueToken(userId);
          applyIssueActions(await lookupUser(userId));
        } catch (error) {
          issueError.textContent = error.message;
          issueError.classList.remove('hidden');
        }
      });

      document.getElementById('issueUserId').addEventListener('blur', async (event) => {
        const userId = event.target.value.trim();
        issueError.classList.add('hidden');
        issueResult.classList.add('hidden');
        if (!userId) {
          resetIssueActions();
          return;
        }
        try {
          applyIssueActions(await lookupUser(userId));
        } catch (error) {
          issueError.textContent = error.message;
          issueError.classList.remove('hidden');
        }
      });

      reissueButton.addEventListener('click', async () => {
        const userId = document.getElementById('issueUserId').value.trim();
        issueError.classList.add('hidden');
        issueResult.classList.add('hidden');
        try {
          await rotateToken(userId);
          applyIssueActions(await lookupUser(userId));
        } catch (error) {
          issueError.textContent = error.message;
          issueError.classList.remove('hidden');
        }
      });

      revokeAndIssueButton.addEventListener('click', async () => {
        const userId = document.getElementById('issueUserId').value.trim();
        issueError.classList.add('hidden');
        issueResult.classList.add('hidden');
        try {
          if (!confirm(userId + ' 사용자를 revoke 하고 새 issue를 진행할까요? 기존 bearer token과 Google 연결이 비활성화됩니다.')) {
            return;
          }
          await revokeUser(userId);
          await issueToken(userId);
          applyIssueActions(await lookupUser(userId));
        } catch (error) {
          issueError.textContent = error.message;
          issueError.classList.remove('hidden');
        }
      });

      loadUsersButton.addEventListener('click', loadUsers);

      refreshSession().then((authenticated) => {
        if (authenticated) {
          activateTab('issue');
        }
      });
    </script>
  </body>
  </html>`;
}
