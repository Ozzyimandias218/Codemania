import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnswerSubmitResponse,
  ApiError,
  AttemptFinishResponse,
  AttemptStartResponse,
  CodingChallengeResponse,
  LevelSummary,
  PublicQuestion,
  TrackLevelsResponse,
  TrackSummary,
  TutorEvalResponse,
  UserStats,
  api,
} from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';
import { AristotleLiveContext } from './AristotleOrb.tsx';

interface LearnWorkspaceProps {
  stats: UserStats | null;
  onStatsChanged: () => void;
  onNavigateToReview?: () => void;
  onContextChange?: (ctx: Partial<AristotleLiveContext>) => void;
  onAskAristotle?: (prompt: string, mode: 'hint' | 'explain' | 'debug' | 'plan') => void;
}

const ROAD_ROW_HEIGHT = 112;
const ROAD_TOP_OFFSET = 56;
const SINE_OFFSETS_PCT = [50, 68, 74, 64, 50, 32, 26, 36, 50, 50];

export function LearnWorkspace({
  stats,
  onStatsChanged,
  onNavigateToReview,
  onContextChange,
  onAskAristotle,
}: LearnWorkspaceProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

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

  // Code Practice & AI Tutor State
  const [lessonMode, setLessonMode] = useState<'quiz' | 'code'>('quiz');
  const [codingChallenge, setCodingChallenge] = useState<CodingChallengeResponse | null>(null);
  const [codingLoading, setCodingLoading] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [tutorSubmitting, setTutorSubmitting] = useState(false);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [tutorResult, setTutorResult] = useState<TutorEvalResponse | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);

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

  async function loadChallengeForLevel(levelId: string) {
    if (selectedSlug !== 'python') {
      setCodingChallenge(null);
      return;
    }
    setCodingLoading(true);
    setTutorError(null);
    setTutorResult(null);
    try {
      const challenge = await api.getCodingChallenge(levelId);
      setCodingChallenge(challenge);
      setCodeDraft(challenge.starterCode);
    } catch (err) {
      setCodingChallenge(null);
      setTutorError(
        err instanceof ApiError ? err.message : 'Could not load coding exercise.',
      );
    } finally {
      setCodingLoading(false);
    }
  }

  async function handleStartLevel(level: LevelSummary, initialMode: 'quiz' | 'code' = 'quiz') {
    setError(null);
    setPlacement(null);
    setPlacementResult(null);
    setFinishResult(null);
    setAnswerFeedback(null);
    setPromptTranscript(null);
    setExplanationTranscript(null);
    setSelectedAnswer('');
    setQIndex(0);
    setLessonMode(selectedSlug === 'python' ? initialMode : 'quiz');
    setTutorResult(null);
    setTutorError(null);

    try {
      const started = await api.startAttempt(level.id);
      setAttempt(started);
      if (selectedSlug === 'python') {
        void loadChallengeForLevel(level.id);
      } else {
        setCodingChallenge(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start level');
    }
  }

  async function handleSubmitCodeToTutor(e: React.FormEvent) {
    e.preventDefault();
    if (!attempt) return;
    const trimmed = codeDraft.trim();
    if (!trimmed) {
      setTutorError('Please write some Python code before running tests.');
      return;
    }
    if (codeDraft.length > 3000) {
      setTutorError('Code submission must be 3000 characters or fewer.');
      return;
    }

    setTutorSubmitting(true);
    setTutorError(null);
    try {
      const result = await api.submitCodeToTutor({
        levelId: attempt.levelId,
        code: codeDraft,
      });
      setTutorResult(result);
      if (result.progressUpdate.levelPassed || result.progressUpdate.reviewEnqueued) {
        onStatsChanged();
        await refreshCurriculum(selectedSlug);
      }
    } catch (err) {
      setTutorError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the AI Tutor. Please try again.',
      );
    } finally {
      setTutorSubmitting(false);
    }
  }

  async function handleAdvanceToNextLevel(nextLevelId: string) {
    const allLevels = trackData?.units.flatMap((u) => u.levels) ?? [];
    const target = allLevels.find((l) => l.id === nextLevelId);
    if (target) {
      const parentUnit = trackData?.units.find((u) =>
        u.levels.some((l) => l.id === nextLevelId),
      );
      if (parentUnit) setActiveUnitOrder(parentUnit.order);
      await handleStartLevel({ ...target, unlocked: true }, 'code');
    } else {
      setAttempt(null);
      setTutorResult(null);
      await refreshCurriculum(selectedSlug);
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

  const unitLevels = currentUnit?.levels ?? [];
  const svgHeight = Math.max(ROAD_ROW_HEIGHT * unitLevels.length + 40, 260);
  const roadPoints = unitLevels.map((lvl, idx) => ({
    lvl,
    x: SINE_OFFSETS_PCT[idx % SINE_OFFSETS_PCT.length],
    y: ROAD_TOP_OFFSET + idx * ROAD_ROW_HEIGHT,
  }));

  const unitHasUnlockedLevel = unitLevels.some((l) => l.unlocked);
  const unitPassedCount = unitLevels.filter((l) => l.passed).length;

  const doneStroke = isDark ? '#4ADE80' : '#15803D';
  const doneShoulder = isDark ? '#14532D' : '#BBF7D0';
  const idleStroke = isDark ? '#64748B' : '#94A3B8';
  const idleShoulder = isDark ? '#2A3045' : '#D5DCE8';

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-[#1D2433] dark:text-[#E8EBF4]">
              Course Path
            </h1>
            <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] mt-0.5">
              Work through one unit at a time. Every 5th step is a sum-up quiz.
            </p>
          </div>
          {trackData && (
            <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums">
              <span className="text-[#B45309] dark:text-[#F59E0B] font-semibold">
                {trackData.track.userPoints} / {trackData.track.maxPoints} points
              </span>
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              {trackData.track.levelCount} steps
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tracks.map((t, index) => {
            const isSelected = selectedSlug === t.slug;
            const pct = t.maxPoints > 0 ? Math.min(100, Math.round((t.userPoints / t.maxPoints) * 100)) : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedSlug(t.slug)}
                className={`text-left p-4 rounded-xl border border-[#D5DCE8] dark:border-[#363D57] transition-colors flex flex-col justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-[#EEF1F7] dark:bg-[#222638]'
                    : 'bg-white dark:bg-[#1A1D28] hover:bg-[#F6F7FB] dark:hover:bg-[#222638]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0] tabular-nums">
                      0{index + 1}
                    </span>
                    <span className="font-display text-sm font-bold text-[#1D2433] dark:text-[#E8EBF4] truncate">
                      {t.title}
                    </span>
                  </div>
                  {!t.unlocked ? (
                    <span className="text-[11px] font-mono font-semibold text-[#4B556B] dark:text-[#B4BCD0] shrink-0">
                      Locked
                    </span>
                  ) : (
                    <span className="text-xs font-mono font-semibold text-[#B45309] dark:text-[#F59E0B] tabular-nums shrink-0">
                      {t.userPoints}/{t.maxPoints} pt
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="h-1.5 w-full bg-[#D5DCE8] dark:bg-[#363D57] rounded-sm overflow-hidden">
                    <div
                      className={`h-full rounded-sm transition-all ${
                        t.unlocked
                          ? 'bg-[#15803D] dark:bg-[#4ADE80]'
                          : 'bg-[#94A3B8] dark:bg-[#64748B]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0] truncate">
                    {t.unlocked
                      ? `${t.units.length} units${isSelected ? ' · Viewing' : ''}`
                      : t.lockedReason ?? 'Complete prerequisite points to unlock'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 space-y-4">
          {error && (
            <div className="p-3 text-sm font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
              {error}
            </div>
          )}

          {trackData && (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-2 flex items-center gap-1.5 overflow-x-auto">
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
                        ? 'bg-[#4F46E5] text-white'
                        : 'text-[#4B556B] dark:text-[#B4BCD0] hover:bg-[#EEF1F7] dark:hover:bg-[#222638] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                      <span>Unit {u.order}</span>
                      {!unlockedAny && !isSelected && (
                        <span className="text-[10px] font-mono">Locked</span>
                      )}
                    </div>
                    <div
                      className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                        isSelected
                          ? 'text-[#E0E7FF]'
                          : passed === u.levels.length && u.levels.length > 0
                            ? 'text-[#15803D] dark:text-[#4ADE80]'
                            : 'text-[#4B556B] dark:text-[#B4BCD0]'
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
            <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl text-sm text-[#4B556B] dark:text-[#B4BCD0]">
              Loading unit path...
            </div>
          ) : trackData && !trackData.track.unlocked ? (
            <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl space-y-2">
              <div className="text-xs font-mono font-semibold text-[#B45309] dark:text-[#F59E0B]">
                Track Locked
              </div>
              <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                {trackData.track.title} Track Locked
              </h2>
              <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0]">
                {trackData.track.lockedReason}
              </p>
              <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] pt-1">
                Pass every 10th milestone sum-up quiz in Python to earn track points and open this track.
              </p>
            </div>
          ) : currentUnit ? (
            <section className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#D5DCE8] dark:border-[#363D57] flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80]">
                    Unit {currentUnit.order} · {unitPassedCount} of {unitLevels.length} steps complete
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#1D2433] dark:text-[#E8EBF4] mt-0.5">
                    {currentUnit.title}
                  </h2>
                </div>

                {currentUnit.order >= 2 &&
                  trackData?.track.unlocked &&
                  !trackData.track.isPlaceholder && (
                    <button
                      type="button"
                      onClick={() => void handleStartPlacement(currentUnit.order)}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Skip to Unit {currentUnit.order}
                    </button>
                  )}
              </div>

              {!unitHasUnlockedLevel && currentUnit.order >= 2 && !trackData?.track.isPlaceholder ? (
                <div className="p-8 text-center space-y-4 road-canvas-bg">
                  <div className="max-w-md mx-auto space-y-1.5">
                    <div className="text-xs font-mono font-semibold text-[#4B556B] dark:text-[#B4BCD0]">
                      Unit Locked
                    </div>
                    <h3 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                      {currentUnit.title}
                    </h3>
                    <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
                      Finish the earlier unit steps, or pass a placement check to jump straight into Unit{' '}
                      {currentUnit.order}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartPlacement(currentUnit.order)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors"
                  >
                    Take Placement Check
                  </button>
                </div>
              ) : (
                <div
                  className="relative road-canvas-bg px-4 py-4 overflow-hidden"
                  style={{ height: `${svgHeight}px` }}
                >
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
                          <path
                            d={d}
                            fill="none"
                            stroke={segmentDone ? doneShoulder : idleShoulder}
                            strokeWidth="8"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          <path
                            d={d}
                            fill="none"
                            stroke={segmentDone ? doneStroke : idleStroke}
                            strokeWidth="2.5"
                            strokeDasharray={segmentDone ? undefined : '6 6'}
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      );
                    })}
                  </svg>

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
                          className={`flex items-center justify-center font-mono text-xs font-bold tabular-nums border transition-colors focus-visible:outline-2 focus-visible:outline-[#4F46E5] ${
                            lvl.unlocked ? 'cursor-pointer' : 'cursor-not-allowed'
                          } ${
                            isSumUp
                              ? `w-16 h-16 rounded-2xl ${
                                  isActive
                                    ? 'bg-[#F59E0B] border-[#B45309] text-[#1D2433]'
                                    : lvl.passed
                                      ? 'bg-[#15803D] border-[#14532D] text-white dark:bg-[#4ADE80] dark:border-[#22C55E] dark:text-[#0B1F13]'
                                      : lvl.unlocked
                                        ? 'bg-[#F59E0B] border-[#D97706] text-[#1D2433] hover:bg-[#D97706]'
                                        : 'bg-[#EEF1F7] dark:bg-[#222638] border-[#D5DCE8] dark:border-[#363D57] text-[#4B556B] dark:text-[#B4BCD0]'
                                }`
                              : `w-14 h-14 rounded-xl ${
                                  isActive
                                    ? 'bg-[#4F46E5] border-[#4338CA] text-white'
                                    : lvl.passed
                                      ? 'bg-[#15803D] border-[#14532D] text-white dark:bg-[#4ADE80] dark:border-[#22C55E] dark:text-[#0B1F13]'
                                      : lvl.unlocked
                                        ? 'bg-[#4F46E5] border-[#4338CA] text-white hover:bg-[#4338CA]'
                                        : 'bg-[#EEF1F7] dark:bg-[#222638] border-[#D5DCE8] dark:border-[#363D57] text-[#4B556B] dark:text-[#B4BCD0]'
                                }`
                          }`}
                        >
                          {isSumUp ? 'Quiz' : lvl.number}
                        </button>

                        <div
                          onClick={() => {
                            if (lvl.unlocked) void handleStartLevel(lvl);
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 w-44 sm:w-52 px-3 py-2 rounded-xl border border-[#D5DCE8] dark:border-[#363D57] transition-colors ${
                            isActive
                              ? 'bg-[#EEF1F7] dark:bg-[#222638]'
                              : 'bg-white dark:bg-[#1A1D28]'
                          } ${
                            lvl.unlocked
                              ? 'cursor-pointer hover:bg-[#EEF1F7] dark:hover:bg-[#222638]'
                              : ''
                          } ${alignLeft ? 'right-full mr-3 text-right' : 'left-full ml-3 text-left'}`}
                        >
                          <div
                            className={`text-[11px] font-mono tabular-nums font-semibold ${
                              isSumUp
                                ? 'text-[#B45309] dark:text-[#F59E0B]'
                                : lvl.passed
                                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                                  : lvl.unlocked
                                    ? 'text-[#4F46E5] dark:text-[#A5B4FC]'
                                    : 'text-[#4B556B] dark:text-[#B4BCD0]'
                            }`}
                          >
                            {isSumUp
                              ? lvl.awardsPoint
                                ? `Step ${lvl.number} · Unit Sum-Up · +1 pt`
                                : `Step ${lvl.number} · 5-Lesson Sum-Up`
                              : `Lesson ${lvl.number}`}
                          </div>
                          <div className="text-xs font-semibold text-[#1D2433] dark:text-[#E8EBF4] truncate mt-0.5">
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

        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
          <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6">
            <h2 className="font-display text-sm font-bold text-[#1D2433] dark:text-[#E8EBF4] mb-3.5">
              Your Progress
            </h2>
            <div className="grid grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-[#B45309] dark:text-[#F59E0B]">
                  {stats?.xp ?? 0}
                </div>
                <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">XP</div>
              </div>
              <div className="p-2.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-[#C2410C] dark:text-[#FB923C]">
                  {stats?.currentStreak ?? 0}d
                </div>
                <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">Streak</div>
              </div>
              <div className="p-2.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-[#B45309] dark:text-[#F59E0B]">
                  {stats?.totalPoints ?? 0}
                </div>
                <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">Points</div>
              </div>
              <div className="p-2.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
                <div className="text-lg font-bold font-mono tabular-nums text-[#15803D] dark:text-[#4ADE80]">
                  {stats?.passedLevelsCount ?? 0}
                </div>
                <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">Passed</div>
              </div>
            </div>
          </div>

          {placementResult && (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-2">
              <h3 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                Placement Check {placementResult.passed ? 'Passed' : 'Not Passed'}
              </h3>
              <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums">
                Score: {Math.round(placementResult.scorePct * 100)}% · Skipped steps:{' '}
                {placementResult.skippedLevelsCount}
              </p>
            </div>
          )}

          {placement && (
            <form
              onSubmit={handleSubmitPlacement}
              className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
                <h3 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                  Unit {placement.targetUnitOrder} Placement Check
                </h3>
                <span className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono">
                  70% to pass
                </span>
              </div>

              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                {placement.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="space-y-2 pb-4 border-b border-[#D5DCE8] dark:border-[#363D57] last:border-0"
                  >
                    <p className="text-sm font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                      {idx + 1}. {q.prompt}
                    </p>
                    {q.codeSnippet && (
                      <pre className="p-3 bg-[#12141C] text-[#E8EBF4] border border-[#363D57] rounded-xl text-xs font-mono overflow-x-auto">
                        {q.codeSnippet}
                      </pre>
                    )}
                    {q.type === 'MULTIPLE_CHOICE' && q.options ? (
                      <div className="grid gap-1.5">
                        {q.options.map((opt, optIdx) => (
                          <label
                            key={optIdx}
                            className={`flex items-center gap-2 p-2.5 text-xs border border-[#D5DCE8] dark:border-[#363D57] rounded-lg cursor-pointer ${
                              placementAnswers[q.id] === String(optIdx)
                                ? 'bg-[#EEF1F7] dark:bg-[#222638] font-semibold'
                                : 'bg-white dark:bg-[#1A1D28] hover:bg-[#EEF1F7] dark:hover:bg-[#222638]'
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
                              className="accent-[#4F46E5]"
                            />
                            <span className="text-[#1D2433] dark:text-[#E8EBF4]">{opt}</span>
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
                        className="w-full px-3 py-2 text-xs font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-xl"
                >
                  Submit Check
                </button>
                <button
                  type="button"
                  onClick={() => setPlacement(null)}
                  className="py-2.5 px-4 text-sm font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {finishResult ? (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                  {finishResult.passed ? 'Milestone Complete' : 'Attempt Ended'}
                </h3>
                <span
                  className={`text-xs font-mono font-semibold ${
                    finishResult.passed
                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                      : 'text-[#DC2626] dark:text-[#F87171]'
                  }`}
                >
                  {finishResult.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-[#EEF1F7] dark:bg-[#222638] rounded-xl">
                  <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">Score / Pass Mark</div>
                  <div className="font-mono font-semibold tabular-nums text-[#1D2433] dark:text-[#E8EBF4] mt-0.5">
                    {Math.round(finishResult.scorePct * 100)}% /{' '}
                    {Math.round(finishResult.passMark * 100)}%
                  </div>
                </div>
                <div className="p-3 bg-[#EEF1F7] dark:bg-[#222638] rounded-xl">
                  <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0]">XP Earned</div>
                  <div className="font-mono font-semibold tabular-nums text-[#B45309] dark:text-[#F59E0B] mt-0.5">
                    +{finishResult.totalAttemptXp} XP
                  </div>
                </div>
              </div>

              {finishResult.pointAwarded && (
                <div className="p-3 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-xs font-semibold text-[#15803D] dark:text-[#4ADE80]">
                  Unit milestone reached: +1 track point awarded.
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setAttempt(null);
                  setFinishResult(null);
                }}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-xl transition-colors"
              >
                Return to Course Path
              </button>
            </div>
          ) : attempt && currentQuestion ? (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
                <div>
                  <span
                    className={`text-xs font-semibold ${
                      attempt.levelType === 'CHECKPOINT'
                        ? 'text-[#B45309] dark:text-[#F59E0B]'
                        : 'text-[#4F46E5] dark:text-[#A5B4FC]'
                    }`}
                  >
                    {attempt.levelType === 'CHECKPOINT'
                      ? `5-Lesson Sum-Up Quiz · Step ${attempt.levelNumber}`
                      : `Lesson ${attempt.levelNumber}`}
                  </span>
                  <div className="text-xs text-[#4B556B] dark:text-[#B4BCD0] font-mono tabular-nums mt-0.5">
                    {lessonMode === 'code'
                      ? `Code Practice · ${codingChallenge?.testCases.length ?? 0} tests`
                      : `Question ${qIndex + 1} of ${attempt.totalQuestions} · Pass mark ${Math.round(
                          attempt.passMark * 100,
                        )}%`}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {selectedSlug === 'python' && (
                    <div className="inline-flex bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setLessonMode('quiz')}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                          lessonMode === 'quiz'
                            ? 'bg-[#4F46E5] text-white'
                            : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                        }`}
                      >
                        Quiz
                      </button>
                      <button
                        type="button"
                        onClick={() => setLessonMode('code')}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                          lessonMode === 'code'
                            ? 'bg-[#4F46E5] text-white'
                            : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                        }`}
                      >
                        Code Tutor
                      </button>
                    </div>
                  )}
                  {lessonMode === 'quiz' && (
                    <div className="text-[#DC2626] dark:text-[#F87171] font-mono text-xs font-semibold tabular-nums">
                      Hearts: {attempt.heartsRemaining}
                    </div>
                  )}
                </div>
              </div>

              {lessonMode === 'code' && selectedSlug === 'python' ? (
                <div className="space-y-4">
                  {codingLoading ? (
                    <div className="p-4 text-xs text-[#4B556B] dark:text-[#B4BCD0] bg-[#EEF1F7] dark:bg-[#222638] rounded-xl">
                      Loading coding exercise...
                    </div>
                  ) : codingChallenge ? (
                    <>
                      <div className="p-3.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl space-y-1.5">
                        <div className="text-[11px] font-mono font-semibold uppercase tracking-wide text-[#4F46E5] dark:text-[#A5B4FC]">
                          Lesson Goal · {codingChallenge.levelTitle}
                        </div>
                        <p className="text-xs sm:text-sm text-[#1D2433] dark:text-[#E8EBF4] leading-relaxed">
                          {codingChallenge.lessonGoal}
                        </p>
                      </div>

                      <form onSubmit={handleSubmitCodeToTutor} className="space-y-3">
                        <div className="flex items-center justify-between text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">
                          <span className="font-mono">main.py</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono tabular-nums">
                              {codeDraft.length} / 3000
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setCodeDraft(codingChallenge.starterCode);
                                setTutorResult(null);
                                setTutorError(null);
                              }}
                              className="font-semibold text-[#4F46E5] dark:text-[#A5B4FC] hover:underline"
                            >
                              Reset
                            </button>
                          </div>
                        </div>

                        <textarea
                          ref={codeEditorRef}
                          rows={8}
                          value={codeDraft}
                          onChange={(e) => setCodeDraft(e.target.value)}
                          spellCheck={false}
                          placeholder="# Write your Python code here..."
                          className="w-full p-3.5 text-xs sm:text-sm font-mono bg-[#12141C] text-[#E8EBF4] border border-[#363D57] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F46E5] leading-relaxed"
                        />

                        {tutorError && (
                          <div className="p-3 text-xs font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl">
                            {tutorError}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">
                            Tests run safely in an isolated Python sandbox.
                          </span>
                          <button
                            type="submit"
                            disabled={tutorSubmitting || !codeDraft.trim()}
                            className="py-2 px-4 text-xs sm:text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-xl whitespace-nowrap transition-colors"
                          >
                            {tutorSubmitting ? 'Running & Evaluating...' : 'Run & Check'}
                          </button>
                        </div>
                      </form>

                      {!tutorResult && codingChallenge.testCases.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <div className="text-[11px] font-mono font-semibold text-[#4B556B] dark:text-[#B4BCD0]">
                            Test Cases ({codingChallenge.testCases.length})
                          </div>
                          <div className="space-y-1">
                            {codingChallenge.testCases.map((tc) => (
                              <div
                                key={tc.id}
                                className="px-3 py-2 text-xs bg-[#F6F7FB] dark:bg-[#12141C] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg flex items-center justify-between gap-2"
                              >
                                <span className="text-[#1D2433] dark:text-[#E8EBF4] truncate">
                                  {tc.description}
                                </span>
                                <span className="font-mono text-[11px] text-[#4B556B] dark:text-[#B4BCD0] shrink-0">
                                  exp: {tc.expected}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {tutorResult && (
                        <div className="space-y-3 pt-1">
                          <div className="p-4 rounded-xl bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md ${
                                    tutorResult.tutor.nextAction === 'advance'
                                      ? 'bg-[#15803D] text-white dark:bg-[#4ADE80] dark:text-[#0B1F13]'
                                      : tutorResult.tutor.nextAction === 'retry'
                                        ? 'bg-[#D97706] text-white dark:bg-[#F59E0B] dark:text-[#1D2433]'
                                        : 'bg-[#7C3AED] text-white'
                                  }`}
                                >
                                  Next: {tutorResult.tutor.nextAction.toUpperCase()}
                                </span>
                                <span className="font-mono text-xs font-bold tabular-nums text-[#1D2433] dark:text-[#E8EBF4]">
                                  Score: {tutorResult.tutor.score}/100
                                </span>
                              </div>

                              <span
                                className={`font-mono text-xs font-semibold tabular-nums ${
                                  tutorResult.testResults.allPassed
                                    ? 'text-[#15803D] dark:text-[#4ADE80]'
                                    : 'text-[#DC2626] dark:text-[#F87171]'
                                }`}
                              >
                                {tutorResult.testResults.passedCount}/
                                {tutorResult.testResults.totalCount} tests passed
                              </span>
                            </div>

                            <p className="text-xs sm:text-sm leading-relaxed text-[#1D2433] dark:text-[#E8EBF4]">
                              {tutorResult.tutor.feedback}
                            </p>

                            {(tutorResult.progressUpdate.xpAwarded > 0 ||
                              tutorResult.progressUpdate.pointAwarded ||
                              tutorResult.progressUpdate.reviewEnqueued) && (
                              <div className="p-2.5 rounded-lg bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] text-xs font-medium text-[#15803D] dark:text-[#4ADE80] flex flex-wrap items-center gap-3">
                                {tutorResult.progressUpdate.xpAwarded > 0 && (
                                  <span className="font-mono">
                                    +{tutorResult.progressUpdate.xpAwarded} XP
                                  </span>
                                )}
                                {tutorResult.progressUpdate.pointAwarded && (
                                  <span className="font-mono">+1 track point</span>
                                )}
                                {tutorResult.progressUpdate.streak.incrementedToday && (
                                  <span className="font-mono">
                                    Streak: {tutorResult.progressUpdate.streak.current}d
                                  </span>
                                )}
                                {tutorResult.progressUpdate.reviewEnqueued && (
                                  <span className="text-[#7C3AED] dark:text-[#C4B5FD]">
                                    Added to your Review Queue
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="space-y-1.5">
                              {tutorResult.testResults.results.map((tc) => (
                                <div
                                  key={tc.id}
                                  className="px-3 py-2 text-xs bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                                      {tc.description}
                                    </span>
                                    <span
                                      className={`font-mono text-[11px] font-semibold shrink-0 ${
                                        tc.passed
                                          ? 'text-[#15803D] dark:text-[#4ADE80]'
                                          : 'text-[#DC2626] dark:text-[#F87171]'
                                      }`}
                                    >
                                      {tc.passed ? 'PASS' : 'FAIL'}
                                    </span>
                                  </div>
                                  {!tc.passed && (
                                    <div className="font-mono text-[11px] text-[#4B556B] dark:text-[#B4BCD0] break-all">
                                      Expected {tc.expected} · Got {tc.actual}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <span className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">
                                AI-generated, may contain mistakes
                              </span>

                              {tutorResult.tutor.nextAction === 'advance' ? (
                                tutorResult.progressUpdate.nextLevelId ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleAdvanceToNextLevel(
                                        tutorResult.progressUpdate.nextLevelId!,
                                      )
                                    }
                                    className="py-2 px-4 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] dark:bg-[#22C55E] dark:text-[#0B1F13] rounded-lg transition-colors"
                                  >
                                    Advance to Step {tutorResult.progressUpdate.nextLevelNumber}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAttempt(null);
                                      setTutorResult(null);
                                    }}
                                    className="py-2 px-4 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors"
                                  >
                                    Return to Course Path
                                  </button>
                                )
                              ) : tutorResult.tutor.nextAction === 'review' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onNavigateToReview) {
                                      onNavigateToReview();
                                    } else {
                                      setLessonMode('quiz');
                                    }
                                  }}
                                  className="py-2 px-4 text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] rounded-lg transition-colors"
                                >
                                  Review Concept
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => codeEditorRef.current?.focus()}
                                  className="py-2 px-4 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors"
                                >
                                  Retry Code
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-[#1D2433] dark:text-[#E8EBF4] leading-relaxed">
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
                        className="px-2.5 py-1 text-xs font-semibold text-[#4F46E5] dark:text-[#A5B4FC] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg shrink-0"
                      >
                        Audio
                      </button>
                    </div>

                    {promptTranscript && (
                      <div className="p-2.5 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg text-xs text-[#1D2433] dark:text-[#E8EBF4]">
                        {promptTranscript}
                      </div>
                    )}

                    {currentQuestion.codeSnippet && (
                      <pre className="p-4 bg-[#12141C] text-[#E8EBF4] border border-[#363D57] rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
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
                            className={`flex items-center gap-3 p-3 text-sm border border-[#D5DCE8] dark:border-[#363D57] rounded-xl cursor-pointer transition-colors ${
                              selectedAnswer === String(idx)
                                ? 'bg-[#EEF1F7] dark:bg-[#222638] font-semibold'
                                : 'bg-white dark:bg-[#1A1D28] hover:bg-[#EEF1F7] dark:hover:bg-[#222638]'
                            }`}
                          >
                            <input
                              type="radio"
                              name="mc-answer"
                              disabled={Boolean(answerFeedback)}
                              value={String(idx)}
                              checked={selectedAnswer === String(idx)}
                              onChange={(e) => setSelectedAnswer(e.target.value)}
                              className="accent-[#4F46E5]"
                            />
                            <span className="font-mono text-xs text-[#4B556B] dark:text-[#B4BCD0]">
                              {idx + 1}.
                            </span>
                            <span className="text-[#1D2433] dark:text-[#E8EBF4]">{opt}</span>
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
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
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
                            className="text-xs font-semibold text-[#7C3AED] dark:text-[#C4B5FD] px-3 py-2 bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg transition-colors whitespace-nowrap"
                          >
                            Ask Aristotle for Hint
                          </button>
                        ) : (
                          <span />
                        )}

                        <button
                          type="submit"
                          disabled={submitting || !selectedAnswer.trim()}
                          className="py-2 px-5 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-xl whitespace-nowrap transition-colors"
                        >
                          {submitting ? 'Checking...' : 'Check Answer'}
                        </button>
                      </div>
                    )}
                  </form>

                  {answerFeedback && (
                    <div className="p-4 rounded-xl bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] space-y-2.5">
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span
                          className={
                            answerFeedback.isCorrect
                              ? 'text-[#15803D] dark:text-[#4ADE80]'
                              : 'text-[#DC2626] dark:text-[#F87171]'
                          }
                        >
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
                          className="text-xs font-semibold text-[#4F46E5] dark:text-[#A5B4FC] hover:underline"
                        >
                          Listen
                        </button>
                      </div>
                      <p className="text-xs leading-relaxed text-[#1D2433] dark:text-[#E8EBF4]">
                        {answerFeedback.explanation}
                      </p>
                      {explanationTranscript &&
                        explanationTranscript !== answerFeedback.explanation && (
                          <p className="text-xs pt-1 border-t border-[#D5DCE8] dark:border-[#363D57] text-[#1D2433] dark:text-[#E8EBF4]">
                            {explanationTranscript}
                          </p>
                        )}

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleNextOrFinish()}
                        className="w-full mt-2 py-2.5 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-xl transition-colors"
                      >
                        {answerFeedback.attemptStatus === 'FAILED'
                          ? 'View Result'
                          : qIndex + 1 < attempt.questions.length
                            ? 'Next Question'
                            : 'Finish Attempt'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : !placement ? (
            <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-3">
              <h3 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
                Select an open step
              </h3>
              <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
                Choose an unlocked lesson on the left to start practicing. Every 5th step is a
                sum-up quiz covering the preceding lessons.
              </p>
              {selectedSlug === 'python' &&
                unitLevels.some((l) => l.unlocked) && (
                  <button
                    type="button"
                    onClick={() => {
                      const target =
                        unitLevels.find((l) => l.unlocked && !l.passed) ??
                        unitLevels.find((l) => l.unlocked)!;
                      void handleStartLevel(target, 'code');
                    }}
                    className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-xl transition-colors"
                  >
                    Open Code Tutor for Step{' '}
                    {(
                      unitLevels.find((l) => l.unlocked && !l.passed) ??
                      unitLevels.find((l) => l.unlocked)!
                    ).number}
                  </button>
                )}
              {onAskAristotle && (
                <button
                  type="button"
                  onClick={() =>
                    onAskAristotle('What should I focus on in this unit?', 'plan')
                  }
                  className="text-xs font-semibold text-[#7C3AED] dark:text-[#C4B5FD] hover:underline"
                >
                  Ask Aristotle for a unit walkthrough
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
