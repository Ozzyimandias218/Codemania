import React, { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.ts';

export function AdminView() {
  const [section, setSection] = useState<'curriculum' | 'daily'>('curriculum');
  const [statusFilter, setStatusFilter] = useState<'DRAFT' | 'APPROVED' | 'REJECTED'>('DRAFT');
  const [questions, setQuestions] = useState<Array<Record<string, unknown>>>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  // Daily Quiz Admin State
  const [dailyStatusFilter, setDailyStatusFilter] = useState<'DRAFT' | 'APPROVED' | 'REJECTED'>('DRAFT');
  const [dailyQuestions, setDailyQuestions] = useState<Array<Record<string, unknown>>>([]);
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

  async function refreshDaily() {
    const [dqRes, bufRes, tplRes, alertRes, lRes] = await Promise.all([
      api.adminListDailyQuestions(dailyStatusFilter),
      api.adminGetDailyBuffer(),
      api.adminListAristotleTemplates(),
      api.adminListDailyAlerts(),
      api.adminListAuditLogs(),
    ]);
    setDailyQuestions(dqRes.questions);
    setBufferOverview(bufRes);
    setTemplates(tplRes.templates);
    setAlerts(alertRes.alerts);
    setLogs(lRes.logs);
  }

  async function refresh() {
    setError(null);
    try {
      if (section === 'curriculum') {
        await refreshCurriculum();
      } else {
        await refreshDaily();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Admin access required or request failed');
    }
  }

  useEffect(() => {
    void refresh();
  }, [section, statusFilter, dailyStatusFilter]);

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

  async function handleDailyReview(id: string, decision: 'APPROVED' | 'REJECTED') {
    const reason = reasonById[id]?.trim() || (decision === 'APPROVED' ? 'Verified daily candidate' : 'Rejected candidate');
    setError(null);
    setNotice(null);
    try {
      await api.adminReviewDailyQuestion(id, { decision, reason });
      setNotice(`Daily question ${decision.toLowerCase()}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Daily review failed');
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Console</h1>
          <p className="text-sm text-slate-600 mt-1">
            Moderate lesson drafts, manage the Aristotle Daily Quiz buffer, and inspect audit history.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSection('curriculum')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              section === 'curriculum'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Curriculum Queue
          </button>
          <button
            type="button"
            onClick={() => setSection('daily')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              section === 'daily'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Aristotle Daily Quiz
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
          {notice}
        </div>
      )}

      {section === 'curriculum' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Lesson & Checkpoint Questions</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(['DRAFT', 'APPROVED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {questions.length === 0 ? (
            <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">
              No {statusFilter} questions in the queue.
            </div>
          ) : (
            questions.map((q) => {
              const id = String(q.id);
              return (
                <div key={id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500 font-mono">
                      {String(q.origin)} · {String(q.type)} · v{String(q.version ?? 1)} · {String(q.status)}
                      {q.sourceUrl ? ` · ${String(q.sourceUrl)}` : ''}
                      {q.license ? ` · ${String(q.license)}` : ''}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{String(q.prompt)}</h3>
                    <p className="text-xs text-slate-600">{String(q.explanation)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      placeholder="Review reason..."
                      value={reasonById[id] ?? ''}
                      onChange={(e) => setReasonById({ ...reasonById, [id]: e.target.value })}
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => void handleReview(id, 'APPROVED')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReview(id, 'REJECTED')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
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
        <div className="space-y-8">
          {/* Buffer Overview + Scheduler */}
          {bufferOverview && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">7-Day Daily Quiz Buffer</h2>
                  <p className="text-xs text-slate-600 font-mono tabular-nums mt-0.5">
                    Today ({bufferOverview.dailyTz}): {bufferOverview.todayDate} · Reserve pool available:{' '}
                    {bufferOverview.availableReserveCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunScheduler()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Run Daily Scheduler
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Approved</th>
                      <th className="py-2 pr-4">Publishable</th>
                      <th className="py-2">Reserve Fallback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {bufferOverview.days.map((d) => (
                      <tr key={d.quizDate}>
                        <td className="py-2 pr-4 text-slate-900 font-semibold">{d.quizDate}</td>
                        <td className="py-2 pr-4 text-slate-700">{d.status ?? 'UNSCHEDULED'}</td>
                        <td className="py-2 pr-4 text-slate-700">{d.approvedCount} / 7</td>
                        <td className="py-2 pr-4 text-slate-700">{d.publishable ? 'Yes' : 'No'}</td>
                        <td className="py-2 text-slate-600">{d.usedReserveFallback ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {alerts.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">Open Alerts</h2>
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-4 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-amber-900">{a.type}</span>
                    {a.quizDate ? ` · ${a.quizDate}` : ''} — {a.message}
                  </div>
                  <button
                    type="button"
                    onClick={() => void api.adminResolveDailyAlert(a.id).then(() => refresh())}
                    className="px-3 py-1.5 font-semibold text-amber-900 bg-white border border-amber-300 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </section>
          )}

          {/* Daily Question Moderation Queue */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Daily Question Review Queue</h2>
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                {(['DRAFT', 'APPROVED', 'REJECTED'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setDailyStatusFilter(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      dailyStatusFilter === st
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {dailyQuestions.length === 0 ? (
              <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">
                No {dailyStatusFilter} daily questions found.
              </div>
            ) : (
              dailyQuestions.slice(0, 10).map((q) => {
                const id = String(q.id);
                return (
                  <div key={id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <div className="text-xs text-slate-500 font-mono">
                      {String(q.generatedBy)} · {String(q.type)} · {String(q.status)}
                      {q.sourceUrl ? ` · ${String(q.sourceUrl)}` : ''}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{String(q.prompt)}</h3>
                    <p className="text-xs text-slate-600">
                      Key: <span className="font-mono">{String(q.correctAnswer)}</span> —{' '}
                      {String(q.explanation)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                      <input
                        type="text"
                        placeholder="Review reason..."
                        value={reasonById[id] ?? ''}
                        onChange={(e) => setReasonById({ ...reasonById, [id]: e.target.value })}
                        className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleDailyReview(id, 'APPROVED')}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDailyReview(id, 'REJECTED')}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* Aristotle Templates */}
          <section className="space-y-3">
            <h2 className="text-base font-bold text-slate-900">Aristotle Voice Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <div key={tpl.key} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="text-xs font-mono font-semibold text-slate-500">{tpl.key}</div>
                  <textarea
                    rows={2}
                    value={tpl.body}
                    onChange={(e) =>
                      setTemplates((prev) =>
                        prev.map((item) => (item.key === tpl.key ? { ...item, body: e.target.value } : item)),
                      )
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleSaveTemplate(tpl.key, tpl.title, tpl.body)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Recent Audit Log</h2>
        {logs.length === 0 ? (
          <div className="p-5 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
            No audit log entries recorded yet.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50">
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Entity</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((log) => (
                  <tr key={String(log.id)}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {String(log.action)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {String(log.entityType)} · {String(log.entityId).slice(0, 8)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{String(log.reason ?? '—')}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">
                      {new Date(String(log.createdAt)).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
