export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  timezone: string;
  isAdult: boolean;
}

export interface TrackSummary {
  id: string;
  slug: string;
  title: string;
  levelCount: number;
  order: number;
  isPlaceholder: boolean;
  unlocked: boolean;
  lockedReason: string | null;
  userPoints: number;
  maxPoints: number;
  units: Array<{ id: string; title: string; order: number }>;
}

export interface LevelSummary {
  id: string;
  number: number;
  type: 'LESSON' | 'CHECKPOINT';
  title: string;
  isCheckpoint: boolean;
  awardsPoint: boolean;
  unlocked: boolean;
  passed: boolean;
  viaPlacement: boolean;
  bestScorePct: number | null;
}

export interface TrackLevelsResponse {
  track: TrackSummary;
  units: Array<{
    id: string;
    title: string;
    order: number;
    levels: LevelSummary[];
  }>;
}

export interface PublicQuestion {
  id: string;
  levelId: string;
  type: 'MULTIPLE_CHOICE' | 'TYPE_OUTPUT';
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: string[] | null;
}

export interface AttemptStartResponse {
  attemptId: string;
  levelId: string;
  levelNumber: number;
  levelType: 'LESSON' | 'CHECKPOINT';
  heartsRemaining: number;
  totalQuestions: number;
  passMark: number;
  questions: PublicQuestion[];
}

export interface AnswerSubmitResponse {
  attemptId: string;
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  heartsRemaining: number;
  xpDelta: number;
  attemptXpEarned: number;
  attemptStatus: 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  answeredCount: number;
  totalQuestions: number;
}

export interface AttemptFinishResponse {
  attemptId: string;
  status: 'PASSED' | 'FAILED';
  passed: boolean;
  scorePct: number;
  passMark: number;
  heartsRemaining: number;
  completionXpAwarded: number;
  totalAttemptXp: number;
  pointAwarded: boolean;
  streak: {
    current: number;
    longest: number;
    incrementedToday: boolean;
  };
}

export interface UserStats {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastStreakDate: string | null;
  timezone: string;
  totalPoints: number;
  passedLevelsCount: number;
}

export interface ReviewQueueItem {
  id: string;
  questionId: string;
  wrongCount: number;
  consecutiveCorrect: number;
  intervalStage: number;
  nextReviewAt: string;
  isDue: boolean;
  question: {
    id: string;
    levelId: string;
    type: string;
    prompt: string;
  } | null;
}

export interface CommitmentItem {
  id: string;
  trackId: string;
  startDate: string;
  durationDays: number;
  timezone: string;
  mode: 'SIMULATED' | 'DEPOSIT_REFUND' | 'PENALTY';
  missedDayMode: 'INACTIVE_DAYS' | 'LATE_DAYS';
  dailyPenaltyCents: number;
  finalFailPenaltyCents: number;
  maxTotalPenaltyCents: number;
  excusedDaysAllowed: number;
  currency: string;
  status: string;
  requiredLevelsPerDay: number;
  hasActiveAppeal: boolean;
  finalPassedAt: string | null;
  track?: { id: string; slug: string; title: string };
  penalties: Array<{ id: string; type: string; date: string; amountCents: number; voidedAt: string | null }>;
  finalSubmissions: Array<{
    id: string;
    type: 'EXAM' | 'PROJECT';
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    attemptNumber: number;
    scorePct?: number;
    projectUrl?: string;
    reviewNotes?: string;
  }>;
  appeals: Array<{ id: string; reason: string; status: string; createdAt: string }>;
}

const STORAGE_KEY = 'codemania_auth_session';

export interface StoredSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnAuth = true,
): Promise<T> {
  const session = loadSession();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401 && retryOnAuth && session?.refreshToken) {
    const refreshRes = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (refreshRes.ok) {
      const tokens = (await refreshRes.json()) as { accessToken: string; refreshToken: string };
      saveSession({ ...session, ...tokens });
      return request<T>(path, options, false);
    }
    saveSession(null);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'API_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }

  return json as T;
}

export const api = {
  register: (body: {
    email: string;
    password: string;
    name?: string;
    timezone?: string;
    isAdult: boolean;
  }) =>
    request<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: (refreshToken: string) =>
    request<void>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  getTracks: () => request<{ tracks: TrackSummary[] }>('/tracks'),
  getTrackLevels: (slug: string) => request<TrackLevelsResponse>(`/tracks/${slug}/levels`),
  startPlacementTest: (slug: string, targetUnitOrder: number) =>
    request<{
      placementTestId: string;
      trackSlug: string;
      targetUnitOrder: number;
      questions: PublicQuestion[];
    }>(`/tracks/${slug}/placement-test`, {
      method: 'POST',
      body: JSON.stringify({ targetUnitOrder }),
    }),
  submitPlacementTest: (
    slug: string,
    testId: string,
    answers: Array<{ questionId: string; answer: string }>,
  ) =>
    request<{
      placementTestId: string;
      passed: boolean;
      scorePct: number;
      correctCount: number;
      totalQuestions: number;
      skippedLevelsCount: number;
      xpAwarded: number;
      pointsAwarded: number;
    }>(`/tracks/${slug}/placement-test/${testId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  startAttempt: (levelId: string) =>
    request<AttemptStartResponse>(`/levels/${levelId}/attempts`, { method: 'POST' }),
  submitAnswer: (attemptId: string, body: { questionId: string; answer: string }) =>
    request<AnswerSubmitResponse>(`/attempts/${attemptId}/answers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  finishAttempt: (attemptId: string) =>
    request<AttemptFinishResponse>(`/attempts/${attemptId}/finish`, { method: 'POST' }),

  getMyStats: () => request<UserStats>('/me/stats'),
  getMyReviewQueue: () => request<{ items: ReviewQueueItem[] }>('/me/review-queue'),

  getPromptAudio: (questionId: string) =>
    request<{ audioUrl: string | null; status: string; transcript: string }>(
      `/questions/${questionId}/audio`,
    ),
  getExplanationAudio: (questionId: string) =>
    request<{ audioUrl: string | null; status: string; transcript: string }>(
      `/questions/${questionId}/explanation-audio`,
    ),

  getCommitments: () => request<{ commitments: CommitmentItem[] }>('/commitments'),
  createCommitment: (body: Record<string, unknown>) =>
    request<{
      commitment: CommitmentItem;
      requiredLevelsPerDay: number;
      exceedsRecommendedPace: boolean;
      remainingLevels: number;
      stripeCheckoutUrl: string | null;
    }>('/commitments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startFinalExam: (commitmentId: string) =>
    request<{
      submissionId: string;
      attemptNumber: number;
      expiresAt: string;
      timeLimitMinutes: number;
      passMark: number;
      questions: PublicQuestion[];
    }>(`/commitments/${commitmentId}/final-exam/start`, { method: 'POST' }),
  submitFinal: (commitmentId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/commitments/${commitmentId}/final-submission`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createAppeal: (commitmentId: string, body: { finalSubmissionId?: string; reason: string }) =>
    request<Record<string, unknown>>(`/commitments/${commitmentId}/appeal`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  adminListQuestions: (status?: string) =>
    request<{ questions: Array<Record<string, unknown>> }>(
      `/admin/questions${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  adminCreateQuestion: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/admin/questions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminReviewQuestion: (id: string, body: { decision: 'APPROVED' | 'REJECTED'; reason: string }) =>
    request<Record<string, unknown>>(`/admin/questions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminListAuditLogs: () =>
    request<{ logs: Array<Record<string, unknown>> }>('/admin/audit-logs'),
  adminListFinalSubmissions: () =>
    request<{ submissions: Array<Record<string, unknown>> }>('/admin/final-submissions'),
  adminReviewFinalSubmission: (
    id: string,
    body: { decision: 'APPROVED' | 'REJECTED'; reviewNotes: string },
  ) =>
    request<Record<string, unknown>>(`/admin/final-submissions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Section 13: Daily Quiz "Aristotle" & Leaderboards
  updateProfile: (body: { displayName: string; country?: string | null }) =>
    request<{
      id: string;
      email: string;
      displayName: string | null;
      displayNameStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
      country: string | null;
    }>('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getDailyToday: () =>
    request<{
      quizDate: string;
      dailyTz: string;
      state: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';
      available: boolean;
      currentPosition?: number;
      timeLimitSeconds: number;
      timeRemainingSeconds: number | null;
      totalQuestions: number;
      totalScore?: number;
      totalTimeMs?: number;
      aristotleIntro: string;
    }>('/daily/today'),

  startDailyQuiz: () =>
    request<{
      attemptId: string;
      quizDate: string;
      state: 'IN_PROGRESS';
      currentPosition: number;
      totalQuestions: number;
      timeLimitSeconds: number;
      timeRemainingSeconds: number;
      aristotleIntro: string;
      question: {
        id: string;
        position: number;
        type: 'ESTIMATE' | 'MULTIPLE_CHOICE';
        prompt: string;
        codeSnippet: string | null;
        spokenText: string | null;
        options: string[] | null;
      };
    }>('/daily/start', { method: 'POST' }),

  getDailyQuestion: () =>
    request<{
      attemptId: string;
      quizDate: string;
      currentPosition: number;
      totalQuestions: number;
      timeLimitSeconds: number;
      timeRemainingSeconds: number;
      isTimedOut: boolean;
      question: {
        id: string;
        position: number;
        type: 'ESTIMATE' | 'MULTIPLE_CHOICE';
        prompt: string;
        codeSnippet: string | null;
        spokenText: string | null;
        options: string[] | null;
      };
    }>('/daily/question'),

  submitDailyAnswer: (body: { questionId: string; givenValue?: string | number | null; quizDate?: string }) =>
    request<{
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
      attempt: {
        id: string;
        totalScore: number;
        totalTimeMs: number;
        finishedAt: string | null;
        nextPosition: number | null;
      };
    }>('/daily/answer', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getDailyResult: () =>
    request<{
      attemptId: string;
      quizDate: string;
      startedAt: string;
      finishedAt: string;
      totalScore: number;
      totalTimeMs: number;
      maxScore: number;
      aristotleSummary: string;
      answers: Array<{
        position: number;
        questionId: string;
        type: 'ESTIMATE' | 'MULTIPLE_CHOICE';
        prompt: string;
        codeSnippet: string | null;
        options: string[] | null;
        givenValue: string | null;
        score: number;
        timeMs: number;
        isLate: boolean;
        correctAnswer: string;
        numericAnswer: number | null;
        explanation: string;
      }>;
    }>('/daily/result'),

  getLeaderboard: (period: 'daily' | 'weekly' | 'all-time', limit = 20, cursor?: string) => {
    const q = new URLSearchParams({ period, limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return request<{
      period: string;
      periodKey: string;
      entries: Array<{
        userId: string;
        displayName: string;
        country: string | null;
        score: number;
        timeMs: number;
        updatedAt: string;
      }>;
      nextCursor: string | null;
    }>(`/leaderboard?${q.toString()}`);
  },

  getMyLeaderboard: (period: 'daily' | 'weekly' | 'all-time') =>
    request<{
      period: string;
      periodKey: string;
      eligible: boolean;
      reason?: string;
      rank: number | null;
      neighbors: Array<{
        rank: number;
        userId: string;
        displayName: string;
        country: string | null;
        score: number;
        timeMs: number;
        isMe: boolean;
      }>;
    }>(`/leaderboard/me?period=${encodeURIComponent(period)}`),

  adminListDailyQuestions: (status?: string) =>
    request<{ questions: Array<Record<string, unknown>> }>(
      `/admin/daily/questions${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  adminSubmitDailyQuestion: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/admin/daily/questions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminReviewDailyQuestion: (id: string, body: { decision: 'APPROVED' | 'REJECTED'; reason: string }) =>
    request<Record<string, unknown>>(`/admin/daily/questions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminGetDailyBuffer: () =>
    request<{
      todayDate: string;
      dailyTz: string;
      bufferDaysConfigured: number;
      availableReserveCount: number;
      days: Array<{
        quizDate: string;
        status: string | null;
        totalQuestions: number;
        approvedCount: number;
        publishable: boolean;
        usedReserveFallback: boolean;
      }>;
    }>('/admin/daily/buffer'),
  adminRunDailyScheduler: () =>
    request<{
      todayDate: string;
      todayUsedReserveFallback: boolean;
      closedCount: number;
      bufferedDatesCreated: string[];
      alertsCreated: number;
    }>('/admin/daily/scheduler/run', { method: 'POST' }),
  adminListAristotleTemplates: () =>
    request<{
      templates: Array<{ id: string; key: string; title: string; body: string; language: string; voiceId: string }>;
    }>('/admin/daily/templates'),
  adminUpdateAristotleTemplate: (
    key: string,
    body: { title: string; body: string; language?: string; voiceId?: string },
  ) =>
    request<Record<string, unknown>>(`/admin/daily/templates/${key}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  adminListDailyAlerts: () =>
    request<{
      alerts: Array<{ id: string; type: string; message: string; quizDate: string | null; createdAt: string }>;
    }>('/admin/daily/alerts'),
  adminResolveDailyAlert: (id: string) =>
    request<Record<string, unknown>>(`/admin/daily/alerts/${id}/resolve`, { method: 'POST' }),

  aristotleChat: (body: {
    message: string;
    mode?: 'hint' | 'explain' | 'debug' | 'plan' | 'general';
    history?: Array<{ role: 'user' | 'model'; text: string }>;
    context?: {
      activeTab?: string;
      trackTitle?: string;
      unitTitle?: string;
      levelNumber?: number;
      levelType?: string;
      questionPrompt?: string;
      codeSnippet?: string | null;
      stats?: {
        xp?: number;
        currentStreak?: number;
        totalPoints?: number;
        passedLevelsCount?: number;
      };
    };
  }) => request<{ reply: string }>('/api/aristotle/chat', { method: 'POST', body: JSON.stringify(body) }),

  aristotleSpeak: (body: { text: string; style?: string }) =>
    request<{ mimeType: string; audioBase64: string }>('/api/aristotle/speak', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aristotleTranscribe: (body: { audioBase64: string; mimeType: string }) =>
    request<{ transcript: string }>('/api/aristotle/transcribe', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

