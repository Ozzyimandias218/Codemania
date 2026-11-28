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
        <h1 className="text-2xl font-bold text-[#1D2433] dark:text-[#E8EBF4]">
          Spaced Repetition Review Queue
        </h1>
        <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] mt-1">
          Missed questions return automatically at +1 day, +3 days, and +7 days until answered
          correctly twice in a row.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
          Loading review queue...
        </div>
      ) : items.length === 0 ? (
        <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
          Your review queue is clear. Wrong answers from lessons or checkpoints will appear here.
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#D5DCE8] dark:border-[#363D57] text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0] bg-[#EEF1F7] dark:bg-[#222638]">
                <th className="py-3 px-4">Question</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Streak</th>
                <th className="py-3 px-4">Wrong Count</th>
                <th className="py-3 px-4">Next Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D5DCE8] dark:divide-[#363D57] text-sm">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 px-4 text-[#1D2433] dark:text-[#E8EBF4]">
                    {item.question?.prompt ?? item.questionId}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                    {intervals[item.intervalStage] ?? '+7 days'}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-[#15803D] dark:text-[#4ADE80] tabular-nums font-semibold">
                    {item.consecutiveCorrect} / 2
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                    {item.wrongCount}
                  </td>
                  <td
                    className={`py-3 px-4 font-mono text-xs tabular-nums ${
                      item.isDue
                        ? 'text-[#C2410C] dark:text-[#FB923C] font-semibold'
                        : 'text-[#4B556B] dark:text-[#B4BCD0]'
                    }`}
                  >
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
