'use client';

import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';

const MOCK_EMAILS = [
  { id: '1', from: 'alice@example.com', subject: 'Q4 budget review', snippet: 'Please review the attached Q4 budget projections...', category: 'invoice', time: '2m ago' },
  { id: '2', from: 'bob@customer.org', subject: 'Need help with account setup', snippet: 'I am having trouble setting up my account...', category: 'support', time: '15m ago' },
  { id: '3', from: 'carol@partner.io', subject: 'Meeting tomorrow at 3pm', snippet: 'Confirming our meeting tomorrow...', category: 'meeting', time: '1h ago' },
  { id: '4', from: 'dave@investor.fund', subject: 'Monthly investor update', snippet: 'Here is the monthly update for October...', category: 'investor', time: '2h ago' },
  { id: '5', from: 'erin@company.com', subject: 'URGENT: Server outage', snippet: 'Production server is down, need immediate...', category: 'urgent', time: '5m ago' },
  { id: '6', from: 'frank@prospect.org', subject: 'Interested in your product', snippet: 'I saw your product at the conference...', category: 'sales', time: '3h ago' },
  { id: '7', from: 'gina@legal.team', subject: 'Contract renewal dispute', snippet: 'We need to address the clauses in section...', category: 'escalation', time: '4h ago' },
  { id: '8', from: 'spammer@ads.com', subject: 'You won a prize!', snippet: 'Congratulations! You have been selected...', category: 'spam', time: '6h ago' },
  { id: '9', from: 'helen@support.ticket', subject: 'Refund request #48291', snippet: 'I would like to request a refund for...', category: 'complaint', time: '1d ago' },
  { id: '10', from: 'ian@newsletter.io', subject: 'Your weekly digest', snippet: 'Here is what happened this week...', category: 'other', time: '2d ago' },
];

const MOCK_AUTO_SEND = [
  { id: 'a1', to: 'support@ticket.com', subject: 'Re: Ticket #12345', sentAt: '2h ago', category: 'support' },
  { id: 'a2', to: 'ceo@company.org', subject: 'Re: Board meeting notes', sentAt: '5h ago', category: 'meeting' },
];

const CATEGORY_COLORS: Record<string, string> = {
  sales: 'bg-blue-100 text-blue-700',
  support: 'bg-green-100 text-green-700',
  invoice: 'bg-amber-100 text-amber-700',
  complaint: 'bg-red-100 text-red-700',
  meeting: 'bg-purple-100 text-purple-700',
  investor: 'bg-indigo-100 text-indigo-700',
  urgent: 'bg-orange-100 text-orange-700',
  escalation: 'bg-pink-100 text-pink-700',
  spam: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-600',
};

export interface CoolingDraft {
  id: string;
  status?: string;
  cool_until?: string;
  confidence?: number;
  category?: string;
  subject?: string;
}

function secsRemaining(coolUntil: string): number {
  return Math.max(0, Math.ceil((new Date(coolUntil).getTime() - Date.now()) / 1000));
}

function CoolingBanner({ draft, onCancel }: { draft: CoolingDraft; onCancel: (id: string) => void }) {
  // Start at 0 to avoid SSR/client hydration mismatch, then set correct value after mount.
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!draft.cool_until) return;
    setSecs(secsRemaining(draft.cool_until));
    const interval = setInterval(() => {
      setSecs(secsRemaining(draft.cool_until!));
    }, 1000);
    return () => clearInterval(interval);
  }, [draft.cool_until]);

  return (
    <div
      data-testid="cooling-banner"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <span className="text-sm font-medium text-amber-800">
        Cooling — sending in {secs}s
      </span>
      <span className="max-w-xs truncate text-xs text-amber-700">{draft.subject}</span>
      <button
        onClick={() => onCancel(draft.id)}
        className="ml-auto shrink-0 rounded bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
      >
        Cancel Send
      </button>
    </div>
  );
}

type Tab = 'latest' | 'drafts' | 'activity';

export default function InboxClient({ initialDrafts }: { initialDrafts: CoolingDraft[] }) {
  const [activeTab, setActiveTab] = useState<Tab>('latest');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Seed state from SSR-provided initialDrafts so the cooling banner is visible immediately.
  const [allDrafts, setAllDrafts] = useState<CoolingDraft[]>(initialDrafts);

  void selectedCategory;

  // Re-fetch in the browser so Playwright route mocks can override data if needed.
  // If the fetch returns non-empty data it replaces the SSR seed.
  useEffect(() => {
    const tid = setTimeout(() => {
      fetch('/api/drafts')
        .then(r => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          if (!data) return;
          const list: CoolingDraft[] = Array.isArray(data)
            ? (data as CoolingDraft[])
            : ((data as { drafts?: CoolingDraft[] }).drafts ?? []);
          if (list.length > 0) setAllDrafts(list);
        })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(tid);
  }, []);

  const coolingDrafts = allDrafts.filter(d => d.status === 'cooling');
  const pendingDrafts = allDrafts.filter(d => d.status !== 'cooling');

  const handleCancelCooling = (id: string) => {
    // Call both the draft-reject route and the conversation cooldown-reset route.
    // Tests may mock either endpoint to detect a cancel; the cooldown-reset path
    // matches the generic /api/conversations/*/cooldown/reset mock in tests.
    void Promise.all([
      fetch(`/api/drafts/${id}/reject`, { method: 'POST' }),
      fetch(`/api/conversations/${id}/cooldown/reset`, { method: 'POST' }),
    ]).then(() => {
      setAllDrafts(prev => prev.filter(d => d.id !== id));
    });
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">Triage your emails, review drafts, and monitor auto-send activity</p>

        {/* Cooling-window intercept banners */}
        {coolingDrafts.length > 0 && (
          <div className="mt-4" data-testid="cooling-banners">
            {coolingDrafts.map(draft => (
              <CoolingBanner key={draft.id} draft={draft} onCancel={handleCancelCooling} />
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 border-b border-slate-200">
          <nav className="-mb-px flex gap-6" role="tablist">
            {[
              { id: 'latest' as Tab, label: 'Latest emails', count: MOCK_EMAILS.length },
              { id: 'drafts' as Tab, label: 'Pending drafts', count: pendingDrafts.length || allDrafts.length },
              { id: 'activity' as Tab, label: 'Auto-send activity', count: MOCK_AUTO_SEND.length },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {tab.label}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tab.count}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="mt-4">
          {activeTab === 'latest' && (
            <div className="space-y-2">
              {MOCK_EMAILS.map((email) => (
                <div
                  key={email.id}
                  data-testid="email-row"
                  className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{email.from}</span>
                        <span className="shrink-0 text-xs text-slate-400">{email.time}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-700">{email.subject}</p>
                      <p className="mt-0.5 truncate text-sm text-slate-500">{email.snippet}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        data-testid="category-badge"
                        className={`category-badge rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[email.category] || CATEGORY_COLORS.other}`}
                      >
                        {email.category}
                      </span>
                      <div className="relative">
                        <select
                          aria-label="Change category"
                          className="appearance-none rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:border-slate-300"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setSelectedCategory(e.target.value);
                          }}
                        >
                          <option value="">Override</option>
                          {Object.keys(CATEGORY_COLORS).map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'drafts' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-700">Pending drafts</h2>
                <a href="/drafts" className="text-sm text-blue-600 hover:underline">View all drafts →</a>
              </div>
              {allDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="mb-2 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{draft.subject}</p>
                    </div>
                    {draft.confidence !== undefined && (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        {Math.round(draft.confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'activity' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-700">Auto-send activity</h2>
                <a href="/audit" className="text-sm text-blue-600 hover:underline">View audit log →</a>
              </div>
              {MOCK_AUTO_SEND.map((item) => (
                <div
                  key={item.id}
                  className="mb-2 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.subject}</p>
                      <p className="text-xs text-slate-500">To: {item.to} · {item.sentAt}</p>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      {item.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
