import React, { useEffect, useState } from 'react';
import { ApiError, ReviewQueueItem, api } from '../lib/api.ts';

export function ReviewQueueView() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api.getMyReviewQueue();
        if (active) setItems(res.items);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load review queue');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const intervals = ['+1 day', '+3 days', '+7 days'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Spaced Repetition Review Queue</h1>
        <p className="text-sm text-slate-600 mt-1">
          Missed questions return automatically at +1 day, +3 days, and +7 days until answered
          correctly twice in a row.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Loading review queue...
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">
          Your review queue is clear. Wrong answers from lessons or checkpoints will appear here.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50">
                <th className="py-3 px-4">Question</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Streak</th>
                <th className="py-3 px-4">Wrong Count</th>
                <th className="py-3 px-4">Next Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 px-4 text-slate-900">
                    {item.question?.prompt ?? item.questionId}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    {intervals[item.intervalStage] ?? '+7 days'}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-900 tabular-nums">
                    {item.consecutiveCorrect} / 2
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    {item.wrongCount}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    {item.isDue ? 'Due now' : new Date(item.nextReviewAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
