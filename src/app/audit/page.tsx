'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { MOCK_AUDIT_LOG } from '@/lib/mock-data';
import type { AuditEntry } from '@/lib/mock-data';

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function generateCsv(log: AuditEntry[]): string {
  const headers = ['Timestamp', 'Model', 'Confidence', 'Decision Type', 'KB Items Referenced', 'Email Subject'];
  const rows = log.map((entry) => [
    entry.timestamp,
    entry.model,
    entry.confidence.toString(),
    entry.decisionType,
    entry.kbItemsReferenced.join('; '),
    entry.emailSubject,
  ]);
  return [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
}

export default function AuditPage() {
  const [auditLog] = useState(MOCK_AUDIT_LOG);

  const handleExportCsv = () => {
    const csv = generateCsv(auditLog);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ainbox-audit-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
            <p className="mt-1 text-sm text-slate-500">
              Track all AI decisions — classifications, drafts, and sends
            </p>
          </div>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>

        {auditLog.length === 0 ? (
          <div className="mt-10 text-center">
            <p className="text-sm text-slate-500">No audit entries yet</p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table
              data-testid="audit-log"
              className="w-full min-w-[600px] border-collapse text-sm"
            >
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-4">Timestamp</th>
                  <th className="py-3 pr-4">Model</th>
                  <th className="py-3 pr-4">Decision</th>
                  <th className="py-3 pr-4">Confidence</th>
                  <th className="py-3 pr-4">KB References</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr
                    key={entry.id}
                    data-testid="audit-row"
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <td data-testid="audit-timestamp" className="py-3 pr-4">
                      <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{entry.model}</td>
                    <td className="py-3 pr-4">
                      <span
                        data-testid="decision-type"
                        className="decision-type rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                      >
                        {entry.decisionType}
                      </span>
                    </td>
                    <td data-testid="confidence" className="confidence py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.confidence >= 0.85
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {Math.round(entry.confidence * 100)}%
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500">
                      {entry.kbItemsReferenced.length > 0
                        ? entry.kbItemsReferenced.join(', ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
