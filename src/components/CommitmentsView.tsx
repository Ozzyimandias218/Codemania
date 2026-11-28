import React, { useEffect, useState } from 'react';
import { ApiError, CommitmentItem, PublicQuestion, TrackSummary, api } from '../lib/api.ts';

export function CommitmentsView() {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [commitments, setCommitments] = useState<CommitmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [trackId, setTrackId] = useState('');
  const [durationDays, setDurationDays] = useState(20);
  const [mode, setMode] = useState<'SIMULATED' | 'DEPOSIT_REFUND' | 'PENALTY'>('SIMULATED');
  const [missedDayMode, setMissedDayMode] = useState<'INACTIVE_DAYS' | 'LATE_DAYS'>('INACTIVE_DAYS');
  const [dailyPenaltyCents, setDailyPenaltyCents] = useState(100);
  const [finalFailPenaltyCents, setFinalFailPenaltyCents] = useState(1000);
  const [maxTotalPenaltyCents, setMaxTotalPenaltyCents] = useState(2500);
  const [acknowledgePace, setAcknowledgePace] = useState(false);
  const [pacePrompt, setPacePrompt] = useState<{
    requiredLevelsPerDay: number;
    maxLevelsPerDay: number;
  } | null>(null);

  const [activeExam, setActiveExam] = useState<{
    commitmentId: string;
    submissionId: string;
    questions: PublicQuestion[];
  } | null>(null);
  const [examAnswers, setExamAnswers] = useState<Record<string, string>>({});
  const [projectUrls, setProjectUrls] = useState<Record<string, string>>({});
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});

  async function loadAll() {
    setLoading(true);
    try {
      const [tr, co] = await Promise.all([api.getTracks(), api.getCommitments()]);
      setTracks(tr.tracks);
      setCommitments(co.commitments);
      if (!trackId && tr.tracks[0]) {
        setTrackId(tr.tracks[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load commitments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPacePrompt(null);
    try {
      const res = await api.createCommitment({
        trackId,
        durationDays: Number(durationDays),
        mode,
        missedDayMode,
        dailyPenaltyCents: Number(dailyPenaltyCents),
        finalFailPenaltyCents: Number(finalFailPenaltyCents),
        maxTotalPenaltyCents: Number(maxTotalPenaltyCents),
        termsVersion: '2026-11-v1',
        acknowledgePace,
      });
      setNotice(
        `Commitment created (${res.requiredLevelsPerDay} levels/day required).`,
      );
      setAcknowledgePace(false);
      await loadAll();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PACE_CONFIRMATION_REQUIRED') {
        const details = err.details as { requiredLevelsPerDay: number; maxLevelsPerDay: number };
        setPacePrompt(details);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not create commitment');
      }
    }
  }

  async function handleStartExam(commitmentId: string) {
    setError(null);
    try {
      const res = await api.startFinalExam(commitmentId);
      setActiveExam({
        commitmentId,
        submissionId: res.submissionId,
        questions: res.questions,
      });
      setExamAnswers({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start final exam');
    }
  }

  async function handleSubmitExam(e: React.FormEvent) {
    e.preventDefault();
    if (!activeExam) return;
    setError(null);
    try {
      const answers = activeExam.questions.map((q) => ({
        questionId: q.id,
        answer: examAnswers[q.id] ?? '',
      }));
      const res = await api.submitFinal(activeExam.commitmentId, {
        type: 'EXAM',
        submissionId: activeExam.submissionId,
        answers,
      });
      setNotice(
        `Final exam submitted: ${Math.round(((res.scorePct as number) ?? 0) * 100)}% (${res.passed ? 'PASSED' : 'FAILED'})`,
      );
      setActiveExam(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit final exam');
    }
  }

  async function handleSubmitProject(commitmentId: string) {
    const url = projectUrls[commitmentId];
    if (!url) return;
    setError(null);
    try {
      await api.submitFinal(commitmentId, {
        type: 'PROJECT',
        projectUrl: url,
      });
      setNotice('Project submitted for admin review.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit project');
    }
  }

  async function handleAppeal(commitmentId: string) {
    const reason = appealReasons[commitmentId];
    if (!reason || reason.trim().length < 5) return;
    setError(null);
    try {
      await api.createAppeal(commitmentId, { reason });
      setNotice('Appeal filed. Charging is frozen until an admin decides.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to file appeal');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12 items-start">
      <div className="lg:col-span-5 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            New Commitment Contract
          </h2>
          <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] mt-0.5">
            Simulated mode computes and tracks penalties without calling Stripe.
          </p>
        </div>

        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
              Track
            </label>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.levelCount} levels)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                Duration (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
              >
                <option value="SIMULATED">SIMULATED</option>
                <option value="PENALTY">PENALTY</option>
                <option value="DEPOSIT_REFUND">DEPOSIT_REFUND</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
              Missed-Day Rule
            </label>
            <select
              value={missedDayMode}
              onChange={(e) => setMissedDayMode(e.target.value as typeof missedDayMode)}
              className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
            >
              <option value="INACTIVE_DAYS">INACTIVE_DAYS (2 excused days default)</option>
              <option value="LATE_DAYS">LATE_DAYS (after deadline + 24h grace)</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0] mb-1">
                Daily (cents)
              </label>
              <input
                type="number"
                min={0}
                value={dailyPenaltyCents}
                onChange={(e) => setDailyPenaltyCents(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0] mb-1">
                Final fail (cents)
              </label>
              <input
                type="number"
                min={0}
                value={finalFailPenaltyCents}
                onChange={(e) => setFinalFailPenaltyCents(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0] mb-1">
                Max cap (cents)
              </label>
              <input
                type="number"
                min={0}
                value={maxTotalPenaltyCents}
                onChange={(e) => setMaxTotalPenaltyCents(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
              />
            </div>
          </div>

          {pacePrompt && (
            <div className="p-3 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg space-y-2 text-xs text-[#C2410C] dark:text-[#FB923C]">
              <p>
                Pace warning: {pacePrompt.requiredLevelsPerDay} levels/day exceeds recommended max (
                {pacePrompt.maxLevelsPerDay} levels/day).
              </p>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                <input
                  type="checkbox"
                  checked={acknowledgePace}
                  onChange={(e) => setAcknowledgePace(e.target.checked)}
                  className="accent-[#F97316]"
                />
                <span>I acknowledge this pace and want to proceed</span>
              </label>
            </div>
          )}

          {error && (
            <div className="p-3 text-xs font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 text-xs font-medium text-[#15803D] dark:text-[#4ADE80] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
              {notice}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors"
          >
            Create Commitment
          </button>
        </form>
      </div>

      <div className="lg:col-span-7 space-y-6">
        {activeExam && (
          <form
            onSubmit={handleSubmitExam}
            className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
              <h3 className="text-base font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                Final Exam (60% to pass)
              </h3>
              <button
                type="button"
                onClick={() => setActiveExam(null)}
                className="text-xs text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]"
              >
                Cancel
              </button>
            </div>
            <div className="space-y-4">
              {activeExam.questions.map((q, i) => (
                <div
                  key={q.id}
                  className="space-y-2 pb-3 border-b border-[#D5DCE8] dark:border-[#363D57] last:border-0"
                >
                  <p className="text-sm font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                    {i + 1}. {q.prompt}
                  </p>
                  {q.codeSnippet && (
                    <pre className="p-2.5 bg-[#12141C] text-[#E8EBF4] border border-[#363D57] rounded-lg text-xs font-mono">
                      {q.codeSnippet}
                    </pre>
                  )}
                  {q.type === 'MULTIPLE_CHOICE' && q.options ? (
                    <div className="grid gap-1.5">
                      {q.options.map((opt, idx) => (
                        <label
                          key={idx}
                          className="flex items-center gap-2 text-xs text-[#1D2433] dark:text-[#E8EBF4] cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={`exam-${q.id}`}
                            value={String(idx)}
                            checked={examAnswers[q.id] === String(idx)}
                            onChange={(e) =>
                              setExamAnswers({ ...examAnswers, [q.id]: e.target.value })
                            }
                            className="accent-[#4F46E5]"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={examAnswers[q.id] ?? ''}
                      onChange={(e) =>
                        setExamAnswers({ ...examAnswers, [q.id]: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="submit"
              className="w-full py-2 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors"
            >
              Submit Final Exam
            </button>
          </form>
        )}

        {loading ? (
          <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
            Loading commitments...
          </div>
        ) : commitments.length === 0 ? (
          <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
            No commitments yet. Create a simulated contract on the left to test pace checks,
            penalties, final exams, and appeals.
          </div>
        ) : (
          commitments.map((c) => (
            <div
              key={c.id}
              className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
                <div>
                  <h3 className="text-base font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                    {c.track?.title ?? 'Track'} · {c.durationDays} days
                  </h3>
                  <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums mt-0.5">
                    {c.mode} · {c.missedDayMode} · {c.requiredLevelsPerDay} levels/day · Status:{' '}
                    <span
                      className={
                        c.status === 'CLOSED' || c.status === 'ACTIVE'
                          ? 'text-[#15803D] dark:text-[#4ADE80] font-semibold'
                          : c.status === 'PENALTY_DUE'
                            ? 'text-[#DC2626] dark:text-[#F87171] font-semibold'
                            : ''
                      }
                    >
                      {c.status}
                    </span>
                    {c.hasActiveAppeal ? ' · APPEAL FROZEN' : ''}
                  </p>
                </div>
                {!c.finalPassedAt && (
                  <button
                    type="button"
                    onClick={() => void handleStartExam(c.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg whitespace-nowrap"
                  >
                    Take Final Exam
                  </button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://github.com/you/project"
                    value={projectUrls[c.id] ?? ''}
                    onChange={(e) => setProjectUrls({ ...projectUrls, [c.id]: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSubmitProject(c.id)}
                    className="px-3 py-1.5 font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg whitespace-nowrap"
                  >
                    Submit Project
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Appeal reason (freezes charging)"
                    value={appealReasons[c.id] ?? ''}
                    onChange={(e) =>
                      setAppealReasons({ ...appealReasons, [c.id]: e.target.value })
                    }
                    className="flex-1 px-2.5 py-1.5 bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAppeal(c.id)}
                    className="px-3 py-1.5 font-medium text-[#C2410C] dark:text-[#FB923C] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg whitespace-nowrap"
                  >
                    File Appeal
                  </button>
                </div>
              </div>

              {c.finalSubmissions.length > 0 && (
                <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] space-y-1 pt-2 border-t border-[#D5DCE8] dark:border-[#363D57]">
                  {c.finalSubmissions.map((s) => (
                    <div key={s.id} className="font-mono">
                      {s.type} #{s.attemptNumber} · {s.status}
                      {s.scorePct !== undefined ? ` · ${Math.round(s.scorePct * 100)}%` : ''}
                      {s.projectUrl ? ` · ${s.projectUrl}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
