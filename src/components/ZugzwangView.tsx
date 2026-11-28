import React, { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.ts';

interface ActiveZugzwangQuestion {
  id: string;
  position: number;
  type: 'ESTIMATE' | 'MULTIPLE_CHOICE';
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: string[] | null;
}

interface SubmittedFeedback {
  questionId: string;
  position: number;
  givenValue: string | null;
  score: number;
  timeMs: number;
  isLate: boolean;
  correctAnswer: string;
  numericAnswer: number | null;
  explanation: string;
  aristotleFeedback: string;
  isFinalQuestion: boolean;
}

export function ZugzwangView() {
  const [todayState, setTodayState] = useState<Awaited<ReturnType<typeof api.getDailyToday>> | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<ActiveZugzwangQuestion | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const [selectedMc, setSelectedMc] = useState<string>('');
  const [estimateInput, setEstimateInput] = useState<string>('');
  const [feedback, setFeedback] = useState<SubmittedFeedback | null>(null);
  const [resultData, setResultData] = useState<Awaited<ReturnType<typeof api.getDailyResult>> | null>(null);

  const [period, setPeriod] = useState<'daily' | 'weekly' | 'all-time'>('daily');
  const [leaderboard, setLeaderboard] = useState<Awaited<ReturnType<typeof api.getLeaderboard>> | null>(null);
  const [myRank, setMyRank] = useState<Awaited<ReturnType<typeof api.getMyLeaderboard>> | null>(null);

  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [countryInput, setCountryInput] = useState<string>('');
  const [profileStatus, setProfileStatus] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshLeaderboard(selectedPeriod = period) {
    try {
      const [lb, me] = await Promise.all([
        api.getLeaderboard(selectedPeriod, 10),
        api.getMyLeaderboard(selectedPeriod),
      ]);
      setLeaderboard(lb);
      setMyRank(me);
    } catch {
      // Keep UI responsive
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const today = await api.getDailyToday();
      setTodayState(today);
      if (today.state === 'IN_PROGRESS') {
        const q = await api.getDailyQuestion();
        setActiveQuestion(q.question);
        setSecondsLeft(q.timeRemainingSeconds);
      } else if (today.state === 'DONE') {
        const res = await api.getDailyResult();
        setResultData(res);
      }
      await refreshLeaderboard(period);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Zugzwang state');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    void refreshLeaderboard(period);
  }, [period]);

  useEffect(() => {
    if (!activeQuestion || feedback) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeQuestion?.id, feedback]);

  async function handleStartZugzwang() {
    setError(null);
    setSubmitting(true);
    try {
      const started = await api.startZugzwang();
      setActiveQuestion(started.question);
      setSecondsLeft(started.timeRemainingSeconds);
      setFeedback(null);
      setSelectedMc('');
      setEstimateInput('');
      setTodayState((prev) =>
        prev
          ? {
              ...prev,
              state: 'IN_PROGRESS',
              currentPosition: 1,
              timeRemainingSeconds: started.timeRemainingSeconds,
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start Zugzwang');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!activeQuestion || submitting) return;
    setError(null);
    setSubmitting(true);
    const givenValue =
      activeQuestion.type === 'ESTIMATE' ? estimateInput.trim() || null : selectedMc || null;
    try {
      const res = await api.submitDailyAnswer({
        questionId: activeQuestion.id,
        givenValue,
        quizDate: todayState?.quizDate,
      });
      setFeedback(res);
      setTodayState((prev) =>
        prev
          ? {
              ...prev,
              totalScore: res.attempt.totalScore,
              totalTimeMs: res.attempt.totalTimeMs,
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNextOrFinish() {
    if (!feedback) return;
    setError(null);
    setSubmitting(true);
    try {
      if (feedback.isFinalQuestion) {
        const res = await api.getDailyResult();
        setResultData(res);
        setActiveQuestion(null);
        setFeedback(null);
        setTodayState((prev) =>
          prev
            ? { ...prev, state: 'DONE', totalScore: res.totalScore, totalTimeMs: res.totalTimeMs }
            : prev,
        );
        await refreshLeaderboard(period);
      } else {
        const nextQ = await api.getDailyQuestion();
        setActiveQuestion(nextQ.question);
        setSecondsLeft(nextQ.timeRemainingSeconds);
        setFeedback(null);
        setSelectedMc('');
        setEstimateInput('');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load next question');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileStatus(null);
    setError(null);
    try {
      const updated = await api.updateProfile({
        displayName: displayNameInput.trim(),
        country: countryInput.trim() ? countryInput.trim().toUpperCase() : undefined,
      });
      setProfileStatus(`Approved handle: ${updated.displayName}`);
      await refreshLeaderboard(period);
    } catch (err) {
      setProfileStatus(err instanceof ApiError ? err.message : 'Moderation check failed');
    }
  }

  if (loading) {
    return (
      <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
        Loading Zugzwang...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <section className="lg:col-span-7 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#D5DCE8] dark:border-[#363D57] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1D2433] dark:text-[#E8EBF4]">
              Zugzwang
            </h1>
            <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums mt-1">
              {todayState?.quizDate} · {todayState?.dailyTz} · 7 Questions
            </div>
          </div>

          {todayState?.state === 'IN_PROGRESS' && activeQuestion && (
            <div className="flex items-center gap-4 text-sm font-mono tabular-nums">
              <span className="text-[#4B556B] dark:text-[#B4BCD0] font-semibold">
                Q{activeQuestion.position}/7
              </span>
              <span
                className={`font-semibold ${
                  secondsLeft <= 10
                    ? 'text-[#C2410C] dark:text-[#FB923C]'
                    : 'text-[#1D2433] dark:text-[#E8EBF4]'
                }`}
              >
                {secondsLeft}s remaining
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 text-sm font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
            {error}
          </div>
        )}

        {todayState?.state === 'NOT_STARTED' && !activeQuestion && (
          <div className="space-y-5">
            <div className="p-4 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl space-y-2">
              <p className="text-sm text-[#1D2433] dark:text-[#E8EBF4] leading-relaxed">
                {todayState.aristotleIntro}
              </p>
              <button
                type="button"
                onClick={() =>
                  void api
                    .aristotleSpeak({ text: todayState.aristotleIntro })
                    .then((res) => new Audio(`data:${res.mimeType};base64,${res.audioBase64}`).play())
                    .catch(() => {})
                }
                className="text-xs font-semibold text-[#7C3AED] dark:text-[#C4B5FD] hover:underline"
              >
                Play audio intro
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 py-4 border-y border-[#D5DCE8] dark:border-[#363D57] text-sm">
              <div>
                <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">Time per question</div>
                <div className="font-mono font-semibold text-[#1D2433] dark:text-[#E8EBF4] tabular-nums mt-0.5">
                  {todayState.timeLimitSeconds}s
                </div>
              </div>
              <div>
                <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">Max score</div>
                <div className="font-mono font-semibold text-[#B45309] dark:text-[#F59E0B] tabular-nums mt-0.5">
                  7,000 pts
                </div>
              </div>
              <div>
                <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">Attempts allowed</div>
                <div className="font-mono font-semibold text-[#1D2433] dark:text-[#E8EBF4] tabular-nums mt-0.5">
                  1 per day
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={!todayState.available || submitting}
              onClick={() => void handleStartZugzwang()}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-xl transition-colors"
            >
              {submitting ? 'Starting...' : 'Start Zugzwang'}
            </button>
          </div>
        )}

        {activeQuestion && (
          <div className="space-y-5">
            <div className="text-xs text-[#7C3AED] dark:text-[#C4B5FD] font-semibold">
              Question {activeQuestion.position} of 7 ·{' '}
              {activeQuestion.type === 'ESTIMATE' ? 'Numeric Estimate' : 'Multiple Choice'}
            </div>
            <h2 className="text-lg font-semibold text-[#1D2433] dark:text-[#E8EBF4] leading-snug">
              {activeQuestion.prompt}
            </h2>

            {activeQuestion.codeSnippet && (
              <pre className="p-4 bg-[#12141C] text-[#E8EBF4] border border-[#363D57] text-xs font-mono rounded-lg overflow-x-auto">
                <code>{activeQuestion.codeSnippet}</code>
              </pre>
            )}

            {!feedback ? (
              <form onSubmit={(e) => void handleSubmitAnswer(e)} className="space-y-4">
                {activeQuestion.type === 'MULTIPLE_CHOICE' && activeQuestion.options ? (
                  <div className="space-y-2">
                    {activeQuestion.options.map((opt, idx) => {
                      const val = String(idx);
                      const checked = selectedMc === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSelectedMc(val)}
                          className={`w-full text-left px-4 py-3 text-sm rounded-lg border border-[#D5DCE8] dark:border-[#363D57] transition-colors flex items-center justify-between gap-3 ${
                            checked
                              ? 'bg-[#EEF1F7] dark:bg-[#222638] text-[#1D2433] dark:text-[#E8EBF4] font-semibold'
                              : 'bg-white dark:bg-[#1A1D28] hover:bg-[#EEF1F7] dark:hover:bg-[#222638] text-[#1D2433] dark:text-[#E8EBF4]'
                          }`}
                        >
                          <span>
                            <span className="font-mono text-xs text-[#4B556B] dark:text-[#B4BCD0] mr-3">
                              {idx + 1}.
                            </span>
                            {opt}
                          </span>
                          {checked && (
                            <span className="text-xs font-mono text-[#7C3AED] dark:text-[#C4B5FD] shrink-0">
                              Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0] mb-1.5">
                      Numeric estimate
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Enter your best numeric estimate..."
                      value={estimateInput}
                      onChange={(e) => setEstimateInput(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">
                    Server enforces the {todayState?.timeLimitSeconds ?? 60}s clock.
                  </span>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-lg transition-colors"
                  >
                    {submitting ? 'Submitting...' : 'Submit Answer'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 pt-4 border-t border-[#D5DCE8] dark:border-[#363D57]">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    {feedback.score >= 700 && !feedback.isLate ? (
                      <span className="text-[#15803D] dark:text-[#4ADE80]">
                        Correct: Scored {feedback.score} / 1000
                      </span>
                    ) : (
                      <span className="text-[#C2410C] dark:text-[#FB923C]">
                        Scored {feedback.score} / 1000{feedback.isLate ? ' (Timed out)' : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                    {(feedback.timeMs / 1000).toFixed(2)}s
                  </span>
                </div>

                <div className="p-4 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg space-y-2 text-sm">
                  <div className="text-[#1D2433] dark:text-[#E8EBF4] font-medium">
                    {feedback.aristotleFeedback}
                  </div>
                  <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">
                    Correct key:{' '}
                    <span className="font-mono font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                      {activeQuestion.type === 'MULTIPLE_CHOICE' && activeQuestion.options
                        ? activeQuestion.options[Number(feedback.correctAnswer)] ?? feedback.correctAnswer
                        : feedback.numericAnswer ?? feedback.correctAnswer}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleNextOrFinish()}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-lg transition-colors"
                >
                  {feedback.isFinalQuestion ? 'View Final Summary' : 'Next Question'}
                </button>
              </div>
            )}
          </div>
        )}

        {todayState?.state === 'DONE' && resultData && !activeQuestion && (
          <div className="space-y-6">
            <div className="p-5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-[#7C3AED] dark:text-[#C4B5FD]">
                  Completed · {resultData.quizDate}
                </span>
                <span className="text-lg font-bold font-mono tabular-nums text-[#1D2433] dark:text-[#E8EBF4]">
                  {resultData.totalScore} / {resultData.maxScore} pts ·{' '}
                  {(resultData.totalTimeMs / 1000).toFixed(2)}s
                </span>
              </div>
              <p className="text-sm text-[#1D2433] dark:text-[#E8EBF4]">{resultData.aristotleSummary}</p>
            </div>

            <div className="divide-y divide-[#D5DCE8] dark:divide-[#363D57]">
              {resultData.answers.map((ans) => (
                <div key={ans.questionId} className="py-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-[#4B556B] dark:text-[#B4BCD0]">
                      Question {ans.position} ·{' '}
                      {ans.type === 'ESTIMATE' ? 'Numeric Estimate' : 'Multiple Choice'}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-[#B45309] dark:text-[#F59E0B]">
                      {ans.score} pts · {(ans.timeMs / 1000).toFixed(1)}s{ans.isLate ? ' (Late)' : ''}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                    {ans.prompt}
                  </div>
                  <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">{ans.explanation}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="lg:col-span-5 space-y-6">
        <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">Leaderboard</h2>

            <div className="flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] rounded-lg">
              {(['daily', 'weekly', 'all-time'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    period === p
                      ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                      : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                  }`}
                >
                  {p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'All-Time'}
                </button>
              ))}
            </div>
          </div>

          {myRank && (
            <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
              {myRank.eligible ? (
                myRank.rank ? (
                  <span>
                    Your rank:{' '}
                    <strong className="font-mono tabular-nums text-[#7C3AED] dark:text-[#C4B5FD]">
                      #{myRank.rank}
                    </strong>
                  </span>
                ) : (
                  <span>Complete today’s Zugzwang to post a ranked score.</span>
                )
              ) : (
                <span className="text-[#C2410C] dark:text-[#FB923C]">{myRank.reason}</span>
              )}
            </div>
          )}

          {!leaderboard || leaderboard.entries.length === 0 ? (
            <div className="text-sm text-[#4B556B] dark:text-[#B4BCD0] py-4">
              No ranked entries yet for this period.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#D5DCE8] dark:border-[#363D57] text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0]">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Handle</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D5DCE8] dark:divide-[#363D57] text-sm">
                {leaderboard.entries.map((entry, idx) => (
                  <tr key={entry.userId}>
                    <td className="py-2.5 pr-2 font-mono text-xs text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-2 font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                      {entry.displayName}
                      {entry.country ? (
                        <span className="ml-2 text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono">
                          {entry.country}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold tabular-nums text-[#B45309] dark:text-[#F59E0B]">
                      {entry.score}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums text-[#4B556B] dark:text-[#B4BCD0]">
                      {(entry.timeMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form
          onSubmit={(e) => void handleUpdateProfile(e)}
          className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-6 space-y-3"
        >
          <h3 className="text-sm font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            Leaderboard Display Name
          </h3>
          <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">
            Names pass profanity moderation before appearing publicly.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Handle (2-32 chars)"
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
            <input
              type="text"
              placeholder="CC"
              maxLength={3}
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
              className="w-16 px-2.5 py-2 text-xs font-mono uppercase bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#15803D] dark:text-[#4ADE80]">{profileStatus ?? ''}</span>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Save Handle
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
