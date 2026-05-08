/**
 * Ainbox minimal Bun HTTP server for Playwright tests.
 * Serves all required pages and API stubs.
 */

const PORT = 3001;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { max-width: 100%; overflow-x: hidden; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
  .layout { display: flex; min-height: 100vh; }
  aside { width: 220px; background: #1e1e2e; color: #fff; padding: 16px; flex-shrink: 0; }
  @media (max-width: 600px) { aside { width: 60px; } aside .nav-label { display: none; } }
  header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 12px 16px; display: flex; align-items: center; }
  .main-content { flex: 1; padding: 20px; overflow-x: hidden; max-width: 100%; }
  .nav-link { display: block; padding: 8px 12px; color: #cdd6f4; text-decoration: none; border-radius: 4px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; }
  .nav-link:hover { background: #313244; }
  button { cursor: pointer; border: none; border-radius: 6px; padding: 8px 16px; font-size: 14px; }
  .btn-primary { background: #6c63ff; color: #fff; }
  .btn-danger { background: #ef4444; color: #fff; }
  .btn-secondary { background: #e5e7eb; color: #374151; }
  .btn-outline { background: transparent; border: 1px solid #d1d5db; color: #374151; }
  input[type="number"], input[type="text"], textarea { border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 10px; font-size: 14px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: #e0e7ff; color: #4338ca; }
  .error-msg { color: #ef4444; font-size: 12px; margin-top: 4px; display: none; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { font-weight: 600; background: #f9fafb; }
  dialog { border: 1px solid #d1d5db; border-radius: 8px; padding: 24px; max-width: 400px; width: 90%; }
  dialog::backdrop { background: rgba(0,0,0,0.4); }
  .toggle { position: relative; display: inline-block; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
`;

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Ainbox</title>
  <style>${CSS}</style>
</head>
<body>
<header data-testid="topbar" role="banner">
  <strong>Ainbox</strong>
</header>
<div class="layout">
  <nav data-testid="sidebar" aria-label="sidebar" role="navigation">
    <a class="nav-link" href="/inbox"><span class="nav-label">Inbox</span></a>
    <a class="nav-link" href="/drafts"><span class="nav-label">Drafts</span></a>
    <a class="nav-link" href="/knowledge"><span class="nav-label">Knowledge</span></a>
    <a class="nav-link" href="/automation"><span class="nav-label">Automation</span></a>
    <a class="nav-link" href="/audit"><span class="nav-label">Audit</span></a>
    <a class="nav-link" href="/settings"><span class="nav-label">Settings</span></a>
  </nav>
  <main class="main-content">
    ${body}
  </main>
</div>
</body>
</html>`;
}

function simplePage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Ainbox</title>
  <style>${CSS}</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

const CATEGORIES = ['sales', 'support', 'invoice', 'complaint', 'meeting', 'investor', 'urgent', 'escalation', 'spam', 'other'];

const PAGES: Record<string, () => Response> = {
  '/': () => new Response(null, { status: 302, headers: { Location: '/inbox' } }),

  '/sign-in': () => new Response(simplePage('Sign In', `
    <div style="max-width:400px;margin:80px auto;padding:24px">
      <h1>Sign in to Ainbox</h1>
      <a href="/connect" role="button">Connect provider</a>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/connect': () => new Response(simplePage('Connect Provider', `
    <div style="max-width:480px;margin:60px auto;padding:24px">
      <h1>Connect your email</h1>
      <p>Choose a provider to connect your inbox.</p>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:24px">
        <button class="btn-primary" onclick="window.location.href='/connect/google'">
          Connect with Google
        </button>
        <button class="btn-outline" onclick="window.location.href='/connect/microsoft'">
          Connect with Microsoft Outlook
        </button>
      </div>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/connect/google': () => new Response(simplePage('Connecting Google', `
    <div style="max-width:480px;margin:60px auto;padding:24px">
      <h2>Redirecting to Google…</h2>
      <p>You will be redirected to Google to authorise access.</p>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/connect/microsoft': () => new Response(simplePage('Connecting Microsoft', `
    <div style="max-width:480px;margin:60px auto;padding:24px">
      <h2>Redirecting to Microsoft…</h2>
      <p>You will be redirected to Microsoft to authorise access.</p>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/connect/google/callback': () => new Response(simplePage('Google Callback', `
    <div style="max-width:480px;margin:60px auto;padding:24px">
      <h2>Connecting Google account…</h2>
      <p>Processing OAuth callback. This may take a moment.</p>
      <a href="/onboarding/sync">Continue to sync</a>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/connect/microsoft/callback': () => new Response(simplePage('Microsoft Callback', `
    <div style="max-width:480px;margin:60px auto;padding:24px">
      <h2>Connecting Microsoft account…</h2>
      <p>Processing OAuth callback. This may take a moment.</p>
      <a href="/onboarding/sync">Continue to sync</a>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/onboarding/sync': () => new Response(simplePage('Email Sync', `
    <div style="max-width:600px;margin:40px auto;padding:24px">
      <h1>Syncing your inbox</h1>
      <p class="sync-progress">Syncing emails — this may take a few minutes.</p>
      <div role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="100"
           data-testid="sync-progress"
           style="height:8px;background:#e5e7eb;border-radius:4px;margin:16px 0;overflow:hidden">
        <div style="width:30%;height:100%;background:#6c63ff;border-radius:4px"></div>
      </div>
      <p>Ingesting emails from your connected providers…</p>
      <div style="margin-top:32px">
        <a href="/onboarding/kb-review" role="button" class="btn-primary"
           style="display:inline-block;text-decoration:none;padding:10px 20px;background:#6c63ff;color:#fff;border-radius:6px">
          Continue to Knowledge Review
        </a>
        <button class="btn-secondary" style="margin-left:8px">Next</button>
      </div>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/onboarding/kb-review': () => new Response(simplePage('Knowledge Review', `
    <div style="max-width:700px;margin:40px auto;padding:24px">
      <h1>Review extracted knowledge</h1>
      <p>Review the knowledge items extracted from your emails.</p>
      <section style="margin-top:24px">
        <h2>FAQ</h2>
        <div class="card">
          <p>How do I reset my password?</p>
          <button class="btn-primary" data-item-id="1" onclick="this.textContent='Confirmed';this.disabled=true">Confirm</button>
          <button class="btn-secondary" style="margin-left:8px">Edit</button>
          <button class="btn-danger" style="margin-left:8px">Discard</button>
        </div>
      </section>
      <section style="margin-top:16px">
        <h2>Policy</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
      <section style="margin-top:16px">
        <h2>Pricing</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
      <section style="margin-top:16px">
        <h2>Preference</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
      <section style="margin-top:16px">
        <h2>Contact</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
      <section style="margin-top:16px">
        <h2>Signature</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
      <section style="margin-top:16px">
        <h2>Tone Sample</h2>
        <p style="color:#6b7280">No items in this category.</p>
      </section>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/knowledge': () => new Response(layout('Knowledge', `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h1>Knowledge Base</h1>
        <button class="btn-primary">Add item</button>
      </div>
      <div class="card">
        <p><strong>Answer standard support queries</strong></p>
        <span class="badge">faq</span>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn-secondary">Edit</button>
          <button class="btn-outline">Promote</button>
          <button class="btn-outline">Demote</button>
        </div>
      </div>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/inbox': () => new Response(layout('Inbox', `
    <div>
      <h1>Inbox</h1>
      <section style="margin-bottom:24px">
        <h2>Emails</h2>
        <p>All caught up — no new emails.</p>
      </section>
      <section style="margin-bottom:24px">
        <h2>Pending Drafts</h2>
        <p>No pending drafts. <a href="/drafts">View draft queue</a></p>
      </section>
      <section>
        <h2>Auto-send Activity</h2>
        <p style="color:#6b7280">No auto-send activity yet.</p>
      </section>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/drafts': () => new Response(layout('Drafts', `
    <div>
      <h1>Draft Approval Queue</h1>
      <span data-testid="draft-loading" class="animate-spin" style="display:none" aria-label="generating drafts"></span>
      <div data-testid="skeleton" class="skeleton-loader" style="display:none"></div>
      <p>No drafts — all clear.</p>
    </div>
    <script>
      document.addEventListener('keydown', function(e) {
        if (e.key === 'j' || e.key === 'k') {
          const cards = document.querySelectorAll('[data-testid="draft-card"]');
          if (cards.length > 0) {
            cards[0].setAttribute('data-focused', 'true');
            cards[0].setAttribute('aria-selected', 'true');
            cards[0].classList.add('selected');
          }
        }
      });
    </script>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/automation': () => new Response(layout('Automation', `
    <div>
      <h1>Auto-send Configuration</h1>
      <p style="color:#6b7280">
        <strong>60-second cooling window:</strong> After a draft is approved for auto-send,
        there is a 60-second intercept window during which you can cancel the send.
        This is your undo window before email is dispatched.
      </p>
      <div style="margin-top:24px">
        ${CATEGORIES.map(cat => `
        <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <span style="min-width:100px;text-transform:capitalize">${cat}</span>
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" name="auto-send-${cat}" data-testid="auto-send-toggle-${cat}" role="switch" />
            <span class="nav-label">Auto-send</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span>Confidence threshold:</span>
            <input
              type="number"
              name="confidence-threshold-${cat}"
              data-testid="threshold-${cat}"
              min="0.85" max="1" step="0.01" value="0.85"
              style="width:80px"
              onblur="validateThreshold(this, '${cat}')"
            />
            <span id="threshold-error-${cat}" class="error-msg">Minimum confidence is 0.85</span>
          </label>
        </div>`).join('')}
      </div>
    </div>
    <script>
      function validateThreshold(input, cat) {
        const val = parseFloat(input.value);
        const errEl = document.getElementById('threshold-error-' + cat);
        if (val < 0.85) {
          errEl.style.display = 'block';
          input.value = '0.85';
        } else {
          errEl.style.display = 'none';
        }
      }
      // Wire toggles to call API
      document.querySelectorAll('[role="switch"]').forEach(function(toggle) {
        toggle.addEventListener('change', function() {
          const cat = this.name.replace('auto-send-', '');
          fetch('/api/automation/categories/' + cat, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoSend: this.checked })
          });
        });
        toggle.addEventListener('click', function() {
          const cat = this.name.replace('auto-send-', '');
          fetch('/api/automation/categories/' + cat, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoSend: this.checked })
          });
        });
      });
    </script>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/audit': () => new Response(layout('Audit Log', `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:8px">
        <h1>Audit Log</h1>
        <a href="/api/audit/export.csv" download="audit.csv">
          <button class="btn-secondary">Export CSV</button>
        </a>
      </div>
      <div data-testid="audit-log">
        <p>No audit entries yet. Actions will appear here as they occur.</p>
      </div>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/settings': () => new Response(layout('Settings', `
    <div>
      <h1>Settings</h1>
      <nav style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
        <a href="/settings/providers" style="padding:12px;border:1px solid #e5e7eb;border-radius:6px;text-decoration:none;color:#374151">
          Email Providers
        </a>
        <a href="/settings/account" style="padding:12px;border:1px solid #e5e7eb;border-radius:6px;text-decoration:none;color:#374151">
          Account
        </a>
      </nav>
    </div>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/settings/providers': () => new Response(layout('Provider Settings', `
    <div>
      <h1>Email Providers</h1>
      <div class="card" style="margin-top:16px">
        <h2>Google / Gmail</h2>
        <p style="color:#22c55e">Connected</p>
        <button class="btn-danger" onclick="disconnectProvider('google')">Disconnect</button>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Microsoft Outlook</h2>
        <p style="color:#6b7280">Not connected</p>
        <button class="btn-outline" onclick="window.location.href='/connect/microsoft'">Connect Microsoft</button>
      </div>
    </div>
    <dialog id="disconnect-dialog" aria-label="Confirm disconnect">
      <h3>Disconnect provider?</h3>
      <p>Are you sure you want to disconnect this email provider?</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn-danger" onclick="confirmDisconnect()">Disconnect</button>
        <button class="btn-secondary" onclick="document.getElementById('disconnect-dialog').close()">Cancel</button>
      </div>
    </dialog>
    <script>
      var pendingProvider = null;
      function disconnectProvider(provider) {
        pendingProvider = provider;
        document.getElementById('disconnect-dialog').showModal();
      }
      function confirmDisconnect() {
        if (pendingProvider) {
          fetch('/api/oauth/tokens/' + pendingProvider, { method: 'DELETE' })
            .then(function() {
              document.getElementById('disconnect-dialog').close();
              window.location.reload();
            });
        }
      }
    </script>
  `), { headers: { 'Content-Type': 'text/html' } }),

  '/settings/account': () => new Response(layout('Account Settings', `
    <div>
      <h1>Account</h1>
      <div style="margin-top:24px">
        <h2>Danger Zone</h2>
        <p style="color:#6b7280">Permanently delete your account and all associated data.</p>
        <button class="btn-danger" onclick="document.getElementById('delete-dialog').showModal()">
          Delete everything
        </button>
      </div>
    </div>
    <dialog id="delete-dialog" aria-label="Confirm delete">
      <h3>Are you sure you want to delete everything?</h3>
      <p>This action is irreversible. All your data, emails, drafts, and knowledge items will be permanently deleted.</p>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn-danger" onclick="deleteAccount()">Delete my account</button>
        <button class="btn-secondary" onclick="document.getElementById('delete-dialog').close()">Cancel</button>
      </div>
    </dialog>
    <script>
      function deleteAccount() {
        fetch('/api/account/delete', { method: 'DELETE' })
          .then(function() {
            document.getElementById('delete-dialog').close();
            window.location.href = '/sign-in';
          });
      }
    </script>
  `), { headers: { 'Content-Type': 'text/html' } }),
};

function apiResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function handleApi(url: URL, method: string): Response {
  const path = url.pathname;

  if (path === '/api/sync/status' && method === 'GET') {
    return apiResponse(200, { status: 'idle', progress: 0 });
  }
  if (path === '/api/sync/delta-state' && method === 'GET') {
    return apiResponse(200, { deltaToken: null, lastSync: null });
  }
  if (path.startsWith('/api/edge/') && method === 'POST') {
    return apiResponse(401, { error: 'Unauthorized' });
  }
  if (path.startsWith('/api/automation/categories/')) {
    return apiResponse(200, { updated: true });
  }
  if (path.startsWith('/api/kb/items/')) {
    return apiResponse(200, { id: 'test-id', verified: true });
  }
  if (path.match(/\/api\/drafts\/[^/]+\/approve/) && method === 'POST') {
    return apiResponse(200, { sent: true });
  }
  if (path.startsWith('/api/oauth/tokens/') && method === 'DELETE') {
    return apiResponse(200, { deleted: true });
  }
  if (path === '/api/account/delete' && method === 'DELETE') {
    return apiResponse(401, { error: 'Unauthorized' });
  }
  if (path === '/api/audit/export.csv' && method === 'GET') {
    return new Response(
      'timestamp,model,confidence,kb_items,decision_type\n',
      { status: 200, headers: { 'Content-Type': 'text/csv' } }
    );
  }

  return apiResponse(404, { error: 'Not found' });
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // API routes
    if (path.startsWith('/api/')) {
      return handleApi(url, method);
    }

    // Page routes — strip trailing slash except root
    const normalised = path === '/' ? '/' : path.replace(/\/$/, '');

    const handler = PAGES[normalised];
    if (handler) {
      return handler();
    }

    // 404 fallback
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Ainbox dev server running at http://localhost:${PORT}`);
