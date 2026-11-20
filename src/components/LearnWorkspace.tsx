import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Flag,
  Heart,
  Lightbulb,
  Lock,
  Play,
  Trophy,
  Volume2,
  XCircle,
} from 'lucide-react';
import {
  AnswerSubmitResponse,
  ApiError,
  AttemptFinishResponse,
  AttemptStartResponse,
  LevelSummary,
  PublicQuestion,
  TrackLevelsResponse,
  TrackSummary,
  UserStats,
  api,
} from '../lib/api.ts';
import { AristotleLiveContext } from './AristotleOrb.tsx';

interface LearnWorkspaceProps {
  stats: UserStats | null;
  onStatsChanged: () => void;
  onContextChange?: (ctx: Partial<AristotleLiveContext>) => void;
  onAskAristotle?: (prompt: string, mode: 'hint' | 'explain' | 'debug' | 'plan') => void;
}

const ROAD_ROW_HEIGHT = 112;
const ROAD_TOP_OFFSET = 56;
// Normalized X% offsets across a gentle S-curve road
const SINE_OFFSETS_PCT = [50, 68, 74, 64, 50, 32, 26, 36, 50, 50];

export function LearnWorkspace({
  stats,
  onStatsChanged,
  onContextChange,
  onAskAristotle,
}: LearnWorkspaceProps) {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('python');
  const [trackData, setTrackData] = useState<TrackLevelsResponse | null>(null);
  const [activeUnitOrder, setActiveUnitOrder] = useState<number>(1);
  const [unitAutoSynced, setUnitAutoSynced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Attempt State
  const [attempt, setAttempt] = useState<AttemptStartResponse | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [answerFeedback, setAnswerFeedback] = useState<AnswerSubmitResponse | null>(null);
  const [finishResult, setFinishResult] = useState<AttemptFinishResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Voice Transcript / Speech Playback State
  const [promptTranscript, setPromptTranscript] = useState<string | null>(null);
  const [explanationTranscript, setExplanationTranscript] = useState<string | null>(null);
  const [speakingAudio, setSpeakingAudio] = useState(false);

  // Placement Test State
  const [placement, setPlacement] = useState<{
    placementTestId: string;
    targetUnitOrder: number;
    questions: PublicQuestion[];
  } | null>(null);
  const [placementAnswers, setPlacementAnswers] = useState<Record<string, string>>({});
  const [placementResult, setPlacementResult] = useState<{
    passed: boolean;
    scorePct: number;
    skippedLevelsCount: number;
  } | null>(null);

  async function refreshCurriculum(slug = selectedSlug) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getTracks();
      setTracks(list.tracks);
      const levels = await api.getTrackLevels(slug);
      setTrackData(levels);

      if (!unitAutoSynced && levels.units.length > 0) {
        const frontier =
          levels.units.find((u) => u.levels.some((l) => l.unlocked && !l.passed)) ??
          levels.units[0];
        setActiveUnitOrder(frontier.order);
        setUnitAutoSynced(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load curriculum');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUnitAutoSynced(false);
    void refreshCurriculum(selectedSlug);
  }, [selectedSlug]);

  const currentUnit = useMemo(() => {
    if (!trackData || trackData.units.length === 0) return null;
    return (
      trackData.units.find((u) => u.order === activeUnitOrder) ?? trackData.units[0]
    );
  }, [trackData, activeUnitOrder]);

  const currentQuestion = attempt ? attempt.questions[qIndex] : null;

  useEffect(() => {
    onContextChange?.({
      trackTitle: trackData?.track.title,
      unitTitle: currentUnit?.title,
      levelNumber: attempt?.levelNumber,
      levelType: attempt?.levelType,
      questionPrompt: currentQuestion?.prompt,
      codeSnippet: currentQuestion?.codeSnippet ?? null,
    });
  }, [
    trackData?.track.title,
    currentUnit?.title,
    attempt?.levelNumber,
    attempt?.levelType,
    currentQuestion?.id,
  ]);

  async function handleStartLevel(level: LevelSummary) {
    setError(null);
    setPlacement(null);
    setPlacementResult(null);
    setFinishResult(null);
    setAnswerFeedback(null);
    setPromptTranscript(null);
    setExplanationTranscript(null);
    setSelectedAnswer('');
    setQIndex(0);

    try {
      const started = await api.startAttempt(level.id);
      setAttempt(started);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start level');
    }
  }

  async function handleSubmitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!attempt || !selectedAnswer.trim()) return;
    const currentQ = attempt.questions[qIndex];
    setSubmitting(true);
    setError(null);
    try {
      const fb = await api.submitAnswer(attempt.attemptId, {
        questionId: currentQ.id,
        answer: selectedAnswer,
      });
      setAnswerFeedback(fb);
      setAttempt({ ...attempt, heartsRemaining: fb.heartsRemaining });
      onStatsChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit answer');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNextOrFinish() {
    if (!attempt) return;
    if (answerFeedback?.attemptStatus === 'FAILED') {
      setFinishResult({
        attemptId: attempt.attemptId,
        status: 'FAILED',
        passed: false,
        scorePct: 0,
        passMark: attempt.passMark,
        heartsRemaining: 0,
        completionXpAwarded: 0,
        totalAttemptXp: answerFeedback.attemptXpEarned,
        pointAwarded: false,
        streak: {
          current: stats?.currentStreak ?? 0,
          longest: stats?.longestStreak ?? 0,
          incrementedToday: false,
        },
      });
      return;
    }

    if (qIndex + 1 < attempt.questions.length) {
      setQIndex(qIndex + 1);
      setSelectedAnswer('');
      setAnswerFeedback(null);
      setPromptTranscript(null);
      setExplanationTranscript(null);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.finishAttempt(attempt.attemptId);
      setFinishResult(res);
      onStatsChanged();
      await refreshCurriculum(selectedSlug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not finish attempt');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSpeakPrompt(questionId: string, fallbackText: string) {
    setSpeakingAudio(true);
    try {
      const data = await api.getPromptAudio(questionId);
      setPromptTranscript(data.transcript);
      try {
        const tts = await api.aristotleSpeak({ text: data.transcript });
        const audio = new Audio(`data:${tts.mimeType};base64,${tts.audioBase64}`);
        await audio.play();
      } catch {
        // Transcript still displayed cleanly if TTS secret isn't attached
      }
    } catch {
      setPromptTranscript(fallbackText);
    } finally {
      setSpeakingAudio(false);
    }
  }

  async function handleSpeakExplanation(questionId: string, fallbackText: string) {
    setSpeakingAudio(true);
    try {
      const data = await api.getExplanationAudio(questionId);
      setExplanationTranscript(data.transcript);
      try {
        const tts = await api.aristotleSpeak({ text: data.transcript });
        const audio = new Audio(`data:${tts.mimeType};base64,${tts.audioBase64}`);
        await audio.play();
      } catch {
        // Transcript remains visible
      }
    } catch {
      setExplanationTranscript(fallbackText);
    } finally {
      setSpeakingAudio(false);
    }
  }

  async function handleStartPlacement(unitOrder: number) {
    setError(null);
    setAttempt(null);
    setFinishResult(null);
    setPlacementResult(null);
    setPlacementAnswers({});
    try {
      const data = await api.startPlacementTest(selectedSlug, unitOrder);
      setPlacement(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start placement test');
    }
  }

  async function handleSubmitPlacement(e: React.FormEvent) {
    e.preventDefault();
    if (!placement) return;
    setSubmitting(true);
    try {
      const answers = placement.questions.map((q) => ({
        questionId: q.id,
        answer: placementAnswers[q.id] ?? '',
      }));
      const res = await api.submitPlacementTest(selectedSlug, placement.placementTestId, answers);
      setPlacementResult(res);
      setPlacement(null);
      await refreshCurriculum(selectedSlug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Placement submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Build winding SVG road geometry for the active unit's levels (10 stops per unit)
  const unitLevels = currentUnit?.levels ?? [];
  const svgHeight = Math.max(ROAD_ROW_HEIGHT * unitLevels.length + 40, 260);
  const roadPoints = unitLevels.map((lvl, idx) => ({
    lvl,
    x: SINE_OFFSETS_PCT[idx % SINE_OFFSETS_PCT.length],
    y: ROAD_TOP_OFFSET + idx * ROAD_ROW_HEIGHT,
  }));

  const unitHasUnlockedLevel = unitLevels.some((l) => l.unlocked);
  const unitPassedCount = unitLevels.filter((l) => l.passed).length;

  return (
    <div className="space-y-6">
      {/* Course Road Header: Connected Track Progression Strip */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">Course Road</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Follow the winding path unit by unit. Every 5th stop is a sum-up quiz.
            </p>
          </div>
          {trackData && (
            <div className="text-xs text-slate-600 font-mono tabular-nums">
              {trackData.track.userPoints} / {trackData.track.maxPoints} points
              <span aria-hidden="true" className="mx-2 text-slate-300">
                ·
              </span>
              {trackData.track.levelCount} steps
            </div>
          )}
        </div>

        {/* Connected Course Road Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tracks.map((t, index) => {
            const isSelected = selectedSlug === t.slug;
            const pct = t.maxPoints > 0 ? Math.min(100, Math.round((t.userPoints / t.maxPoints) * 100)) : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedSlug(t.slug)}
                className={`text-left p-3.5 rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
                      0{index + 1}
                    </span>
                    <span className="font-display text-sm font-bold text-slate-900 truncate">
                      {t.title}
                    </span>
                  </div>
                  {!t.unlocked ? (
                    <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <span className="text-xs font-mono font-semibold text-blue-700 tabular-nums shrink-0">
                      {t.userPoints}/{t.maxPoints} pt
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        t.unlocked ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {t.unlocked
                      ? `${t.units.length} units · Active course`
                      : t.lockedReason ?? 'Complete prerequisite points to unlock'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-12 items-start">
        {/* Left Zone: Active Unit Switcher + Winding Road (Hides Other Units) */}
        <div className="lg:col-span-7 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
              {error}
            </div>
          )}

          {/* Unit Tabs: Show 1 unit road at a time so other units stay hidden */}
          {trackData && (
            <div className="bg-white border border-slate-200 rounded-2xl p-2 flex items-center gap-1.5 overflow-x-auto">
              {trackData.units.map((u) => {
                const passed = u.levels.filter((l) => l.passed).length;
                const isSelected = currentUnit?.order === u.order;
                const unlockedAny = u.levels.some((l) => l.unlocked);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setActiveUnitOrder(u.order)}
                    className={`flex-1 min-w-[104px] px-3 py-2 rounded-xl text-left transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                      <span>Unit {u.order}</span>
                      {!unlockedAny && !isSelected && (
                        <Lock className="w-3 h-3 opacity-60 shrink-0" />
                      )}
                    </div>
                    <div
                      className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {passed}/{u.levels.length} done
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {loading && !trackData ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-sm text-slate-500">
              Loading course road...
            </div>
          ) : trackData && !trackData.track.unlocked ? (
            <div className="p-6 bg-white border border-slate-200 rounded-2xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5 text-amber-700" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-base font-bold text-slate-900">
                  {trackData.track.title} Track Locked
                </h2>
                <p className="text-sm text-slate-600">{trackData.track.lockedReason}</p>
                <p className="text-xs text-slate-500 pt-1">
                  Pass every 10th milestone sum-up quiz in Python to earn track points and open
                  this road.
                </p>
              </div>
            </div>
          ) : currentUnit ? (
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Active Unit Banner */}
              <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-medium text-blue-600">
                    Focused Unit · {unitPassedCount} of {unitLevels.length} steps complete
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                    {currentUnit.title}
                  </h2>
                </div>

                {currentUnit.order >= 2 &&
                  trackData?.track.unlocked &&
                  !trackData.track.isPlaceholder && (
                    <button
                      type="button"
                      onClick={() => void handleStartPlacement(currentUnit.order)}
                      className="px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Skip to Unit {currentUnit.order}
                    </button>
                  )}
              </div>

              {/* Winding S-Curve Course Road Canvas */}
              {!unitHasUnlockedLevel && currentUnit.order >= 2 && !trackData?.track.isPlaceholder ? (
                <div className="p-8 text-center space-y-4 road-canvas-bg">
                  <div className="mx-auto w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-slate-500" />
                  </div>
                  <div className="max-w-md mx-auto space-y-1.5">
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {currentUnit.title} is ahead on the road
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Finish the earlier unit steps, or pass a quick placement check to jump
                      straight into Unit {currentUnit.order}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartPlacement(currentUnit.order)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Take Placement Check
                  </button>
                </div>
              ) : (
                <div
                  className="relative road-canvas-bg px-4 py-4 overflow-hidden"
                  style={{ height: `${svgHeight}px` }}
                >
                  {/* Continuous SVG Road Track */}
                  <svg
                    viewBox={`0 0 100 ${svgHeight}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  >
                    {roadPoints.slice(0, -1).map((pt, idx) => {
                      const next = roadPoints[idx + 1];
                      const midY = (pt.y + next.y) / 2;
                      const d = `M ${pt.x} ${pt.y} C ${pt.x} ${midY}, ${next.x} ${midY}, ${next.x} ${next.y}`;
                      const segmentDone = pt.lvl.passed;
                      return (
                        <g key={pt.lvl.id}>
                          {/* Road Shoulder */}
                          <path
                            d={d}
                            fill="none"
                            stroke={segmentDone ? '#A7F3D0' : '#E2E8F0'}
                            strokeWidth="8"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          {/* Asphalt / Dashed Center Line */}
                          <path
                            d={d}
                            fill="none"
                            stroke={segmentDone ? '#059669' : '#94A3B8'}
                            strokeWidth="2.5"
                            strokeDasharray={segmentDone ? undefined : '6 6'}
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Interactive Road Stops (Lessons + Every 5th Sum-Up Quiz) */}
                  {roadPoints.map(({ lvl, x, y }) => {
                    const isActive = attempt?.levelId === lvl.id;
                    const isSumUp = lvl.isCheckpoint;
                    const alignLeft = x > 55;

                    return (
                      <div
                        key={lvl.id}
                        style={{
                          top: `${y}px`,
                          left: `${x}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                        className="absolute z-10 flex items-center"
                      >
                        <button
                          type="button"
                          disabled={!lvl.unlocked}
                          onClick={() => void handleStartLevel(lvl)}
                          aria-label={`Step ${lvl.number}: ${lvl.title}`}
                          className={`group relative flex items-center justify-center transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                            lvl.unlocked ? 'hover:scale-105 cursor-pointer' : 'cursor-not-allowed'
                          } ${
                            isSumUp
                              ? `w-16 h-16 rounded-2xl border-2 shadow-sm ${
                                  isActive
                                    ? 'bg-amber-600 border-amber-700 text-white'
                                    : lvl.passed
                                      ? 'bg-emerald-600 border-emerald-700 text-white'
                                      : lvl.unlocked
                                        ? 'bg-amber-50 border-amber-500 text-amber-900'
                                        : 'bg-white border-slate-200 text-slate-400'
                                }`
                              : `w-14 h-14 rounded-full border-2 shadow-sm ${
                                  isActive
                                    ? 'bg-blue-600 border-blue-700 text-white ring-4 ring-blue-600/20'
                                    : lvl.passed
                                      ? 'bg-emerald-600 border-emerald-700 text-white'
                                      : lvl.unlocked
                                        ? 'bg-white border-blue-600 text-slate-900 ring-4 ring-blue-600/10'
                                        : 'bg-slate-100 border-slate-200 text-slate-400'
                                }`
                          }`}
                        >
                          {lvl.passed ? (
                            <CheckCircle2 className="w-6 h-6" />
                          ) : !lvl.unlocked ? (
                            <Lock className="w-4 h-4" />
                          ) : isSumUp ? (
                            <Flag className="w-5 h-5" />
                          ) : (
                            <Play className="w-5 h-5 fill-current" />
                          )}
                        </button>

                        {/* Step Label Callout beside node */}
                        <div
                          onClick={() => {
                            if (lvl.unlocked) void handleStartLevel(lvl);
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 w-44 sm:w-52 px-3 py-2 rounded-xl border bg-white/95 transition-colors ${
                            lvl.unlocked ? 'cursor-pointer hover:border-blue-300' : 'opacity-75'
                          } ${
                            isSumUp
                              ? 'border-amber-300 bg-amber-50/90'
                              : isActive
                                ? 'border-blue-500'
                                : 'border-slate-200'
                          } ${alignLeft ? 'right-full mr-3 text-right' : 'left-full ml-3 text-left'}`}
                        >
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            {isSumUp
                              ? lvl.awardsPoint
                                ? `Step ${lvl.number} · Unit Sum-Up · +1 pt`
                                : `Step ${lvl.number} · 5-Lesson Sum-Up`
                              : `Lesson ${lvl.number}`}
                          </div>
                          <div className="text-xs font-semibold text-slate-900 truncate mt-0.5">
                            {lvl.title}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* Right Zone: Progress Snapshot + Interactive Lesson / Sum-Up Runner */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="font-display text-sm font-bold text-slate-900 mb-3.5">
              Your Progress
            </h2>
            <div className="grid grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {stats?.xp ?? 0}
                </div>
                <div className="text-[11px] text-slate-500">XP</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {stats?.currentStreak ?? 0}d
                </div>
                <div className="text-[11px] text-slate-500">Streak</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {stats?.totalPoints ?? 0}
                </div>
                <div className="text-[11px] text-slate-500">Points</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {stats?.passedLevelsCount ?? 0}
                </div>
                <div className="text-[11px] text-slate-500">Passed</div>
              </div>
            </div>
          </div>

          {placementResult && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
              <h3 className="font-display text-base font-bold text-slate-900">
                Placement Check {placementResult.passed ? 'Passed' : 'Not Passed'}
              </h3>
              <p className="text-xs text-slate-600 font-mono tabular-nums">
                Score: {Math.round(placementResult.scorePct * 100)}% · Skipped steps:{' '}
                {placementResult.skippedLevelsCount}
              </p>
            </div>
          )}

          {placement && (
            <form
              onSubmit={handleSubmitPlacement}
              className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Unit {placement.targetUnitOrder} Placement Check
                </h3>
                <span className="text-xs text-slate-500 font-mono">70% to pass</span>
              </div>

              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                {placement.questions.map((q, idx) => (
                  <div key={q.id} className="space-y-2 pb-4 border-b border-slate-100 last:border-0">
                    <p className="text-sm font-medium text-slate-900">
                      {idx + 1}. {q.prompt}
                    </p>
                    {q.codeSnippet && (
                      <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto">
                        {q.codeSnippet}
                      </pre>
                    )}
                    {q.type === 'MULTIPLE_CHOICE' && q.options ? (
                      <div className="grid gap-1.5">
                        {q.options.map((opt, optIdx) => (
                          <label
                            key={optIdx}
                            className={`flex items-center gap-2 p-2.5 text-xs border rounded-lg cursor-pointer ${
                              placementAnswers[q.id] === String(optIdx)
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`place-${q.id}`}
                              value={String(optIdx)}
                              checked={placementAnswers[q.id] === String(optIdx)}
                              onChange={(e) =>
                                setPlacementAnswers({ ...placementAnswers, [q.id]: e.target.value })
                              }
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="Type exact output"
                        value={placementAnswers[q.id] ?? ''}
                        onChange={(e) =>
                          setPlacementAnswers({ ...placementAnswers, [q.id]: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
                >
                  Submit Check
                </button>
                <button
                  type="button"
                  onClick={() => setPlacement(null)}
                  className="py-2.5 px-4 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Finish Summary Card */}
          {finishResult ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                {finishResult.passed ? (
                  <Trophy className="w-6 h-6 text-emerald-600" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-600" />
                )}
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {finishResult.passed ? 'Milestone Complete' : 'Attempt Ended'}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="text-xs text-slate-500">Score / Pass Mark</div>
                  <div className="font-mono font-semibold tabular-nums mt-0.5">
                    {Math.round(finishResult.scorePct * 100)}% /{' '}
                    {Math.round(finishResult.passMark * 100)}%
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="text-xs text-slate-500">XP Earned</div>
                  <div className="font-mono font-semibold tabular-nums mt-0.5">
                    +{finishResult.totalAttemptXp} XP
                  </div>
                </div>
              </div>

              {finishResult.pointAwarded && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-800">
                  Unit milestone reached: +1 track point awarded.
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setAttempt(null);
                  setFinishResult(null);
                }}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
              >
                Return to Course Road
              </button>
            </div>
          ) : attempt && currentQuestion ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span
                    className={`text-xs font-semibold ${
                      attempt.levelType === 'CHECKPOINT' ? 'text-amber-700' : 'text-blue-600'
                    }`}
                  >
                    {attempt.levelType === 'CHECKPOINT'
                      ? `5-Lesson Sum-Up Quiz · Step ${attempt.levelNumber}`
                      : `Lesson ${attempt.levelNumber}`}
                  </span>
                  <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                    Question {qIndex + 1} of {attempt.totalQuestions} · Pass mark{' '}
                    {Math.round(attempt.passMark * 100)}%
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-red-600 font-mono text-sm font-semibold tabular-nums">
                  <Heart className="w-4 h-4 fill-red-600" />
                  <span>{attempt.heartsRemaining}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900 leading-relaxed">
                    {currentQuestion.prompt}
                  </p>
                  <button
                    type="button"
                    disabled={speakingAudio}
                    onClick={() =>
                      void handleSpeakPrompt(
                        currentQuestion.id,
                        currentQuestion.spokenText ?? currentQuestion.prompt,
                      )
                    }
                    title="Listen to question prompt"
                    className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>

                {promptTranscript && (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
                    {promptTranscript}
                  </div>
                )}

                {currentQuestion.codeSnippet && (
                  <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
                    {currentQuestion.codeSnippet}
                  </pre>
                )}
              </div>

              <form onSubmit={handleSubmitAnswer} className="space-y-3">
                {currentQuestion.type === 'MULTIPLE_CHOICE' && currentQuestion.options ? (
                  <div className="space-y-2">
                    {currentQuestion.options.map((opt, idx) => (
                      <label
                        key={idx}
                        className={`flex items-center gap-3 p-3 text-sm border rounded-xl cursor-pointer transition-colors ${
                          selectedAnswer === String(idx)
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="mc-answer"
                          disabled={Boolean(answerFeedback)}
                          value={String(idx)}
                          checked={selectedAnswer === String(idx)}
                          onChange={(e) => setSelectedAnswer(e.target.value)}
                        />
                        <span className="font-mono text-xs text-slate-500">{idx + 1}</span>
                        <span className="text-slate-900">{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    disabled={Boolean(answerFeedback)}
                    value={selectedAnswer}
                    onChange={(e) => setSelectedAnswer(e.target.value)}
                    placeholder="Type exact output..."
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                )}

                {!answerFeedback && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {onAskAristotle ? (
                      <button
                        type="button"
                        onClick={() =>
                          onAskAristotle(
                            'Give me a helpful hint on this question without revealing the answer.',
                            'hint',
                          )
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:text-amber-900 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        Ask Aristotle for Hint
                      </button>
                    ) : (
                      <span />
                    )}

                    <button
                      type="submit"
                      disabled={submitting || !selectedAnswer.trim()}
                      className="py-2 px-5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl whitespace-nowrap"
                    >
                      {submitting ? 'Checking...' : 'Check Answer'}
                    </button>
                  </div>
                )}
              </form>

              {answerFeedback && (
                <div
                  className={`p-4 rounded-xl border space-y-2.5 ${
                    answerFeedback.isCorrect
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>
                      {answerFeedback.isCorrect
                        ? `Correct (+${answerFeedback.xpDelta} XP)`
                        : `Incorrect (Answer: ${answerFeedback.correctAnswer})`}
                    </span>
                    <button
                      type="button"
                      disabled={speakingAudio}
                      onClick={() =>
                        void handleSpeakExplanation(
                          currentQuestion.id,
                          answerFeedback.explanation,
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs underline"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      Listen
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed">{answerFeedback.explanation}</p>
                  {explanationTranscript && explanationTranscript !== answerFeedback.explanation && (
                    <p className="text-xs pt-1 border-t border-black/10">
                      {explanationTranscript}
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleNextOrFinish()}
                    className="w-full mt-2 py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
                  >
                    {answerFeedback.attemptStatus === 'FAILED'
                      ? 'View Result'
                      : qIndex + 1 < attempt.questions.length
                        ? 'Next Question'
                        : 'Finish Attempt'}
                  </button>
                </div>
              )}
            </div>
          ) : !placement ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2.5 text-slate-900">
                <Compass className="w-5 h-5 text-blue-600 shrink-0" />
                <h3 className="font-display text-base font-bold">Ready on the Road</h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Pick any open lesson along the road to begin practicing. Every fifth milestone is a
                sum-up quiz that tests what you just learned.
              </p>
              {onAskAristotle && (
                <button
                  type="button"
                  onClick={() =>
                    onAskAristotle('What should I focus on in this unit?', 'plan')
                  }
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Ask Aristotle for a unit walkthrough →
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
