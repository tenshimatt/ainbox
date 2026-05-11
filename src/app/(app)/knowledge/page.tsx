'use client';

import { useState } from 'react';
import { MOCK_KB_ITEMS, KB_TYPES } from '@/lib/mock-data';

export default function KnowledgePage() {
  const [filterType, setFilterType] = useState<string | null>(null);
  const [items] = useState(MOCK_KB_ITEMS);

  const filteredItems = filterType
    ? items.filter((item) => item.type === filterType)
    : items;

  const typeCounts = KB_TYPES.reduce(
    (acc, type) => {
      acc[type] = items.filter((i) => i.type === type).length;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Knowledge Base</h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage extracted knowledge items used for AI drafting
            </p>
          </div>
        </div>

        {/* Type filter tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType(null)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterType === null
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({items.length})
          </button>
          {KB_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filterType === type
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {type} ({typeCounts[type] || 0})
            </button>
          ))}
        </div>

        {/* Items grid */}
        <div className="mt-6 space-y-3">
          {filteredItems.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-500">No knowledge items found</p>
            </div>
          )}

          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {item.type}
                    </span>
                    {item.verified && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Verified
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-sm font-medium text-slate-900">{item.title}</h3>
                  <p className="mt-0.5 text-sm text-slate-500">{item.content}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-slate-400">
                    {Math.round(item.confidence * 100)}%
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  Edit
                </button>
                <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  Promote
                </button>
                <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  Demote
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
