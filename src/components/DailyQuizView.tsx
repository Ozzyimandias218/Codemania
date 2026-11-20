import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Trophy, Volume2, XCircle } from 'lucide-react';
import { ApiError, api } from '../lib/api.ts';

interface ActiveDailyQuestion {
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

export function DailyQuizView() {
  const [todayState, setTodayState] = useState<Awaited<ReturnType<typeof api.getDailyToday>> | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<ActiveDailyQuestion | null>(null);
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
      setError(err instanceof ApiError ? err.message : 'Failed to load daily quiz state');
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

  async function handleStartQuiz() {
    setError(null);
    setSubmitting(true);
    try {
      const started = await api.startDailyQuiz();
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
      setError(err instanceof ApiError ? err.message : 'Unable to start daily quiz');
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
        setTodayState((prev) => (prev ? { ...prev, state: 'DONE', totalScore: res.totalScore, totalTimeMs: res.totalTimeMs } : prev));
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
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">
        Loading Aristotle Daily Quiz...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Interactive Quiz Stage */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              {todayState?.quizDate} · {todayState?.dailyTz} · 7 Questions
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Aristotle Daily Quiz</h1>
          </div>

          {todayState?.state === 'IN_PROGRESS' && activeQuestion && (
            <div className="flex items-center gap-4 text-sm font-mono tabular-nums">
              <span className="text-slate-700 font-semibold">
                Q{activeQuestion.position}/7
              </span>
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  secondsLeft <= 10 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                <Clock className="w-4 h-4" />
                {secondsLeft}s remaining
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}

        {todayState?.state === 'NOT_STARTED' && !activeQuestion && (
          <div className="space-y-5">
            <div className="flex items-start gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="w-12 h-12 rounded-full overflow-hidden border border-amber-400/70 bg-slate-900 shrink-0 flex items-center justify-center">
                <img
                  src="/src/assets/images/aristotle_emblem_1795160958685.jpg"
                  alt="Aristotle emblem"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="space-y-2 flex-1">
                <p className="text-sm text-slate-800 leading-relaxed">{todayState.aristotleIntro}</p>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .aristotleSpeak({ text: todayState.aristotleIntro })
                      .then((res) => new Audio(`data:${res.mimeType};base64,${res.audioBase64}`).play())
                      .catch(() => {})
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Listen to Aristotle
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 py-4 border-y border-slate-100 text-sm">
              <div>
                <div className="text-xs text-slate-500">Time per question</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                  {todayState.timeLimitSeconds}s
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Max score</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                  7,000 pts
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Attempts allowed</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                  1 per day
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={!todayState.available || submitting}
              onClick={() => void handleStartQuiz()}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors"
            >
              {submitting ? 'Starting...' : 'Start Daily Quiz'}
            </button>
          </div>
        )}

        {activeQuestion && (
          <div className="space-y-5">
            <div className="text-xs text-slate-500">
              Question {activeQuestion.position} of 7 ·{' '}
              {activeQuestion.type === 'ESTIMATE' ? 'Numeric Estimate' : 'Multiple Choice'}
            </div>
            <h2 className="text-lg font-semibold text-slate-900 leading-snug">
              {activeQuestion.prompt}
            </h2>

            {activeQuestion.codeSnippet && (
              <pre className="p-4 bg-slate-900 text-slate-100 text-xs font-mono rounded-lg overflow-x-auto">
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
                          className={`w-full text-left px-4 py-3 text-sm rounded-lg border transition-colors ${
                            checked
                              ? 'border-blue-600 bg-blue-50 text-slate-900 font-medium'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <span className="font-mono text-xs text-slate-500 mr-3">{idx + 1}.</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      Numeric estimate
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Enter your best numeric estimate..."
                      value={estimateInput}
                      onChange={(e) => setEstimateInput(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Server enforces the {todayState?.timeLimitSeconds ?? 60}s clock.
                  </span>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {submitting ? 'Submitting...' : 'Submit Answer'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold">
                    {feedback.score >= 700 && !feedback.isLate ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-800">Scored {feedback.score} / 1000</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-amber-600" />
                        <span className="text-slate-900">
                          Scored {feedback.score} / 1000{feedback.isLate ? ' (Timed out)' : ''}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {(feedback.timeMs / 1000).toFixed(2)}s
                  </span>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-sm">
                  <div className="text-slate-900 font-medium">{feedback.aristotleFeedback}</div>
                  <div className="text-xs text-slate-600">
                    Correct key:{' '}
                    <span className="font-mono font-semibold text-slate-900">
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
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  {feedback.isFinalQuestion ? 'View Final Summary' : 'Next Question'}
                </button>
              </div>
            )}
          </div>
        )}

        {todayState?.state === 'DONE' && resultData && !activeQuestion && (
          <div className="space-y-6">
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Completed · {resultData.quizDate}</span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {resultData.totalScore} / {resultData.maxScore} pts · {(resultData.totalTimeMs / 1000).toFixed(2)}s
                </span>
              </div>
              <p className="text-sm text-slate-700">{resultData.aristotleSummary}</p>
            </div>

            <div className="divide-y divide-slate-100">
              {resultData.answers.map((ans) => (
                <div key={ans.questionId} className="py-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-slate-500">
                      Question {ans.position} ·{' '}
                      {ans.type === 'ESTIMATE' ? 'Numeric Estimate' : 'Multiple Choice'}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {ans.score} pts · {(ans.timeMs / 1000).toFixed(1)}s{ans.isLate ? ' (Late)' : ''}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900">{ans.prompt}</div>
                  <div className="text-xs text-slate-600">{ans.explanation}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Right Leaderboard & Display Name Moderation Deck */}
      <aside className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-slate-700" />
              <h2 className="text-base font-bold text-slate-900">Leaderboard</h2>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['daily', 'weekly', 'all-time'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    period === p
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'All-Time'}
                </button>
              ))}
            </div>
          </div>

          {myRank && (
            <div className="text-xs text-slate-600 border-b border-slate-100 pb-3">
              {myRank.eligible ? (
                myRank.rank ? (
                  <span>
                    Your rank:{' '}
                    <strong className="font-mono tabular-nums text-slate-900">#{myRank.rank}</strong>
                  </span>
                ) : (
                  <span>Complete today’s quiz to post a ranked score.</span>
                )
              ) : (
                <span className="text-amber-700">{myRank.reason}</span>
              )}
            </div>
          )}

          {!leaderboard || leaderboard.entries.length === 0 ? (
            <div className="text-sm text-slate-500 py-4">No ranked entries yet for this period.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Handle</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {leaderboard.entries.map((entry, idx) => (
                  <tr key={entry.userId}>
                    <td className="py-2.5 pr-2 font-mono text-xs text-slate-500 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-2 font-medium text-slate-900">
                      {entry.displayName}
                      {entry.country ? (
                        <span className="ml-2 text-xs text-slate-400 font-mono">{entry.country}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {entry.score}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">
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
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-3"
        >
          <h3 className="text-sm font-bold text-slate-900">Leaderboard Display Name</h3>
          <p className="text-xs text-slate-600">
            Names pass profanity moderation before appearing publicly.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Handle (2-32 chars)"
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              placeholder="CC"
              maxLength={3}
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
              className="w-16 px-2.5 py-2 text-xs font-mono uppercase border border-slate-200 rounded-lg"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600">{profileStatus ?? ''}</span>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Save Handle
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
