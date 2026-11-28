import React, { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.ts';
import { StripeWebhookLogsPanel } from './StripeWebhookLogsPanel.tsx';

export function AdminView() {
  const [section, setSection] = useState<'curriculum' | 'zugzwang' | 'webhooks'>('curriculum');
  const [statusFilter, setStatusFilter] = useState<'DRAFT' | 'APPROVED' | 'REJECTED'>('DRAFT');
  const [questions, setQuestions] = useState<Array<Record<string, unknown>>>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  // Zugzwang Admin State
  const [zugzwangStatusFilter, setZugzwangStatusFilter] = useState<'DRAFT' | 'APPROVED' | 'REJECTED'>('DRAFT');
  const [zugzwangQuestions, setZugzwangQuestions] = useState<Array<Record<string, unknown>>>([]);
  const [bufferOverview, setBufferOverview] = useState<Awaited<ReturnType<typeof api.adminGetDailyBuffer>> | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; key: string; title: string; body: string }>>([]);
  const [alerts, setAlerts] = useState<Array<{ id: string; type: string; message: string; quizDate: string | null }>>([]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshCurriculum() {
    const [qRes, lRes] = await Promise.all([
      api.adminListQuestions(statusFilter),
      api.adminListAuditLogs(),
    ]);
    setQuestions(qRes.questions);
    setLogs(lRes.logs);
  }

  async function refreshZugzwang() {
    const [dqRes, bufRes, tplRes, alertRes, lRes] = await Promise.all([
      api.adminListDailyQuestions(zugzwangStatusFilter),
      api.adminGetDailyBuffer(),
      api.adminListAristotleTemplates(),
      api.adminListDailyAlerts(),
      api.adminListAuditLogs(),
    ]);
    setZugzwangQuestions(dqRes.questions);
    setBufferOverview(bufRes);
    setTemplates(tplRes.templates);
    setAlerts(alertRes.alerts);
    setLogs(lRes.logs);
  }

  async function refresh() {
    if (section === 'webhooks') return;
    setError(null);
    try {
      if (section === 'curriculum') {
        await refreshCurriculum();
      } else {
        await refreshZugzwang();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Admin access required or request failed');
    }
  }

  useEffect(() => {
    void refresh();
  }, [section, statusFilter, zugzwangStatusFilter]);

  async function handleReview(id: string, decision: 'APPROVED' | 'REJECTED') {
    const reason = reasonById[id]?.trim() || (decision === 'APPROVED' ? 'Verified accuracy and license' : 'Needs revision');
    setError(null);
    setNotice(null);
    try {
      await api.adminReviewQuestion(id, { decision, reason });
      setNotice(`Curriculum question ${decision.toLowerCase()}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Review action failed');
    }
  }

  async function handleZugzwangReview(id: string, decision: 'APPROVED' | 'REJECTED') {
    const reason = reasonById[id]?.trim() || (decision === 'APPROVED' ? 'Verified Zugzwang candidate' : 'Rejected candidate');
    setError(null);
    setNotice(null);
    try {
      await api.adminReviewDailyQuestion(id, { decision, reason });
      setNotice(`Zugzwang question ${decision.toLowerCase()}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zugzwang review failed');
    }
  }

  async function handleRunScheduler() {
    setError(null);
    setNotice(null);
    try {
      const res = await api.adminRunDailyScheduler();
      setNotice(
        `Scheduler executed for ${res.todayDate}: closed ${res.closedCount}, buffered ${res.bufferedDatesCreated.length} day(s).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Scheduler run failed');
    }
  }

  async function handleSaveTemplate(key: string, title: string, body: string) {
    setError(null);
    setNotice(null);
    try {
      await api.adminUpdateAristotleTemplate(key, { title, body });
      setNotice(`Updated Aristotle template ${key}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Template update failed');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1D2433] dark:text-[#E8EBF4]">Admin Console</h1>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] mt-1">
            Moderate lesson drafts, manage the Zugzwang buffer, and inspect Stripe webhook logs.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
          <button
            type="button"
            onClick={() => setSection('curriculum')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              section === 'curriculum'
                ? 'bg-white dark:bg-[#1A1D28] text-[#4F46E5] dark:text-[#A5B4FC]'
                : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
            }`}
          >
            Curriculum Queue
          </button>
          <button
            type="button"
            onClick={() => setSection('zugzwang')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              section === 'zugzwang'
                ? 'bg-white dark:bg-[#1A1D28] text-[#7C3AED] dark:text-[#C4B5FD]'
                : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
            }`}
          >
            Zugzwang
          </button>
          <button
            type="button"
            onClick={() => setSection('webhooks')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              section === 'webhooks'
                ? 'bg-white dark:bg-[#1A1D28] text-[#4F46E5] dark:text-[#A5B4FC]'
                : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
            }`}
          >
            Stripe Webhooks
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 text-sm font-medium text-[#15803D] dark:text-[#4ADE80] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
          {notice}
        </div>
      )}

      {section === 'webhooks' ? (
        <StripeWebhookLogsPanel />
      ) : section === 'curriculum' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
              Lesson & Checkpoint Questions
            </h2>
            <div className="flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
              {(['DRAFT', 'APPROVED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    statusFilter === st
                      ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                      : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {questions.length === 0 ? (
            <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
              No {statusFilter} questions in the queue.
            </div>
          ) : (
            questions.map((q) => {
              const id = String(q.id);
              return (
                <div
                  key={id}
                  className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-3"
                >
                  <div className="space-y-1">
                    <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono">
                      {String(q.origin)} · {String(q.type)} · v{String(q.version ?? 1)} · {String(q.status)}
                      {q.sourceUrl ? ` · ${String(q.sourceUrl)}` : ''}
                      {q.license ? ` · ${String(q.license)}` : ''}
                    </div>
                    <h3 className="text-sm font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                      {String(q.prompt)}
                    </h3>
                    <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">
                      {String(q.explanation)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#D5DCE8] dark:border-[#363D57]">
                    <input
                      type="text"
                      placeholder="Review reason..."
                      value={reasonById[id] ?? ''}
                      onChange={(e) => setReasonById({ ...reasonById, [id]: e.target.value })}
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => void handleReview(id, 'APPROVED')}
                      className="px-3 py-1.5 text-xs font-semibold text-white dark:text-[#0B1F13] bg-[#15803D] hover:bg-[#166534] dark:bg-[#4ADE80] dark:hover:bg-[#22C55E] rounded-lg"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReview(id, 'REJECTED')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {bufferOverview && (
            <section className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                    7-Day Zugzwang Buffer
                  </h2>
                  <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums mt-0.5">
                    Today ({bufferOverview.dailyTz}): {bufferOverview.todayDate} · Reserve pool available:{' '}
                    {bufferOverview.availableReserveCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunScheduler()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Run Zugzwang Scheduler
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#D5DCE8] dark:border-[#363D57] text-[#4B556B] dark:text-[#B4BCD0]">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Approved</th>
                      <th className="py-2 pr-4">Publishable</th>
                      <th className="py-2">Reserve Fallback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D5DCE8] dark:divide-[#363D57] font-mono tabular-nums">
                    {bufferOverview.days.map((d) => (
                      <tr key={d.quizDate}>
                        <td className="py-2 pr-4 text-[#1D2433] dark:text-[#E8EBF4] font-semibold">
                          {d.quizDate}
                        </td>
                        <td className="py-2 pr-4 text-[#4B556B] dark:text-[#B4BCD0]">
                          {d.status ?? 'UNSCHEDULED'}
                        </td>
                        <td className="py-2 pr-4 text-[#4B556B] dark:text-[#B4BCD0]">
                          {d.approvedCount} / 7
                        </td>
                        <td
                          className={`py-2 pr-4 font-semibold ${
                            d.publishable
                              ? 'text-[#15803D] dark:text-[#4ADE80]'
                              : 'text-[#C2410C] dark:text-[#FB923C]'
                          }`}
                        >
                          {d.publishable ? 'Yes' : 'No'}
                        </td>
                        <td className="py-2 text-[#4B556B] dark:text-[#B4BCD0]">
                          {d.usedReserveFallback ? 'Yes' : 'No'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {alerts.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                Open Alerts
              </h2>
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="p-4 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl flex items-center justify-between gap-4 text-xs text-[#1D2433] dark:text-[#E8EBF4]"
                >
                  <div>
                    <span className="font-mono font-semibold text-[#C2410C] dark:text-[#FB923C]">
                      {a.type}
                    </span>
                    {a.quizDate ? ` · ${a.quizDate}` : ''}: {a.message}
                  </div>
                  <button
                    type="button"
                    onClick={() => void api.adminResolveDailyAlert(a.id).then(() => refresh())}
                    className="px-3 py-1.5 font-semibold text-[#C2410C] dark:text-[#FB923C] bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg whitespace-nowrap shrink-0"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                Zugzwang Question Review Queue
              </h2>
              <div className="flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
                {(['DRAFT', 'APPROVED', 'REJECTED'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setZugzwangStatusFilter(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      zugzwangStatusFilter === st
                        ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                        : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {zugzwangQuestions.length === 0 ? (
              <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
                No {zugzwangStatusFilter} Zugzwang questions found.
              </div>
            ) : (
              zugzwangQuestions.slice(0, 10).map((q) => {
                const id = String(q.id);
                return (
                  <div
                    key={id}
                    className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-3"
                  >
                    <div className="text-xs text-[#7C3AED] dark:text-[#C4B5FD] font-mono">
                      Candidate · {String(q.type)} · {String(q.status)}
                      {q.sourceUrl ? ` · ${String(q.sourceUrl)}` : ''}
                    </div>
                    <h3 className="text-sm font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                      {String(q.prompt)}
                    </h3>
                    <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">
                      Key: <span className="font-mono">{String(q.correctAnswer)}</span> -{' '}
                      {String(q.explanation)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#D5DCE8] dark:border-[#363D57]">
                      <input
                        type="text"
                        placeholder="Moderation note..."
                        value={reasonById[id] ?? ''}
                        onChange={(e) => setReasonById({ ...reasonById, [id]: e.target.value })}
                        className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleZugzwangReview(id, 'APPROVED')}
                        className="px-3 py-1.5 text-xs font-semibold text-white dark:text-[#0B1F13] bg-[#15803D] hover:bg-[#166534] dark:bg-[#4ADE80] dark:hover:bg-[#22C55E] rounded-lg"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleZugzwangReview(id, 'REJECTED')}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
              Aristotle Voice Templates
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.key}
                  className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-4 space-y-2.5"
                >
                  <div className="text-xs font-mono font-semibold text-[#7C3AED] dark:text-[#C4B5FD]">
                    {tpl.key}
                  </div>
                  <textarea
                    rows={2}
                    value={tpl.body}
                    onChange={(e) =>
                      setTemplates((prev) =>
                        prev.map((item) => (item.key === tpl.key ? { ...item, body: e.target.value } : item)),
                      )
                    }
                    className="w-full px-3 py-2 text-xs bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSaveTemplate(tpl.key, tpl.title, tpl.body)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg"
                    >
                      Save Template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {section !== 'webhooks' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
            Recent Audit Log
          </h2>
          {logs.length === 0 ? (
            <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
              No audit log entries recorded yet.
            </div>
          ) : (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#D5DCE8] dark:border-[#363D57] text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0] bg-[#EEF1F7] dark:bg-[#222638]">
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Reason</th>
                    <th className="py-2.5 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D5DCE8] dark:divide-[#363D57] text-xs">
                  {logs.map((log) => (
                    <tr key={String(log.id)}>
                      <td className="py-2.5 px-4 font-mono font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                        {String(log.action)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#4B556B] dark:text-[#B4BCD0]">
                        {String(log.entityType)} · {String(log.entityId).slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-4 text-[#1D2433] dark:text-[#E8EBF4]">
                        {String(log.reason ?? '-')}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                        {new Date(String(log.createdAt)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
