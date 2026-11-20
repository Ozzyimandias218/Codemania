import {
  AristotleTemplateKey,
  AttemptStatus,
  CommitmentMode,
  CommitmentStatus,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  DailyQuizStatus,
  DisplayNameStatus,
  FinalSubmissionStatus,
  FinalSubmissionType,
  LeaderboardPeriod,
  LevelType,
  MissedDayMode,
  QuestionOrigin,
  QuestionStatus,
  QuestionType,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env, getAdminEmailSet } from '../config/env.ts';
import { AuthenticatedRequest, requireAdmin, requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';
import { validateQuestionContentRules } from '../services/admin.service.ts';
import { selectCheckpointQuestions } from '../services/checkpoint.service.ts';
import {
  FINAL_EXAM_PASS_MARK,
  MAX_FINAL_EXAM_ATTEMPTS,
  evaluatePaceRequirement,
} from '../services/commitment.service.ts';
import {
  GAME_CONSTANTS,
  calculateStreakUpdate,
  computeReviewQueueTransition,
  getCompletionXpForLevelType,
  getEffectiveStreak,
  getPassMarkForLevelType,
} from '../services/game.service.ts';
import {
  evaluateTrackUnlock,
  isLevelUnlocked,
  sanitizePublicQuestion,
} from '../services/track.service.ts';
import {
  buildExplanationTranscript,
  buildQuestionPromptTranscript,
} from '../services/tts/voice.service.ts';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.ts';
import {
  DAILY_QUIZ_QUESTION_COUNT,
  FINGERPRINT_WINDOW_DAYS,
  validateDailyQuestionCandidatePayload,
} from '../services/dailyQuiz.service.ts';
import {
  decodeLeaderboardCursor,
  encodeLeaderboardCursor,
  resolvePeriodAndKey,
} from '../services/leaderboard.service.ts';
import {
  computePromptFingerprint,
  getIsoWeekKey,
  moderateDisplayName,
  renderAristotleTemplate,
  scoreEstimate,
  scoreMultipleChoice,
} from '../utils/dailyQuiz.ts';
import { sha256 } from '../utils/hash.ts';
import { shuffleArray } from '../utils/shuffle.ts';
import { addDaysToDateString, formatDateInTimezone, isValidTimezone } from '../utils/timezone.ts';

interface MemUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  displayName: string | null;
  displayNameStatus: DisplayNameStatus;
  country: string | null;
  role: UserRole;
  timezone: string;
  isAdult: boolean;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastStreakDate: string | null;
}

interface MemDailyQuiz {
  id: string;
  quizDate: string;
  status: DailyQuizStatus;
  publishedAt: Date | null;
  closedAt: Date | null;
  usedReserveFallback: boolean;
}

interface MemDailyQuestion {
  id: string;
  dailyQuizId: string | null;
  position: number | null;
  type: DailyQuestionType;
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: string[] | null;
  correctAnswer: string;
  numericAnswer: number | null;
  scale: number | null;
  explanation: string;
  sourceUrl: string | null;
  license: string | null;
  status: DailyQuestionStatus;
  rejectionReason: string | null;
  generatedBy: DailyQuestionOrigin;
  fingerprint: string;
  lastUsedDate: string | null;
  isReserve: boolean;
  createdAt: Date;
}

interface MemDailyAttempt {
  id: string;
  userId: string;
  dailyQuizId: string;
  quizDate: string;
  startedAt: Date;
  currentPosition: number;
  currentQuestionStartedAt: Date;
  finishedAt: Date | null;
  totalScore: number;
  totalTimeMs: number;
  answers: Array<{
    questionId: string;
    position: number;
    givenValue: string | null;
    score: number;
    timeMs: number;
    isLate: boolean;
    submittedAt: Date;
  }>;
}

interface MemTrack {
  id: string;
  slug: string;
  title: string;
  levelCount: number;
  order: number;
  isPlaceholder: boolean;
  prerequisites: Array<{ requiredTrackId: string; requiredTrackTitle: string; requiredPoints: number }>;
}

interface MemUnit {
  id: string;
  trackId: string;
  title: string;
  order: number;
}

interface MemLevel {
  id: string;
  unitId: string;
  trackId: string;
  number: number;
  type: LevelType;
  title: string;
}

interface MemQuestion {
  id: string;
  levelId: string;
  questionGroupId: string;
  type: QuestionType;
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: string[] | null;
  answer: string;
  explanation: string;
  origin: QuestionOrigin;
  sourceUrl: string | null;
  license: string | null;
  status: QuestionStatus;
  rejectionReason: string | null;
  version: number;
  isLatest: boolean;
  createdAt: Date;
}

interface MemAttempt {
  id: string;
  userId: string;
  levelId: string;
  trackId: string;
  type: LevelType;
  status: AttemptStatus;
  heartsRemaining: number;
  xpEarned: number;
  questionIds: string[];
  answeredIds: Set<string>;
  correctCount: number;
  answeredCount: number;
}

interface MemReviewItem {
  id: string;
  userId: string;
  questionId: string;
  wrongCount: number;
  consecutiveCorrect: number;
  intervalStage: number;
  nextReviewAt: Date;
  lastReviewedAt: Date;
}

interface MemCommitment {
  id: string;
  userId: string;
  trackId: string;
  startDate: Date;
  durationDays: number;
  timezone: string;
  mode: CommitmentMode;
  missedDayMode: MissedDayMode;
  dailyPenaltyCents: number;
  finalFailPenaltyCents: number;
  depositCents: number | null;
  maxTotalPenaltyCents: number;
  excusedDaysAllowed: number;
  currency: string;
  status: CommitmentStatus;
  termsVersion: string;
  termsAcceptedAt: Date;
  requiredLevelsPerDay: number;
  hasActiveAppeal: boolean;
  finalPassedAt: Date | null;
  penalties: Array<{ id: string; type: string; date: string; amountCents: number; voidedAt: Date | null }>;
  finalSubmissions: Array<{
    id: string;
    commitmentId: string;
    userId: string;
    type: FinalSubmissionType;
    status: FinalSubmissionStatus;
    attemptNumber: number;
    questionIds?: string[];
    scorePct?: number;
    startedAt?: Date;
    expiresAt?: Date;
    submittedAt?: Date;
    projectUrl?: string;
    projectNotes?: string;
    reviewNotes?: string;
  }>;
  appeals: Array<{
    id: string;
    commitmentId: string;
    userId: string;
    finalSubmissionId: string | null;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    adminDecisionNotes: string | null;
    createdAt: Date;
  }>;
}

/**
 * In-memory sandbox store used ONLY in non-production when PostgreSQL at DATABASE_URL
 * is unreachable, so the full Codemania MVP runs seamlessly in preview sandboxes.
 */
export function createSandboxFallbackRouter(): Router {
  const users = new Map<string, MemUser>();
  const refreshTokens = new Map<string, { userId: string; revoked: boolean; expiresAt: number }>();
  const tracks: MemTrack[] = [];
  const units: MemUnit[] = [];
  const levels: MemLevel[] = [];
  const questions: MemQuestion[] = [];
  const progress = new Map<string, { levelId: string; trackId: string; levelNumber: number; viaPlacement: boolean; bestScorePct: number; passedAt: Date }>();
  const pointEvents: Array<{ id: string; userId: string; trackId: string; trackSlug: string; levelNumber: number; points: number; createdAt: Date }> = [];
  const attempts = new Map<string, MemAttempt>();
  const userAnsweredQuestions = new Set<string>(); // `${userId}:${questionId}`
  const reviewQueue = new Map<string, MemReviewItem>(); // `${userId}:${questionId}`
  const placementTests = new Map<string, { id: string; userId: string; trackId: string; targetUnitOrder: number; questionIds: string[]; status: 'IN_PROGRESS' | 'PASSED' | 'FAILED' }>();
  const commitments = new Map<string, MemCommitment>();
  const auditLogs: Array<{ id: string; actorUserId: string; actorEmail: string; entityType: string; entityId: string; action: string; reason: string | null; changes: unknown; createdAt: Date }> = [];

  // Seed default demo learner and admin + curriculum
  const adminHash = bcrypt.hashSync('CodemaniaAdmin123!', 10);
  const learnerHash = bcrypt.hashSync('CodemaniaUser123!', 10);
  const adminUser: MemUser = {
    id: 'user-admin',
    email: 'admin@codemania.dev',
    passwordHash: adminHash,
    name: 'Codemania Admin',
    displayName: 'AristotleAdmin',
    displayNameStatus: DisplayNameStatus.APPROVED,
    country: 'US',
    role: UserRole.ADMIN,
    timezone: 'UTC',
    isAdult: true,
    xp: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastStreakDate: null,
  };
  const demoUser: MemUser = {
    id: 'user-demo',
    email: 'learner@codemania.dev',
    passwordHash: learnerHash,
    name: 'Demo Learner',
    displayName: 'DemoCoder',
    displayNameStatus: DisplayNameStatus.APPROVED,
    country: 'GE',
    role: UserRole.USER,
    timezone: 'UTC',
    isAdult: true,
    xp: 40,
    currentStreak: 1,
    longestStreak: 1,
    lastStreakDate: new Date().toISOString().slice(0, 10),
  };
  users.set(adminUser.id, adminUser);
  users.set(demoUser.id, demoUser);

  // Additional leaderboard users for MVP testing
  const rivalUsers: MemUser[] = [
    {
      id: 'user-rival-1',
      email: 'ada@codemania.dev',
      passwordHash: learnerHash,
      name: 'Ada Lovelace',
      displayName: 'AdaLovelace',
      displayNameStatus: DisplayNameStatus.APPROVED,
      country: 'GB',
      role: UserRole.USER,
      timezone: 'UTC',
      isAdult: true,
      xp: 320,
      currentStreak: 5,
      longestStreak: 7,
      lastStreakDate: null,
    },
    {
      id: 'user-rival-2',
      email: 'grace@codemania.dev',
      passwordHash: learnerHash,
      name: 'Grace Hopper',
      displayName: 'GraceCompiler',
      displayNameStatus: DisplayNameStatus.APPROVED,
      country: 'US',
      role: UserRole.USER,
      timezone: 'UTC',
      isAdult: true,
      xp: 280,
      currentStreak: 4,
      longestStreak: 4,
      lastStreakDate: null,
    },
  ];
  for (const ru of rivalUsers) users.set(ru.id, ru);

  const trackDefs = [
    {
      id: 'track-py',
      slug: 'python',
      title: 'Python',
      levelCount: 50,
      order: 1,
      isPlaceholder: false,
      unitNames: [
        'Foundations & Variables',
        'Decisions & Loops',
        'Functions & Scope',
        'Collections & Strings',
        'Classes & Modules',
      ],
    },
    {
      id: 'track-js',
      slug: 'javascript',
      title: 'JavaScript',
      levelCount: 50,
      order: 2,
      isPlaceholder: true,
      unitNames: [
        'Syntax & Values',
        'Control Flow & Async',
        'Functions & Closures',
        'Arrays & Objects',
        'Modules & Patterns',
      ],
    },
    {
      id: 'track-cpp',
      slug: 'cpp',
      title: 'C++',
      levelCount: 50,
      order: 3,
      isPlaceholder: true,
      unitNames: [
        'Types & References',
        'Control Flow & Loops',
        'Functions & Overloads',
        'Vectors & Maps',
        'Classes & Templates',
      ],
    },
  ];

  const pythonLessonTopicNames = [
    'Variables & Assignment',
    'Numbers & Arithmetic',
    'Strings & Indexing',
    'Booleans & Comparisons',
    'Foundations Sum-Up',
    'If / Elif Branches',
    'For Loops & Iteration',
    'While Loops & Break',
    'Range & Step Patterns',
    'Unit 1 Sum-Up Quiz',
    'Conditionals & Truthiness',
    'Nested Loops',
    'Loop Else & Continue',
    'Pattern Tracing',
    'Control Flow Sum-Up',
    'List Indexing & Slicing',
    'List Methods',
    'List Comprehensions',
    'Tuples & Unpacking',
    'Unit 2 Sum-Up Quiz',
    'Defining Functions',
    'Default Parameters',
    'Return Values & None',
    'Local vs Global Scope',
    'Functions Sum-Up',
    '*args & **kwargs',
    'Lambda Expressions',
    'Map & Filter',
    'Recursion Basics',
    'Unit 3 Sum-Up Quiz',
    'Dictionaries & Lookup',
    'Dict Iteration & .get()',
    'Sets & Membership',
    'String Formatting',
    'Collections Sum-Up',
    'Splitting & Joining',
    'Sorting with key=',
    'Enumerate & Zip',
    'File Context Managers',
    'Unit 4 Sum-Up Quiz',
    'Classes & __init__',
    'Instance Methods',
    'Inheritance Basics',
    'Try / Except Handling',
    'OOP Sum-Up',
    'Custom Exceptions',
    'Modules & Imports',
    'Dataclasses & Types',
    'Iterators & Generators',
    'Python Capstone Sum-Up',
  ];

  const unitQuestionBanks: Array<
    Array<{
      type: QuestionType;
      prompt: string;
      codeSnippet: string | null;
      spokenText: string;
      options: string[] | null;
      answer: string;
      explanation: string;
    }>
  > = [
    // Unit 1: Foundations & Variables
    [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which Python statement binds the integer 42 to a variable named score?',
        codeSnippet: null,
        spokenText: 'Which statement correctly assigns the integer 42 to score in Python?',
        options: ['int score = 42', 'score = 42', 'let score = 42', 'var score := 42'],
        answer: '1',
        explanation: 'Python binds variables dynamically using a single equals sign: score = 42.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What exact text does this snippet print?',
        codeSnippet: 'a = 7\nb = 3\nprint(a + b * 2)',
        spokenText: 'Given a equals 7 and b equals 3, what does print a plus b times 2 output?',
        options: null,
        answer: '13',
        explanation: 'Multiplication runs before addition: 3 * 2 is 6, and 7 + 6 equals 13.',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'What does type("hello") evaluate to in Python?',
        codeSnippet: 'label = "hello"\nprint(type(label))',
        spokenText: 'What built-in type represents quoted text like hello in Python?',
        options: ["<class 'char'>", "<class 'text'>", "<class 'str'>", "<class 'string'>"],
        answer: '2',
        explanation: 'Text values in Python belong to the built-in str class.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What is the output of slicing the first three characters?',
        codeSnippet: 'word = "Python"\nprint(word[:3])',
        spokenText: 'What does slicing the string Python from start up to index 3 print?',
        options: null,
        answer: 'Pyt',
        explanation: 'Slice word[:3] includes indices 0, 1, and 2, yielding "Pyt".',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which operator checks value equality without assigning?',
        codeSnippet: 'x = 10\ny = 10',
        spokenText: 'Which Python operator tests whether two values are equal?',
        options: ['=', '===', '==', 'equals'],
        answer: '2',
        explanation: 'Double equals (==) compares values; single equals (=) assigns variables.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What exact number does integer floor division print?',
        codeSnippet: 'print(17 // 5)',
        spokenText: 'What does 17 floor divided by 5 print in Python?',
        options: null,
        answer: '3',
        explanation: 'The // operator performs floor division, returning the whole quotient 3.',
      },
    ],
    // Unit 2: Decisions & Loops
    [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which keyword handles additional conditions after an if block?',
        codeSnippet: 'if x > 10:\n    pass\n___ x > 5:\n    pass',
        spokenText: 'Which keyword chains another conditional check after an if statement in Python?',
        options: ['elseif', 'elif', 'else if', 'when'],
        answer: '1',
        explanation: 'Python shortens "else if" into the keyword elif.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What is the final printed total after this loop finishes?',
        codeSnippet: 'total = 0\nfor n in range(1, 5):\n    total += n\nprint(total)',
        spokenText: 'What does summing numbers from range 1 to 5 print?',
        options: null,
        answer: '10',
        explanation: 'range(1, 5) yields 1, 2, 3, and 4. Their sum is 10.',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which statement immediately exits the nearest enclosing loop?',
        codeSnippet: 'while True:\n    if done:\n        ___',
        spokenText: 'Which Python keyword exits a loop early before its condition turns false?',
        options: ['stop', 'return', 'break', 'continue'],
        answer: '2',
        explanation: 'break exits the loop completely; continue skips only to the next iteration.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'Type the exact output printed by this stepped range.',
        codeSnippet: 'print(list(range(2, 9, 3)))',
        spokenText: 'What list does range starting at 2, stopping before 9, stepping by 3 produce?',
        options: null,
        answer: '[2, 5, 8]',
        explanation: 'Starting at 2 and adding 3 each step gives 2, 5, and 8 before stopping below 9.',
      },
    ],
    // Unit 3: Functions & Scope
    [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which keyword declares a reusable function in Python?',
        codeSnippet: '___ greet(name):\n    return f"Hi {name}"',
        spokenText: 'Which Python keyword defines a function?',
        options: ['func', 'def', 'fn', 'function'],
        answer: '1',
        explanation: 'Python functions begin with def followed by the function name and parameters.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What does calling this function with default arguments print?',
        codeSnippet: 'def scale(n, factor=3):\n    return n * factor\nprint(scale(4))',
        spokenText: 'When scale of 4 is called with default factor 3, what is printed?',
        options: null,
        answer: '12',
        explanation: 'Since factor is omitted, it defaults to 3, returning 4 * 3 = 12.',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'What does a Python function return if it has no return statement?',
        codeSnippet: 'def log_msg():\n    x = 1 + 1',
        spokenText: 'If a function ends without a return statement, what value does it return?',
        options: ['0', 'False', 'None', 'undefined'],
        answer: '2',
        explanation: 'Functions without an explicit return value implicitly return None.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What does this lambda expression print?',
        codeSnippet: 'sq = lambda x: x * x\nprint(sq(6))',
        spokenText: 'What does applying a squaring lambda to 6 output?',
        options: null,
        answer: '36',
        explanation: 'lambda x: x * x evaluates 6 * 6 and prints 36.',
      },
    ],
    // Unit 4: Collections & Strings
    [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which Python collection is ordered, indexed, and mutable?',
        codeSnippet: 'items = [10, 20, 30]',
        spokenText: 'Which built-in Python sequence created with square brackets is mutable?',
        options: ['tuple', 'list', 'frozenset', 'str'],
        answer: '1',
        explanation: 'Lists declared with [] are ordered and allow in-place element changes.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What exact integer does dict.get() return here?',
        codeSnippet: 'scores = {"ada": 98}\nprint(scores.get("grace", 90))',
        spokenText: 'When looking up a missing key with dict.get and fallback 90, what prints?',
        options: null,
        answer: '90',
        explanation: '.get(key, default) returns the fallback 90 instead of raising KeyError.',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which built-in removes duplicate values automatically?',
        codeSnippet: 'unique = ___([1, 2, 2, 3])',
        spokenText: 'Which Python collection type stores only unique hashable items?',
        options: ['list', 'tuple', 'set', 'dict'],
        answer: '2',
        explanation: 'A set automatically deduplicates items and provides O(1) average membership checks.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What exact string does join produce?',
        codeSnippet: 'print("-".join(["py", "3"]))',
        spokenText: 'What string is produced by joining py and 3 with a hyphen?',
        options: null,
        answer: 'py-3',
        explanation: 'str.join concatenates sequence strings with the separator between elements.',
      },
    ],
    // Unit 5: Classes & Modules
    [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'Which special method initializes attributes on a newly created class instance?',
        codeSnippet: 'class Player:\n    def ___(self, name):\n        self.name = name',
        spokenText: 'Which dunder method initializes new Python class instances?',
        options: ['__start__', '__init__', '__new_obj__', '__create__'],
        answer: '1',
        explanation: '__init__ runs right after object creation to set initial instance attributes.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What does this exception handling snippet print?',
        codeSnippet: 'try:\n    print(10 // 0)\nexcept ZeroDivisionError:\n    print("safe")',
        spokenText: 'When ZeroDivisionError is caught by except, what string is printed?',
        options: null,
        answer: 'safe',
        explanation: 'Dividing by zero triggers ZeroDivisionError, jumping to the except block.',
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: 'What does the first parameter `self` represent inside an instance method?',
        codeSnippet: 'def gain_xp(self, pts):\n    self.xp += pts',
        spokenText: 'What does self refer to inside a Python class method?',
        options: [
          'The parent module',
          'The current object instance',
          'A global singleton',
          'The class constructor only',
        ],
        answer: '1',
        explanation: 'self is bound automatically to the specific object instance the method was called on.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: 'What does this class property evaluate to?',
        codeSnippet: 'class Counter:\n    def __init__(self, n):\n        self.n = n\nprint(Counter(5).n + 2)',
        spokenText: 'What does Counter of 5 dot n plus 2 output?',
        options: null,
        answer: '7',
        explanation: 'Counter(5) stores self.n = 5, so Counter(5).n + 2 evaluates to 7.',
      },
    ],
  ];

  for (const td of trackDefs) {
    const prereqs =
      td.slug === 'javascript'
        ? [{ requiredTrackId: 'track-py', requiredTrackTitle: 'Python', requiredPoints: 5 }]
        : td.slug === 'cpp'
          ? [{ requiredTrackId: 'track-js', requiredTrackTitle: 'JavaScript', requiredPoints: 5 }]
          : [];
    tracks.push({
      id: td.id,
      slug: td.slug,
      title: td.title,
      levelCount: td.levelCount,
      order: td.order,
      isPlaceholder: td.isPlaceholder,
      prerequisites: prereqs,
    });

    for (let u = 0; u < 5; u++) {
      const unitId = `${td.id}-u${u + 1}`;
      units.push({ id: unitId, trackId: td.id, title: `Unit ${u + 1}: ${td.unitNames[u]}`, order: u + 1 });
      for (let offset = 1; offset <= 10; offset++) {
        const num = u * 10 + offset;
        const type = num % 5 === 0 ? LevelType.CHECKPOINT : LevelType.LESSON;
        const lvlId = `${td.id}-l${num}`;
        const topicTitle =
          td.slug === 'python'
            ? pythonLessonTopicNames[num - 1] ?? `Python Lesson ${num}`
            : type === LevelType.CHECKPOINT
              ? `${td.title} Sum-Up ${num / 5}`
              : `${td.title} Lesson ${num}`;
        levels.push({
          id: lvlId,
          unitId,
          trackId: td.id,
          number: num,
          type,
          title: topicTitle,
        });

        if (td.slug === 'python' && type === LevelType.LESSON) {
          const bank = unitQuestionBanks[u] ?? unitQuestionBanks[0];
          const q1 = bank[(num - 1) % bank.length];
          const q2 = bank[num % bank.length];
          const q3Offset = bank[(num + 1) % bank.length];

          questions.push(
            {
              id: `q-py-${num}-1`,
              levelId: lvlId,
              questionGroupId: `grp-py-${num}-1`,
              type: q1.type,
              prompt: q1.prompt,
              codeSnippet: q1.codeSnippet,
              spokenText: q1.spokenText,
              options: q1.options,
              answer: q1.answer,
              explanation: q1.explanation,
              origin: QuestionOrigin.AUTHORED,
              sourceUrl: null,
              license: null,
              status: QuestionStatus.APPROVED,
              rejectionReason: null,
              version: 1,
              isLatest: true,
              createdAt: new Date(),
            },
            {
              id: `q-py-${num}-2`,
              levelId: lvlId,
              questionGroupId: `grp-py-${num}-2`,
              type: QuestionType.TYPE_OUTPUT,
              prompt: `Trace the Python arithmetic and print the exact output.`,
              codeSnippet: `step = ${num}\nprint(step * 2 + ${u + 1})`,
              spokenText: `Determine the exact integer printed when multiplying ${num} by 2 and adding ${u + 1}.`,
              options: null,
              answer: String(num * 2 + (u + 1)),
              explanation: `${num} * 2 + ${u + 1} evaluates to ${num * 2 + (u + 1)}, printed directly to stdout.`,
              origin: QuestionOrigin.AUTHORED,
              sourceUrl: null,
              license: null,
              status: QuestionStatus.APPROVED,
              rejectionReason: null,
              version: 1,
              isLatest: true,
              createdAt: new Date(),
            },
            {
              id: `q-py-${num}-3`,
              levelId: lvlId,
              questionGroupId: `grp-py-${num}-3`,
              type: q2.prompt === q1.prompt ? q3Offset.type : q2.type,
              prompt: q2.prompt === q1.prompt ? q3Offset.prompt : q2.prompt,
              codeSnippet: q2.prompt === q1.prompt ? q3Offset.codeSnippet : q2.codeSnippet,
              spokenText: q2.prompt === q1.prompt ? q3Offset.spokenText : q2.spokenText,
              options: q2.prompt === q1.prompt ? q3Offset.options : q2.options,
              answer: q2.prompt === q1.prompt ? q3Offset.answer : q2.answer,
              explanation: q2.prompt === q1.prompt ? q3Offset.explanation : q2.explanation,
              origin: QuestionOrigin.AUTHORED,
              sourceUrl: null,
              license: null,
              status: QuestionStatus.APPROVED,
              rejectionReason: null,
              version: 1,
              isLatest: true,
              createdAt: new Date(),
            },
          );
          if (num % 4 === 0) {
            questions.push({
              id: `q-py-${num}-web`,
              levelId: lvlId,
              questionGroupId: `grp-py-${num}-web`,
              type: QuestionType.MULTIPLE_CHOICE,
              prompt: `Which built-in Python function returns the number of items in a sequence?`,
              codeSnippet: 'len("codemania")',
              spokenText: 'Which Python built-in returns the number of items in a sequence?',
              options: ['count()', 'size()', 'len()', 'length()'],
              answer: '2',
              explanation: 'len() returns the length of strings, lists, tuples, and dictionaries.',
              origin: QuestionOrigin.WEB,
              sourceUrl: 'https://docs.python.org/3/library/functions.html#len',
              license: 'PSF-2.0',
              status: QuestionStatus.APPROVED,
              rejectionReason: null,
              version: 1,
              isLatest: true,
              createdAt: new Date(),
            });
          }
        }
      }
    }
  }

  // Seed one DRAFT WEB question for Admin moderation queue
  questions.push({
    id: 'q-py-draft-web-1',
    levelId: 'track-py-l1',
    questionGroupId: 'grp-py-draft-web-1',
    type: QuestionType.TYPE_OUTPUT,
    prompt: 'Draft review: What does print("hi".upper()) output?',
    codeSnippet: 'print("hi".upper())',
    spokenText: 'What does calling upper on the string hi print?',
    options: null,
    answer: 'HI',
    explanation: 'str.upper() returns an uppercase copy of the string.',
    origin: QuestionOrigin.WEB,
    sourceUrl: 'https://docs.python.org/3/library/stdtypes.html#str.upper',
    license: 'PSF-2.0',
    status: QuestionStatus.DRAFT,
    rejectionReason: null,
    version: 1,
    isLatest: true,
    createdAt: new Date(),
  });

  function issueTokens(user: MemUser) {
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
    const refreshToken = jwt.sign(
      { sub: user.id, jti: crypto.randomUUID(), type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
    refreshTokens.set(sha256(refreshToken), {
      userId: user.id,
      revoked: false,
      expiresAt: Date.now() + 30 * 86_400_000,
    });
    return { accessToken, refreshToken };
  }

  function getUserPointsMap(userId: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const ev of pointEvents) {
      if (ev.userId === userId) {
        map.set(ev.trackId, (map.get(ev.trackId) ?? 0) + ev.points);
      }
    }
    return map;
  }

  const router = Router();

  // AUTH
  router.post(
    '/auth/register',
    validateBody(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().optional(),
        timezone: z.string().optional(),
        isAdult: z.boolean(),
      }),
    ),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password, name, timezone = 'UTC', isAdult } = req.body;
      if (!isValidTimezone(timezone)) throw new BadRequestError(`Invalid timezone: ${timezone}`);
      const existing = Array.from(users.values()).find((u) => u.email === email.toLowerCase());
      if (existing) throw new ConflictError('An account with this email already exists', 'EMAIL_EXISTS');
      const role = getAdminEmailSet().has(email.toLowerCase()) ? UserRole.ADMIN : UserRole.USER;
      const user: MemUser = {
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        name: name ?? null,
        displayName: name ? name.trim().slice(0, 32) : null,
        displayNameStatus: name && moderateDisplayName(name).approved ? DisplayNameStatus.APPROVED : DisplayNameStatus.PENDING,
        country: null,
        role,
        timezone,
        isAdult,
        xp: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastStreakDate: null,
      };
      users.set(user.id, user);
      const tokens = issueTokens(user);
      res.status(201).json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role, timezone: user.timezone, isAdult: user.isAdult },
        ...tokens,
      });
    }),
  );

  router.post(
    '/auth/login',
    validateBody(z.object({ email: z.string().email(), password: z.string().min(1) })),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body;
      const user = Array.from(users.values()).find((u) => u.email === email.toLowerCase());
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
      }
      const tokens = issueTokens(user);
      res.status(200).json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role, timezone: user.timezone, isAdult: user.isAdult },
        ...tokens,
      });
    }),
  );

  router.post(
    '/auth/refresh',
    validateBody(z.object({ refreshToken: z.string().min(1) })),
    asyncHandler(async (req: Request, res: Response) => {
      const hash = sha256(req.body.refreshToken);
      const rec = refreshTokens.get(hash);
      if (!rec || rec.revoked || rec.expiresAt <= Date.now()) {
        throw new UnauthorizedError('Refresh token revoked or expired');
      }
      rec.revoked = true;
      const user = users.get(rec.userId);
      if (!user) throw new UnauthorizedError('User not found');
      res.status(200).json(issueTokens(user));
    }),
  );

  router.post(
    '/auth/logout',
    validateBody(z.object({ refreshToken: z.string().min(1) })),
    asyncHandler(async (req: Request, res: Response) => {
      const rec = refreshTokens.get(sha256(req.body.refreshToken));
      if (rec) rec.revoked = true;
      res.status(204).send();
    }),
  );

  // TRACKS & LEVELS
  router.get(
    '/tracks',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const pointsMap = getUserPointsMap(req.user!.userId);
      const out = tracks.map((t) => {
        const { unlocked, lockedReason } = evaluateTrackUnlock({
          prerequisites: t.prerequisites,
          userPointsByTrack: pointsMap,
        });
        return {
          id: t.id,
          slug: t.slug,
          title: t.title,
          levelCount: t.levelCount,
          order: t.order,
          isPlaceholder: t.isPlaceholder,
          unlocked,
          lockedReason,
          userPoints: pointsMap.get(t.id) ?? 0,
          maxPoints: Math.floor(t.levelCount / 10),
          units: units.filter((u) => u.trackId === t.id),
        };
      });
      res.status(200).json({ tracks: out });
    }),
  );

  router.get(
    '/tracks/:slug/levels',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const track = tracks.find((t) => t.slug === req.params.slug);
      if (!track) throw new NotFoundError(`Track "${req.params.slug}" not found`);
      const userId = req.user!.userId;
      const pointsMap = getUserPointsMap(userId);
      const { unlocked: trackUnlocked, lockedReason } = evaluateTrackUnlock({
        prerequisites: track.prerequisites,
        userPointsByTrack: pointsMap,
      });

      const passedNumbers = new Set<number>();
      for (const [k, v] of progress.entries()) {
        if (k.startsWith(`${userId}:`) && v.trackId === track.id) {
          passedNumbers.add(v.levelNumber);
        }
      }

      const trackUnits = units
        .filter((u) => u.trackId === track.id)
        .map((u) => ({
          ...u,
          levels: levels
            .filter((l) => l.unitId === u.id)
            .sort((a, b) => a.number - b.number)
            .map((l) => {
              const p = progress.get(`${userId}:${l.id}`);
              return {
                id: l.id,
                number: l.number,
                type: l.type,
                title: l.title,
                isCheckpoint: l.type === LevelType.CHECKPOINT,
                awardsPoint: l.number % 10 === 0,
                unlocked: isLevelUnlocked(l.number, trackUnlocked, passedNumbers),
                passed: Boolean(p),
                viaPlacement: p?.viaPlacement ?? false,
                bestScorePct: p?.bestScorePct ?? null,
              };
            }),
        }));

      res.status(200).json({
        track: {
          id: track.id,
          slug: track.slug,
          title: track.title,
          levelCount: track.levelCount,
          isPlaceholder: track.isPlaceholder,
          unlocked: trackUnlocked,
          lockedReason,
          userPoints: pointsMap.get(track.id) ?? 0,
          maxPoints: Math.floor(track.levelCount / 10),
        },
        units: trackUnits,
      });
    }),
  );

  // PLACEMENT TEST
  router.post(
    '/tracks/:slug/placement-test',
    requireAuth,
    validateBody(z.object({ targetUnitOrder: z.number().int().min(2) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const track = tracks.find((t) => t.slug === req.params.slug);
      if (!track) throw new NotFoundError('Track not found');
      const targetUnitOrder = req.body.targetUnitOrder as number;
      const earlierUnitIds = new Set(
        units.filter((u) => u.trackId === track.id && u.order < targetUnitOrder).map((u) => u.id),
      );
      const earlierLevelIds = new Set(
        levels.filter((l) => earlierUnitIds.has(l.unitId) && l.type === LevelType.LESSON).map((l) => l.id),
      );
      const pool = questions.filter(
        (q) =>
          q.status === QuestionStatus.APPROVED &&
          q.isLatest &&
          q.origin === QuestionOrigin.AUTHORED &&
          earlierLevelIds.has(q.levelId),
      );
      if (pool.length === 0) throw new BadRequestError('No approved questions for placement test');
      const selected = shuffleArray(pool).slice(0, Math.min(9, pool.length));
      const testId = crypto.randomUUID();
      placementTests.set(testId, {
        id: testId,
        userId: req.user!.userId,
        trackId: track.id,
        targetUnitOrder,
        questionIds: selected.map((q) => q.id),
        status: 'IN_PROGRESS',
      });
      res.status(201).json({
        placementTestId: testId,
        trackSlug: track.slug,
        targetUnitOrder,
        questions: selected.map(sanitizePublicQuestion),
      });
    }),
  );

  router.post(
    '/tracks/:slug/placement-test/:testId/submit',
    requireAuth,
    validateBody(z.object({ answers: z.array(z.object({ questionId: z.string(), answer: z.string() })) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const test = placementTests.get(req.params.testId);
      if (!test || test.userId !== req.user!.userId) throw new NotFoundError('Placement test not found');
      if (test.status !== 'IN_PROGRESS') throw new ConflictError('Placement test already submitted');
      const ansMap = new Map<string, string>(req.body.answers.map((a: { questionId: string; answer: string }) => [a.questionId, a.answer.trim()]));
      let correct = 0;
      for (const qId of test.questionIds) {
        const q = questions.find((item) => item.id === qId);
        if (q && ansMap.get(qId) === q.answer.trim()) correct++;
      }
      const scorePct = test.questionIds.length > 0 ? correct / test.questionIds.length : 0;
      const passed = scorePct >= 0.7;
      test.status = passed ? 'PASSED' : 'FAILED';

      const earlierLevels = levels.filter((l) => {
        const u = units.find((unit) => unit.id === l.unitId);
        return l.trackId === test.trackId && u && u.order < test.targetUnitOrder;
      });
      if (passed) {
        for (const lvl of earlierLevels) {
          const key = `${req.user!.userId}:${lvl.id}`;
          if (!progress.has(key)) {
            progress.set(key, {
              levelId: lvl.id,
              trackId: lvl.trackId,
              levelNumber: lvl.number,
              viaPlacement: true,
              bestScorePct: scorePct,
              passedAt: new Date(),
            });
          }
        }
      }
      res.status(200).json({
        placementTestId: test.id,
        passed,
        scorePct,
        correctCount: correct,
        totalQuestions: test.questionIds.length,
        skippedLevelsCount: passed ? earlierLevels.length : 0,
        xpAwarded: 0,
        pointsAwarded: 0,
      });
    }),
  );

  // ATTEMPTS
  router.post(
    '/levels/:id/attempts',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const level = levels.find((l) => l.id === req.params.id);
      if (!level) throw new NotFoundError('Level not found');
      const track = tracks.find((t) => t.id === level.trackId)!;
      const userId = req.user!.userId;
      const pointsMap = getUserPointsMap(userId);
      const { unlocked: trackUnlocked, lockedReason } = evaluateTrackUnlock({
        prerequisites: track.prerequisites,
        userPointsByTrack: pointsMap,
      });
      if (!trackUnlocked) throw new ForbiddenError(lockedReason ?? 'Track locked', 'TRACK_LOCKED');

      const passedNumbers = new Set<number>();
      for (const [k, v] of progress.entries()) {
        if (k.startsWith(`${userId}:`) && v.trackId === track.id) passedNumbers.add(v.levelNumber);
      }
      if (!isLevelUnlocked(level.number, trackUnlocked, passedNumbers)) {
        throw new ForbiddenError(`Level ${level.number} is locked until level ${level.number - 1} is passed`, 'LEVEL_LOCKED');
      }

      let selected: MemQuestion[] = [];
      if (level.type === LevelType.CHECKPOINT) {
        const earlierApproved = questions.filter((q) => {
          const ql = levels.find((l) => l.id === q.levelId);
          return q.status === QuestionStatus.APPROVED && q.isLatest && ql && ql.trackId === track.id && ql.type === LevelType.LESSON && ql.number < level.number;
        });
        const mapped = earlierApproved.map((q) => {
          const ql = levels.find((l) => l.id === q.levelId)!;
          return { ...q, levelNumber: ql.number, unitId: ql.unitId };
        });
        const revIds = new Set(
          Array.from(reviewQueue.values())
            .filter((r) => r.userId === userId)
            .map((r) => r.questionId),
        );
        const checkpointPool = selectCheckpointQuestions({
          authoredPool: mapped.filter((q) => q.origin === QuestionOrigin.AUTHORED),
          webPool: mapped.filter((q) => q.origin === QuestionOrigin.WEB),
          reviewQueueQuestionIds: revIds,
        });
        const sumUpLimit = level.number % 10 === 0 ? 7 : 5;
        selected = checkpointPool.slice(0, Math.min(sumUpLimit, checkpointPool.length));
      } else {
        const lvlQs = questions.filter(
          (q) => q.levelId === level.id && q.status === QuestionStatus.APPROVED && q.isLatest,
        );
        const now = new Date();
        const dueQs = Array.from(reviewQueue.values())
          .filter((r) => r.userId === userId && r.nextReviewAt <= now)
          .map((r) => questions.find((q) => q.id === r.questionId))
          .filter((q): q is MemQuestion => Boolean(q && q.status === QuestionStatus.APPROVED && q.isLatest))
          .filter((q) => !lvlQs.some((lq) => lq.id === q.id))
          .slice(0, GAME_CONSTANTS.MAX_DUE_REVIEW_IN_LESSON);
        selected = shuffleArray([...lvlQs, ...dueQs]);
      }

      if (selected.length === 0) throw new BadRequestError('No approved questions available for this level');

      const attempt: MemAttempt = {
        id: crypto.randomUUID(),
        userId,
        levelId: level.id,
        trackId: level.trackId,
        type: level.type,
        status: AttemptStatus.IN_PROGRESS,
        heartsRemaining: GAME_CONSTANTS.INITIAL_HEARTS,
        xpEarned: 0,
        questionIds: selected.map((q) => q.id),
        answeredIds: new Set(),
        correctCount: 0,
        answeredCount: 0,
      };
      attempts.set(attempt.id, attempt);

      res.status(201).json({
        attemptId: attempt.id,
        levelId: level.id,
        levelNumber: level.number,
        levelType: level.type,
        heartsRemaining: attempt.heartsRemaining,
        totalQuestions: selected.length,
        passMark: getPassMarkForLevelType(level.type),
        questions: selected.map(sanitizePublicQuestion),
      });
    }),
  );

  router.post(
    '/attempts/:id/answers',
    requireAuth,
    validateBody(z.object({ questionId: z.string().min(1), answer: z.string().min(1) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attempt = attempts.get(req.params.id);
      const userId = req.user!.userId;
      if (!attempt || attempt.userId !== userId) throw new NotFoundError('Attempt not found');
      if (attempt.status !== AttemptStatus.IN_PROGRESS) throw new ConflictError(`Attempt is already ${attempt.status}`);
      if (!attempt.questionIds.includes(req.body.questionId)) throw new BadRequestError('Question not in attempt');
      if (attempt.answeredIds.has(req.body.questionId)) throw new ConflictError('Question already answered');

      const q = questions.find((item) => item.id === req.body.questionId && item.status === QuestionStatus.APPROVED);
      if (!q) throw new NotFoundError('Approved question not found');

      const isCorrect = req.body.answer.trim() === q.answer.trim();
      attempt.answeredIds.add(q.id);
      attempt.answeredCount++;
      if (isCorrect) {
        attempt.correctCount++;
        attempt.xpEarned += GAME_CONSTANTS.XP_PER_CORRECT;
        const user = users.get(userId);
        if (user) user.xp += GAME_CONSTANTS.XP_PER_CORRECT;
      } else {
        attempt.heartsRemaining = Math.max(0, attempt.heartsRemaining - 1);
      }

      if (attempt.heartsRemaining === 0) {
        attempt.status = AttemptStatus.FAILED;
      }

      userAnsweredQuestions.add(`${userId}:${q.id}`);

      const now = new Date();
      const rqKey = `${userId}:${q.id}`;
      const existingRq = reviewQueue.get(rqKey) ?? null;
      const transition = computeReviewQueueTransition({
        isCorrect,
        existing: existingRq,
        now,
      });
      if (transition.action === 'UPSERT_WRONG') {
        reviewQueue.set(rqKey, {
          id: existingRq?.id ?? crypto.randomUUID(),
          userId,
          questionId: q.id,
          wrongCount: (existingRq?.wrongCount ?? 0) + 1,
          consecutiveCorrect: 0,
          intervalStage: 0,
          nextReviewAt: transition.nextReviewAt,
          lastReviewedAt: now,
        });
      } else if (transition.action === 'REMOVE') {
        reviewQueue.delete(rqKey);
      } else if (transition.action === 'ADVANCE' && existingRq) {
        existingRq.consecutiveCorrect = transition.consecutiveCorrect;
        existingRq.intervalStage = transition.intervalStage;
        existingRq.nextReviewAt = transition.nextReviewAt;
        existingRq.lastReviewedAt = now;
      }

      res.status(200).json({
        attemptId: attempt.id,
        questionId: q.id,
        isCorrect,
        correctAnswer: q.answer,
        explanation: q.explanation,
        heartsRemaining: attempt.heartsRemaining,
        xpDelta: isCorrect ? GAME_CONSTANTS.XP_PER_CORRECT : 0,
        attemptXpEarned: attempt.xpEarned,
        attemptStatus: attempt.status,
        answeredCount: attempt.answeredCount,
        totalQuestions: attempt.questionIds.length,
      });
    }),
  );

  router.post(
    '/attempts/:id/finish',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attempt = attempts.get(req.params.id);
      const userId = req.user!.userId;
      if (!attempt || attempt.userId !== userId) throw new NotFoundError('Attempt not found');
      if (attempt.status !== AttemptStatus.IN_PROGRESS) throw new ConflictError(`Attempt is already ${attempt.status}`);

      const user = users.get(userId)!;
      const level = levels.find((l) => l.id === attempt.levelId)!;
      const track = tracks.find((t) => t.id === attempt.trackId)!;
      const scorePct = attempt.questionIds.length > 0 ? attempt.correctCount / attempt.questionIds.length : 0;
      const passMark = getPassMarkForLevelType(attempt.type);
      const passed = attempt.heartsRemaining > 0 && scorePct >= passMark;
      attempt.status = passed ? AttemptStatus.PASSED : AttemptStatus.FAILED;

      const completionXp = passed ? getCompletionXpForLevelType(attempt.type) : 0;
      let pointAwarded = false;
      let streakRes = {
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        incremented: false,
      };

      if (passed) {
        attempt.xpEarned += completionXp;
        user.xp += completionXp;
        const pKey = `${userId}:${level.id}`;
        const prev = progress.get(pKey);
        progress.set(pKey, {
          levelId: level.id,
          trackId: level.trackId,
          levelNumber: level.number,
          viaPlacement: false,
          bestScorePct: Math.max(prev?.bestScorePct ?? 0, scorePct),
          passedAt: new Date(),
        });

        const updatedStreak = calculateStreakUpdate({
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          lastStreakDate: user.lastStreakDate,
          timezone: user.timezone,
          now: new Date(),
        });
        user.currentStreak = updatedStreak.currentStreak;
        user.longestStreak = updatedStreak.longestStreak;
        user.lastStreakDate = updatedStreak.lastStreakDate;
        streakRes = updatedStreak;

        if (
          level.number % 10 === 0 &&
          !pointEvents.some(
            (e) => e.userId === userId && e.trackId === track.id && e.levelNumber === level.number,
          )
        ) {
          pointEvents.push({
            id: crypto.randomUUID(),
            userId,
            trackId: track.id,
            trackSlug: track.slug,
            levelNumber: level.number,
            points: 1,
            createdAt: new Date(),
          });
          pointAwarded = true;
        }
      }

      res.status(200).json({
        attemptId: attempt.id,
        status: attempt.status,
        passed,
        scorePct,
        passMark,
        heartsRemaining: attempt.heartsRemaining,
        completionXpAwarded: completionXp,
        totalAttemptXp: attempt.xpEarned,
        pointAwarded,
        streak: {
          current: streakRes.currentStreak,
          longest: streakRes.longestStreak,
          incrementedToday: streakRes.incremented,
        },
      });
    }),
  );

  // /ME
  router.get(
    '/me/stats',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = users.get(req.user!.userId);
      if (!user) throw new NotFoundError('User not found');
      const totalPoints = pointEvents
        .filter((e) => e.userId === user.id)
        .reduce((s, e) => s + e.points, 0);
      const passedLevelsCount = Array.from(progress.keys()).filter((k) =>
        k.startsWith(`${user.id}:`),
      ).length;
      res.status(200).json({
        userId: user.id,
        xp: user.xp,
        currentStreak: getEffectiveStreak({
          currentStreak: user.currentStreak,
          lastStreakDate: user.lastStreakDate,
          timezone: user.timezone,
          now: new Date(),
        }),
        longestStreak: user.longestStreak,
        lastStreakDate: user.lastStreakDate,
        timezone: user.timezone,
        totalPoints,
        passedLevelsCount,
      });
    }),
  );

  router.get(
    '/me/points',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userEvents = pointEvents.filter((e) => e.userId === req.user!.userId);
      const byTrackMap = getUserPointsMap(req.user!.userId);
      res.status(200).json({
        totalPoints: userEvents.reduce((s, e) => s + e.points, 0),
        byTrack: tracks.map((t) => ({
          trackId: t.id,
          slug: t.slug,
          title: t.title,
          userPoints: byTrackMap.get(t.id) ?? 0,
          maxPoints: Math.floor(t.levelCount / 10),
        })),
        events: userEvents,
      });
    }),
  );

  router.get(
    '/me/review-queue',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const items = Array.from(reviewQueue.values())
        .filter((r) => r.userId === req.user!.userId)
        .map((r) => {
          const q = questions.find((item) => item.id === r.questionId);
          return {
            ...r,
            isDue: r.nextReviewAt <= now,
            question: q ? { id: q.id, levelId: q.levelId, type: q.type, prompt: q.prompt } : null,
          };
        });
      res.status(200).json({ items });
    }),
  );

  // COMMITMENTS
  router.post(
    '/commitments',
    requireAuth,
    validateBody(
      z.object({
        trackId: z.string().min(1),
        durationDays: z.number().int().min(1).max(365),
        timezone: z.string().optional(),
        mode: z.nativeEnum(CommitmentMode),
        missedDayMode: z.nativeEnum(MissedDayMode),
        dailyPenaltyCents: z.number().int().min(0).default(100),
        finalFailPenaltyCents: z.number().int().min(0),
        depositCents: z.number().int().positive().optional(),
        maxTotalPenaltyCents: z.number().int().min(0),
        excusedDaysAllowed: z.number().int().min(0).default(2),
        currency: z.string().length(3).default('usd'),
        termsVersion: z.string().min(1),
        acknowledgePace: z.boolean().optional().default(false),
      }),
    ),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = users.get(req.user!.userId);
      if (!user) throw new NotFoundError('User not found');
      if (!user.isAdult) throw new ForbiddenError('Only adult users (isAdult = true) can create commitment contracts', 'ADULT_REQUIRED');
      const track = tracks.find((t) => t.id === req.body.trackId);
      if (!track) throw new NotFoundError('Track not found');
      if (req.body.mode !== CommitmentMode.SIMULATED && !env.STRIPE_SECRET_KEY) {
        throw new BadRequestError('Stripe is not configured in sandbox; use SIMULATED mode or set STRIPE_SECRET_KEY', 'STRIPE_NOT_CONFIGURED');
      }

      const passedCount = Array.from(progress.entries()).filter(
        ([k, v]) => k.startsWith(`${user.id}:`) && v.trackId === track.id,
      ).length;
      const remainingLevels = Math.max(0, track.levelCount - passedCount);
      const { requiredLevelsPerDay, exceedsRecommendedPace } = evaluatePaceRequirement({
        remainingLevels,
        durationDays: req.body.durationDays,
        maxLevelsPerDay: env.MAX_LEVELS_PER_DAY,
        acknowledgePace: Boolean(req.body.acknowledgePace),
      });

      const c: MemCommitment = {
        id: crypto.randomUUID(),
        userId: user.id,
        trackId: track.id,
        startDate: new Date(),
        durationDays: req.body.durationDays,
        timezone: req.body.timezone ?? user.timezone,
        mode: req.body.mode,
        missedDayMode: req.body.missedDayMode,
        dailyPenaltyCents: req.body.dailyPenaltyCents,
        finalFailPenaltyCents: req.body.finalFailPenaltyCents,
        depositCents: req.body.depositCents ?? null,
        maxTotalPenaltyCents: req.body.maxTotalPenaltyCents,
        excusedDaysAllowed: req.body.excusedDaysAllowed,
        currency: req.body.currency.toLowerCase(),
        status: CommitmentStatus.ACTIVE,
        termsVersion: req.body.termsVersion,
        termsAcceptedAt: new Date(),
        requiredLevelsPerDay,
        hasActiveAppeal: false,
        finalPassedAt: null,
        penalties: [],
        finalSubmissions: [],
        appeals: [],
      };
      commitments.set(c.id, c);
      res.status(201).json({
        commitment: c,
        requiredLevelsPerDay,
        exceedsRecommendedPace,
        remainingLevels,
        stripeCheckoutUrl: null,
      });
    }),
  );

  router.get(
    '/commitments',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const list = Array.from(commitments.values())
        .filter((c) => c.userId === req.user!.userId)
        .map((c) => ({
          ...c,
          track: tracks.find((t) => t.id === c.trackId),
        }));
      res.status(200).json({ commitments: list });
    }),
  );

  router.get(
    '/commitments/:id',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const c = commitments.get(req.params.id);
      if (!c || c.userId !== req.user!.userId) throw new NotFoundError('Commitment not found');
      const activeCents = c.penalties.filter((p) => p.voidedAt === null).reduce((s, p) => s + p.amountCents, 0);
      res.status(200).json({
        ...c,
        track: tracks.find((t) => t.id === c.trackId),
        totalActivePenaltyCents: Math.min(c.maxTotalPenaltyCents, activeCents),
      });
    }),
  );

  router.post(
    '/commitments/:id/final-exam/start',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const c = commitments.get(req.params.id);
      if (!c || c.userId !== req.user!.userId) throw new NotFoundError('Commitment not found');
      const examCount = c.finalSubmissions.filter((s) => s.type === FinalSubmissionType.EXAM).length;
      if (examCount >= MAX_FINAL_EXAM_ATTEMPTS) {
        throw new ForbiddenError(`Maximum of ${MAX_FINAL_EXAM_ATTEMPTS} final exam attempts reached`);
      }
      const trackLevelIds = new Set(levels.filter((l) => l.trackId === c.trackId).map((l) => l.id));
      const pool = questions.filter((q) => q.status === QuestionStatus.APPROVED && q.isLatest && trackLevelIds.has(q.levelId));
      const selected = shuffleArray(pool).slice(0, Math.min(10, pool.length));
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + env.FINAL_EXAM_TIME_LIMIT_MINUTES * 60_000);
      const subId = crypto.randomUUID();
      c.finalSubmissions.push({
        id: subId,
        commitmentId: c.id,
        userId: c.userId,
        type: FinalSubmissionType.EXAM,
        status: FinalSubmissionStatus.SUBMITTED,
        attemptNumber: examCount + 1,
        questionIds: selected.map((q) => q.id),
        startedAt,
        expiresAt,
      });
      res.status(201).json({
        submissionId: subId,
        attemptNumber: examCount + 1,
        startedAt,
        expiresAt,
        timeLimitMinutes: env.FINAL_EXAM_TIME_LIMIT_MINUTES,
        passMark: FINAL_EXAM_PASS_MARK,
        questions: selected.map(sanitizePublicQuestion),
      });
    }),
  );

  router.post(
    '/commitments/:id/final-submission',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const c = commitments.get(req.params.id);
      if (!c || c.userId !== req.user!.userId) throw new NotFoundError('Commitment not found');
      const now = new Date();
      if (req.body.type === 'PROJECT') {
        const sub = {
          id: crypto.randomUUID(),
          commitmentId: c.id,
          userId: c.userId,
          type: FinalSubmissionType.PROJECT,
          status: FinalSubmissionStatus.SUBMITTED,
          attemptNumber: 1,
          submittedAt: now,
          projectUrl: req.body.projectUrl,
          projectNotes: req.body.projectNotes,
        };
        c.finalSubmissions.push(sub);
        res.status(201).json(sub);
        return;
      }
      const sub = c.finalSubmissions.find((s) => s.id === req.body.submissionId);
      if (!sub) throw new NotFoundError('Submission not found');
      const expected = sub.questionIds ?? [];
      const ansMap = new Map<string, string>(
        (req.body.answers as Array<{ questionId: string; answer: string }>).map((a) => [a.questionId, a.answer.trim()]),
      );
      let correct = 0;
      for (const qId of expected) {
        const q = questions.find((item) => item.id === qId);
        if (q && ansMap.get(qId) === q.answer.trim()) correct++;
      }
      const scorePct = expected.length > 0 ? correct / expected.length : 0;
      const passed = scorePct >= FINAL_EXAM_PASS_MARK;
      sub.scorePct = scorePct;
      sub.submittedAt = now;
      sub.status = passed ? FinalSubmissionStatus.APPROVED : FinalSubmissionStatus.REJECTED;
      if (passed && !c.finalPassedAt) c.finalPassedAt = now;
      res.status(201).json({ ...sub, passed, correctCount: correct, totalQuestions: expected.length });
    }),
  );

  router.post(
    '/commitments/:id/appeal',
    requireAuth,
    validateBody(z.object({ finalSubmissionId: z.string().optional(), reason: z.string().min(5) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const c = commitments.get(req.params.id);
      if (!c || c.userId !== req.user!.userId) throw new NotFoundError('Commitment not found');
      c.hasActiveAppeal = true;
      const appeal = {
        id: crypto.randomUUID(),
        commitmentId: c.id,
        userId: c.userId,
        finalSubmissionId: req.body.finalSubmissionId ?? null,
        reason: req.body.reason,
        status: 'PENDING' as const,
        adminDecisionNotes: null,
        createdAt: new Date(),
      };
      c.appeals.push(appeal);
      res.status(201).json(appeal);
    }),
  );

  // VOICE GATING
  router.get(
    '/questions/:id/audio',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const q = questions.find((item) => item.id === req.params.id && item.status === QuestionStatus.APPROVED);
      if (!q) throw new NotFoundError('Approved question not found');
      res.status(200).json({
        questionId: q.id,
        contentType: 'QUESTION_PROMPT',
        language: env.TTS_DEFAULT_LANGUAGE,
        voiceId: env.TTS_DEFAULT_VOICE_ID,
        status: env.HF_ENDPOINT_URL ? 'READY' : 'PENDING',
        audioUrl: null,
        transcript: buildQuestionPromptTranscript(q),
      });
    }),
  );

  router.get(
    '/questions/:id/explanation-audio',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const q = questions.find((item) => item.id === req.params.id && item.status === QuestionStatus.APPROVED);
      if (!q) throw new NotFoundError('Approved question not found');
      if (!userAnsweredQuestions.has(`${req.user!.userId}:${q.id}`)) {
        throw new ForbiddenError('Explanation audio is locked until you submit an answer to this question', 'EXPLANATION_AUDIO_LOCKED');
      }
      res.status(200).json({
        questionId: q.id,
        contentType: 'EXPLANATION',
        language: env.TTS_DEFAULT_LANGUAGE,
        voiceId: env.TTS_DEFAULT_VOICE_ID,
        status: env.HF_ENDPOINT_URL ? 'READY' : 'PENDING',
        audioUrl: null,
        transcript: buildExplanationTranscript(q),
      });
    }),
  );

  // ADMIN
  router.get(
    '/admin/questions',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const status = req.query.status as QuestionStatus | undefined;
      const list = questions
        .filter((q) => q.isLatest && (!status || q.status === status))
        .map((q) => ({
          ...q,
          level: levels.find((l) => l.id === q.levelId),
        }));
      res.status(200).json({ questions: list });
    }),
  );

  router.post(
    '/admin/questions',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      validateQuestionContentRules(req.body);
      const q: MemQuestion = {
        id: crypto.randomUUID(),
        levelId: req.body.levelId,
        questionGroupId: crypto.randomUUID(),
        type: req.body.type,
        prompt: req.body.prompt,
        codeSnippet: req.body.codeSnippet ?? null,
        spokenText: req.body.spokenText ?? null,
        options: req.body.options ?? null,
        answer: req.body.answer,
        explanation: req.body.explanation,
        origin: req.body.origin ?? QuestionOrigin.AUTHORED,
        sourceUrl: req.body.sourceUrl ?? null,
        license: req.body.license ?? null,
        status: req.body.origin === QuestionOrigin.WEB ? QuestionStatus.DRAFT : (req.body.status ?? QuestionStatus.DRAFT),
        rejectionReason: null,
        version: 1,
        isLatest: true,
        createdAt: new Date(),
      };
      questions.unshift(q);
      auditLogs.unshift({
        id: crypto.randomUUID(),
        actorUserId: req.user!.userId,
        actorEmail: req.user!.email,
        entityType: 'Question',
        entityId: q.id,
        action: 'CREATE',
        reason: null,
        changes: { status: q.status, origin: q.origin },
        createdAt: new Date(),
      });
      res.status(201).json(q);
    }),
  );

  router.post(
    '/admin/questions/:id/review',
    requireAuth,
    requireAdmin,
    validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().min(1) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const q = questions.find((item) => item.id === req.params.id);
      if (!q) throw new NotFoundError('Question not found');
      const prev = q.status;
      q.status = req.body.decision === 'APPROVED' ? QuestionStatus.APPROVED : QuestionStatus.REJECTED;
      q.rejectionReason = q.status === QuestionStatus.REJECTED ? req.body.reason : null;
      auditLogs.unshift({
        id: crypto.randomUUID(),
        actorUserId: req.user!.userId,
        actorEmail: req.user!.email,
        entityType: 'Question',
        entityId: q.id,
        action: q.status === QuestionStatus.APPROVED ? 'APPROVE' : 'REJECT',
        reason: req.body.reason,
        changes: { fromStatus: prev, toStatus: q.status },
        createdAt: new Date(),
      });
      res.status(200).json(q);
    }),
  );

  router.get(
    '/admin/audit-logs',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({ logs: auditLogs.slice(0, 100) });
    }),
  );

  router.get(
    '/admin/final-submissions',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const all = Array.from(commitments.values()).flatMap((c) =>
        c.finalSubmissions.map((s) => ({
          ...s,
          commitment: { id: c.id, status: c.status, mode: c.mode },
          user: users.get(c.userId),
        })),
      );
      res.status(200).json({ submissions: all });
    }),
  );

  router.post(
    '/admin/final-submissions/:id/review',
    requireAuth,
    requireAdmin,
    validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reviewNotes: z.string().min(1) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      for (const c of commitments.values()) {
        const sub = c.finalSubmissions.find((s) => s.id === req.params.id);
        if (sub) {
          sub.status = req.body.decision === 'APPROVED' ? FinalSubmissionStatus.APPROVED : FinalSubmissionStatus.REJECTED;
          sub.reviewNotes = req.body.reviewNotes;
          if (sub.status === FinalSubmissionStatus.APPROVED && !c.finalPassedAt) {
            c.finalPassedAt = new Date();
          }
          res.status(200).json(sub);
          return;
        }
      }
      throw new NotFoundError('Final submission not found');
    }),
  );

  // ==========================================
  // 13. DAILY QUIZ: "ARISTOTLE" (Sandbox MVP)
  // ==========================================
  const dailyQuizzes = new Map<string, MemDailyQuiz>();
  const dailyQuestions: MemDailyQuestion[] = [];
  const dailyAttempts = new Map<string, MemDailyAttempt>(); // `${userId}:${quizDate}`
  const leaderboardEntries = new Map<
    string,
    { userId: string; period: LeaderboardPeriod; periodKey: string; score: number; timeMs: number; country: string | null; updatedAt: Date }
  >();
  const adminAlerts: Array<{ id: string; type: string; message: string; quizDate: string | null; resolvedAt: Date | null; createdAt: Date }> = [];
  const aristotleTemplates = new Map<AristotleTemplateKey, { id: string; key: AristotleTemplateKey; title: string; body: string; language: string; voiceId: string; updatedAt: Date }>([
    [
      AristotleTemplateKey.INTRO,
      {
        id: 'tpl-intro',
        key: AristotleTemplateKey.INTRO,
        title: 'Aristotle Daily Intro',
        body: 'Greetings, scholar. Today is {{quizDate}}. Seven sharp questions await you, each within {{timeLimitSeconds}} seconds.',
        language: 'en',
        voiceId: 'aristotle',
        updatedAt: new Date(),
      },
    ],
    [
      AristotleTemplateKey.FEEDBACK_CORRECT,
      {
        id: 'tpl-correct',
        key: AristotleTemplateKey.FEEDBACK_CORRECT,
        title: 'Aristotle Correct Feedback',
        body: 'Well reasoned on question {{position}}! You earned {{score}} points. {{explanation}}',
        language: 'en',
        voiceId: 'aristotle',
        updatedAt: new Date(),
      },
    ],
    [
      AristotleTemplateKey.FEEDBACK_INCORRECT,
      {
        id: 'tpl-incorrect',
        key: AristotleTemplateKey.FEEDBACK_INCORRECT,
        title: 'Aristotle Incorrect Feedback',
        body: 'Not quite on question {{position}} — you scored {{score}} points. {{explanation}}',
        language: 'en',
        voiceId: 'aristotle',
        updatedAt: new Date(),
      },
    ],
    [
      AristotleTemplateKey.FEEDBACK_TIMEOUT,
      {
        id: 'tpl-timeout',
        key: AristotleTemplateKey.FEEDBACK_TIMEOUT,
        title: 'Aristotle Timeout Feedback',
        body: 'Time expired on question {{position}}, so 0 points are recorded. {{explanation}}',
        language: 'en',
        voiceId: 'aristotle',
        updatedAt: new Date(),
      },
    ],
    [
      AristotleTemplateKey.RESULT_SUMMARY,
      {
        id: 'tpl-summary',
        key: AristotleTemplateKey.RESULT_SUMMARY,
        title: 'Aristotle Result Summary',
        body: 'Wisdom grows through reflection. For {{quizDate}}, your total score is {{totalScore}} across {{totalTimeMs}} ms.',
        language: 'en',
        voiceId: 'aristotle',
        updatedAt: new Date(),
      },
    ],
  ]);

  // Seed realistic daily quiz questions for today + next 7 days + 21 reserve + 1 AI DRAFT
  const todaySeedDate = formatDateInTimezone(new Date(), env.DAILY_TZ);
  const seedDailyCatalog: Array<{
    type: DailyQuestionType;
    prompt: string;
    codeSnippet: string | null;
    options: string[] | null;
    correctAnswer: string;
    numericAnswer: number | null;
    scale: number | null;
    explanation: string;
    sourceUrl: string;
  }> = [
    {
      type: DailyQuestionType.ESTIMATE,
      prompt: 'In what year was the first C programming language edition of K&R published?',
      codeSnippet: null,
      options: null,
      correctAnswer: '1978',
      numericAnswer: 1978,
      scale: 20,
      explanation: 'Kernighan and Ritchie published The C Programming Language (1st edition) in 1978.',
      sourceUrl: 'https://en.wikipedia.org/wiki/The_C_Programming_Language',
    },
    {
      type: DailyQuestionType.MULTIPLE_CHOICE,
      prompt: 'What does this JavaScript expression print to the console?',
      codeSnippet: 'console.log([1, 2, 3].map((x) => x * 2).reduce((a, b) => a + b, 0));',
      options: ['6', '12', '10', '24'],
      correctAnswer: '1',
      numericAnswer: null,
      scale: null,
      explanation: 'Mapping doubles values to [2, 4, 6], whose sum is 12.',
      sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce',
    },
    {
      type: DailyQuestionType.ESTIMATE,
      prompt: 'Approximately how many Unicode code points exist in total across planes 0 to 16?',
      codeSnippet: null,
      options: null,
      correctAnswer: '1114112',
      numericAnswer: 1114112,
      scale: 250000,
      explanation: 'Unicode defines 17 planes of 65,536 code points each: 17 * 65,536 = 1,114,112.',
      sourceUrl: 'https://www.unicode.org/versions/Unicode15.0.0/',
    },
    {
      type: DailyQuestionType.MULTIPLE_CHOICE,
      prompt: 'What is the worst-case time complexity of binary search on a sorted array of n items?',
      codeSnippet: null,
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctAnswer: '1',
      numericAnswer: null,
      scale: null,
      explanation: 'Each comparison halves the remaining search interval, giving O(log n).',
      sourceUrl: 'https://en.wikipedia.org/wiki/Binary_search',
    },
    {
      type: DailyQuestionType.ESTIMATE,
      prompt: 'What is the maximum number of usable host IPv4 addresses in a /24 subnet?',
      codeSnippet: null,
      options: null,
      correctAnswer: '254',
      numericAnswer: 254,
      scale: 40,
      explanation: 'A /24 subnet has 256 addresses minus network and broadcast addresses = 254.',
      sourceUrl: 'https://datatracker.ietf.org/doc/html/rfc4632',
    },
    {
      type: DailyQuestionType.MULTIPLE_CHOICE,
      prompt: 'Which HTTP status code indicates the server is refusing access despite authentication?',
      codeSnippet: null,
      options: ['401 Unauthorized', '403 Forbidden', '404 Not Found', '409 Conflict'],
      correctAnswer: '1',
      numericAnswer: null,
      scale: null,
      explanation: '403 Forbidden means credentials were understood but lack sufficient permissions.',
      sourceUrl: 'https://www.rfc-editor.org/rfc/rfc9110#name-403-forbidden',
    },
    {
      type: DailyQuestionType.MULTIPLE_CHOICE,
      prompt: 'What does this JS code print?',
      codeSnippet: 'const a = [10, 20, 30];\nconsole.log(a.slice(1).join("-"));',
      options: ['10-20', '20-30', '10-20-30', '30'],
      correctAnswer: '1',
      numericAnswer: null,
      scale: null,
      explanation: 'slice(1) takes elements from index 1 onward ([20, 30]) and join("-") outputs "20-30".',
      sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice',
    },
  ];

  for (let dayOffset = 0; dayOffset <= env.DAILY_BUFFER_DAYS; dayOffset++) {
    const qDate = addDaysToDateString(todaySeedDate, dayOffset);
    const quizId = `dq-quiz-${qDate}`;
    const isLive = dayOffset === 0;
    dailyQuizzes.set(qDate, {
      id: quizId,
      quizDate: qDate,
      status: isLive ? DailyQuizStatus.LIVE : DailyQuizStatus.BUFFERED,
      publishedAt: isLive ? new Date() : null,
      closedAt: null,
      usedReserveFallback: false,
    });
    for (let pos = 1; pos <= 7; pos++) {
      const tpl = seedDailyCatalog[(pos - 1) % seedDailyCatalog.length];
      const prompt =
        dayOffset === 0
          ? tpl.prompt
          : `[${qDate}] ${tpl.prompt}`;
      dailyQuestions.push({
        id: `dq-q-${qDate}-${pos}`,
        dailyQuizId: quizId,
        position: pos,
        type: tpl.type,
        prompt,
        codeSnippet: tpl.codeSnippet,
        spokenText: prompt,
        options: tpl.options,
        correctAnswer: tpl.correctAnswer,
        numericAnswer: tpl.numericAnswer,
        scale: tpl.scale,
        explanation: tpl.explanation,
        sourceUrl: tpl.sourceUrl,
        license: 'CC-BY-SA-4.0',
        status: DailyQuestionStatus.APPROVED,
        rejectionReason: null,
        generatedBy: DailyQuestionOrigin.HUMAN,
        fingerprint: computePromptFingerprint(prompt),
        lastUsedDate: qDate,
        isReserve: false,
        createdAt: new Date(),
      });
    }
  }

  for (let r = 1; r <= 21; r++) {
    const prompt = `Reserve CS Challenge #${r}: Estimate 2^${(r % 12) + 4}`;
    const val = 2 ** ((r % 12) + 4);
    dailyQuestions.push({
      id: `dq-res-${r}`,
      dailyQuizId: null,
      position: null,
      type: DailyQuestionType.ESTIMATE,
      prompt,
      codeSnippet: null,
      spokenText: prompt,
      options: null,
      correctAnswer: String(val),
      numericAnswer: val,
      scale: Math.max(10, Math.round(val * 0.25)),
      explanation: `2 raised to ${(r % 12) + 4} equals ${val}.`,
      sourceUrl: 'https://en.wikipedia.org/wiki/Power_of_two',
      license: 'CC-BY-SA-4.0',
      status: DailyQuestionStatus.APPROVED,
      rejectionReason: null,
      generatedBy: DailyQuestionOrigin.HUMAN,
      fingerprint: computePromptFingerprint(prompt),
      lastUsedDate: null,
      isReserve: true,
      createdAt: new Date(),
    });
  }

  // 1 AI-generated DRAFT candidate in Admin Review Queue
  const draftAiPrompt = 'Approximately how many RFCs had the IETF published by 2024?';
  dailyQuestions.push({
    id: 'dq-ai-draft-1',
    dailyQuizId: null,
    position: null,
    type: DailyQuestionType.ESTIMATE,
    prompt: draftAiPrompt,
    codeSnippet: null,
    spokenText: draftAiPrompt,
    options: null,
    correctAnswer: '9500',
    numericAnswer: 9500,
    scale: 1500,
    explanation: 'By 2024 the IETF RFC series exceeded roughly 9,500 documents.',
    sourceUrl: 'https://www.rfc-editor.org/rfc-index.html',
    license: 'IETF-Trust',
    status: DailyQuestionStatus.DRAFT,
    rejectionReason: null,
    generatedBy: DailyQuestionOrigin.AI,
    fingerprint: computePromptFingerprint(draftAiPrompt),
    lastUsedDate: null,
    isReserve: true,
    createdAt: new Date(),
  });

  // Seed initial leaderboard rows for today + week + all-time
  const todayWeekKey = getIsoWeekKey(todaySeedDate);
  for (const seedLb of [
    { userId: 'user-rival-1', score: 6250, timeMs: 38400, country: 'GB' },
    { userId: 'user-rival-2', score: 5800, timeMs: 41200, country: 'US' },
  ]) {
    leaderboardEntries.set(`${seedLb.userId}:DAILY:${todaySeedDate}`, {
      ...seedLb,
      period: LeaderboardPeriod.DAILY,
      periodKey: todaySeedDate,
      updatedAt: new Date(),
    });
    leaderboardEntries.set(`${seedLb.userId}:WEEKLY:${todayWeekKey}`, {
      ...seedLb,
      period: LeaderboardPeriod.WEEKLY,
      periodKey: todayWeekKey,
      updatedAt: new Date(),
    });
    leaderboardEntries.set(`${seedLb.userId}:ALL_TIME:ALL`, {
      ...seedLb,
      period: LeaderboardPeriod.ALL_TIME,
      periodKey: 'ALL',
      updatedAt: new Date(),
    });
  }

  function ensureSandboxLiveQuiz(quizDate: string, now: Date) {
    let quiz = dailyQuizzes.get(quizDate);
    let qList = dailyQuestions
      .filter((q) => q.dailyQuizId === quiz?.id && q.status === DailyQuestionStatus.APPROVED)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

    if (quiz?.status === DailyQuizStatus.LIVE && qList.length === DAILY_QUIZ_QUESTION_COUNT) {
      return { quiz, approvedQuestions: qList, usedReserveFallback: quiz.usedReserveFallback };
    }
    if (quiz && quiz.status !== DailyQuizStatus.CLOSED && qList.length === DAILY_QUIZ_QUESTION_COUNT) {
      quiz.status = DailyQuizStatus.LIVE;
      quiz.publishedAt = now;
      return { quiz, approvedQuestions: qList, usedReserveFallback: false };
    }

    const cutoff = addDaysToDateString(quizDate, -FINGERPRINT_WINDOW_DAYS);
    const needed = DAILY_QUIZ_QUESTION_COUNT - qList.length;
    const reserve = dailyQuestions.filter(
      (q) =>
        q.status === DailyQuestionStatus.APPROVED &&
        q.dailyQuizId === null &&
        (!q.lastUsedDate || q.lastUsedDate <= cutoff),
    );
    if (reserve.length < needed) {
      if (!adminAlerts.some((a) => !a.resolvedAt && a.type === 'INSUFFICIENT_RESERVE_QUESTIONS' && a.quizDate === quizDate)) {
        adminAlerts.unshift({
          id: crypto.randomUUID(),
          type: 'INSUFFICIENT_RESERVE_QUESTIONS',
          message: `Reserve pool has only ${reserve.length}/${needed} approved questions for ${quizDate}.`,
          quizDate,
          resolvedAt: null,
          createdAt: now,
        });
      }
      return { quiz: quiz ?? null, approvedQuestions: qList, usedReserveFallback: false };
    }

    if (!quiz) {
      quiz = {
        id: `dq-quiz-${quizDate}`,
        quizDate,
        status: DailyQuizStatus.LIVE,
        publishedAt: now,
        closedAt: null,
        usedReserveFallback: true,
      };
      dailyQuizzes.set(quizDate, quiz);
    } else {
      quiz.status = DailyQuizStatus.LIVE;
      quiz.publishedAt = now;
      quiz.usedReserveFallback = true;
    }

    const usedPositions = new Set(qList.map((q) => q.position).filter((p): p is number => p !== null));
    const openPositions: number[] = [];
    for (let p = 1; p <= DAILY_QUIZ_QUESTION_COUNT; p++) {
      if (!usedPositions.has(p)) openPositions.push(p);
    }
    for (let i = 0; i < needed; i++) {
      const rq = reserve[i];
      rq.dailyQuizId = quiz.id;
      rq.position = openPositions[i];
      rq.lastUsedDate = quizDate;
      rq.isReserve = false;
    }
    if (!adminAlerts.some((a) => !a.resolvedAt && a.type === 'RESERVE_FALLBACK_USED' && a.quizDate === quizDate)) {
      adminAlerts.unshift({
        id: crypto.randomUUID(),
        type: 'RESERVE_FALLBACK_USED',
        message: `Daily quiz for ${quizDate} assembled from reserve pool (${needed} questions).`,
        quizDate,
        resolvedAt: null,
        createdAt: now,
      });
    }
    qList = dailyQuestions
      .filter((q) => q.dailyQuizId === quiz!.id && q.status === DailyQuestionStatus.APPROVED)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    return { quiz, approvedQuestions: qList, usedReserveFallback: true };
  }

  function renderMemTemplate(key: AristotleTemplateKey, vars: Record<string, string | number>, fallback: string) {
    const tpl = aristotleTemplates.get(key);
    return renderAristotleTemplate(tpl?.body ?? fallback, vars);
  }

  function sanitizeDailyQ(q: MemDailyQuestion) {
    if (q.status !== DailyQuestionStatus.APPROVED) {
      throw new ForbiddenError('Non-approved daily question cannot be served');
    }
    return {
      id: q.id,
      position: q.position ?? 0,
      type: q.type,
      prompt: q.prompt,
      codeSnippet: q.codeSnippet,
      spokenText: q.spokenText,
      options: q.type === DailyQuestionType.MULTIPLE_CHOICE ? q.options : null,
    };
  }

  router.patch(
    '/me/profile',
    requireAuth,
    validateBody(
      z.object({
        displayName: z.string().min(2).max(32),
        country: z.string().min(2).max(3).nullable().optional(),
      }),
    ),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = users.get(req.user!.userId);
      if (!user) throw new NotFoundError('User not found');
      const mod = moderateDisplayName(req.body.displayName);
      if (!mod.approved) {
        user.displayName = null;
        user.displayNameStatus = DisplayNameStatus.REJECTED;
        if (req.body.country !== undefined) user.country = req.body.country;
        throw new BadRequestError(mod.reason ?? 'displayName failed moderation', 'DISPLAY_NAME_REJECTED');
      }
      user.displayName = req.body.displayName.trim();
      user.displayNameStatus = DisplayNameStatus.APPROVED;
      if (req.body.country !== undefined) user.country = req.body.country;
      res.status(200).json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        displayNameStatus: user.displayNameStatus,
        country: user.country,
      });
    }),
  );

  router.get(
    '/daily/today',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const todayDate = formatDateInTimezone(now, env.DAILY_TZ);
      const { approvedQuestions } = ensureSandboxLiveQuiz(todayDate, now);
      const attempt = dailyAttempts.get(`${req.user!.userId}:${todayDate}`);
      const intro = renderMemTemplate(
        AristotleTemplateKey.INTRO,
        { quizDate: todayDate, questionCount: DAILY_QUIZ_QUESTION_COUNT, timeLimitSeconds: env.DAILY_QUESTION_SECONDS },
        'Welcome to Aristotle Daily Quiz.',
      );

      if (!attempt) {
        res.status(200).json({
          quizDate: todayDate,
          dailyTz: env.DAILY_TZ,
          state: 'NOT_STARTED',
          available: approvedQuestions.length === DAILY_QUIZ_QUESTION_COUNT,
          timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
          timeRemainingSeconds: null,
          totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
          aristotleIntro: intro,
        });
        return;
      }

      if (attempt.finishedAt) {
        res.status(200).json({
          quizDate: todayDate,
          dailyTz: env.DAILY_TZ,
          state: 'DONE',
          available: true,
          timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
          timeRemainingSeconds: 0,
          totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
          totalScore: attempt.totalScore,
          totalTimeMs: attempt.totalTimeMs,
          aristotleIntro: intro,
        });
        return;
      }

      const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
      const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
      res.status(200).json({
        quizDate: todayDate,
        dailyTz: env.DAILY_TZ,
        state: 'IN_PROGRESS',
        available: true,
        currentPosition: attempt.currentPosition,
        totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
        timeRemainingSeconds: Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000)),
        totalScore: attempt.totalScore,
        totalTimeMs: attempt.totalTimeMs,
        aristotleIntro: intro,
      });
    }),
  );

  router.post(
    '/daily/start',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const todayDate = formatDateInTimezone(now, env.DAILY_TZ);
      const key = `${req.user!.userId}:${todayDate}`;
      if (dailyAttempts.has(key)) {
        throw new ConflictError(`You already have an attempt for ${todayDate}.`, 'DAILY_ATTEMPT_ALREADY_EXISTS');
      }
      const { quiz, approvedQuestions } = ensureSandboxLiveQuiz(todayDate, now);
      if (!quiz || approvedQuestions.length !== DAILY_QUIZ_QUESTION_COUNT) {
        throw new ConflictError('Daily quiz is unavailable right now', 'DAILY_QUIZ_UNAVAILABLE');
      }
      const firstQ = approvedQuestions.find((q) => q.position === 1);
      if (!firstQ) throw new ConflictError('Question 1 missing', 'DAILY_QUIZ_UNAVAILABLE');

      const attempt: MemDailyAttempt = {
        id: crypto.randomUUID(),
        userId: req.user!.userId,
        dailyQuizId: quiz.id,
        quizDate: todayDate,
        startedAt: now,
        currentPosition: 1,
        currentQuestionStartedAt: now,
        finishedAt: null,
        totalScore: 0,
        totalTimeMs: 0,
        answers: [],
      };
      dailyAttempts.set(key, attempt);

      const intro = renderMemTemplate(
        AristotleTemplateKey.INTRO,
        { quizDate: todayDate, questionCount: DAILY_QUIZ_QUESTION_COUNT, timeLimitSeconds: env.DAILY_QUESTION_SECONDS },
        'Welcome to Aristotle Daily Quiz.',
      );

      res.status(201).json({
        attemptId: attempt.id,
        quizDate: todayDate,
        state: 'IN_PROGRESS',
        currentPosition: 1,
        totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
        timeRemainingSeconds: env.DAILY_QUESTION_SECONDS,
        aristotleIntro: intro,
        question: sanitizeDailyQ(firstQ),
      });
    }),
  );

  router.get(
    '/daily/question',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const todayDate = formatDateInTimezone(now, env.DAILY_TZ);
      const requested = typeof req.query.quizDate === 'string' ? req.query.quizDate : undefined;
      if (requested && requested !== todayDate) {
        throw new ConflictError(`Quiz date ${requested} expired.`, 'QUIZ_DATE_EXPIRED');
      }
      const attempt = dailyAttempts.get(`${req.user!.userId}:${todayDate}`);
      if (!attempt) throw new NotFoundError('No daily attempt for today', 'DAILY_ATTEMPT_NOT_FOUND');
      if (attempt.finishedAt) throw new ConflictError('Attempt already finished', 'DAILY_ATTEMPT_FINISHED');
      const q = dailyQuestions.find(
        (item) =>
          item.dailyQuizId === attempt.dailyQuizId &&
          item.position === attempt.currentPosition &&
          item.status === DailyQuestionStatus.APPROVED,
      );
      if (!q) throw new NotFoundError('Current approved daily question not found');
      const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
      const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
      res.status(200).json({
        attemptId: attempt.id,
        quizDate: attempt.quizDate,
        currentPosition: attempt.currentPosition,
        totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
        timeRemainingSeconds: Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000)),
        isTimedOut: elapsedMs > limitMs,
        question: sanitizeDailyQ(q),
      });
    }),
  );

  router.post(
    '/daily/answer',
    requireAuth,
    validateBody(
      z.object({
        questionId: z.string().min(1),
        givenValue: z.union([z.string(), z.number(), z.null()]).optional(),
        quizDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    ),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const todayDate = formatDateInTimezone(now, env.DAILY_TZ);
      if (req.body.quizDate && req.body.quizDate !== todayDate) {
        throw new ConflictError('Quiz date expired', 'QUIZ_DATE_EXPIRED');
      }
      const attempt = dailyAttempts.get(`${req.user!.userId}:${todayDate}`);
      if (!attempt) throw new NotFoundError('No active daily attempt', 'DAILY_ATTEMPT_NOT_FOUND');
      if (attempt.finishedAt) throw new ConflictError('Attempt finished', 'DAILY_ATTEMPT_FINISHED');

      const q = dailyQuestions.find(
        (item) => item.dailyQuizId === attempt.dailyQuizId && item.position === attempt.currentPosition,
      );
      if (!q || q.id !== req.body.questionId) {
        throw new ConflictError('Question position mismatch', 'QUESTION_POSITION_MISMATCH');
      }
      if (q.status !== DailyQuestionStatus.APPROVED) {
        throw new ForbiddenError('Non-approved question');
      }

      const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
      const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
      const isLate = elapsedMs > limitMs;
      const normalizedGiven =
        req.body.givenValue === undefined || req.body.givenValue === null ? null : String(req.body.givenValue);
      const isMissing = normalizedGiven === null || normalizedGiven.trim() === '';

      let score = 0;
      if (!isLate && !isMissing) {
        score =
          q.type === DailyQuestionType.ESTIMATE
            ? scoreEstimate(normalizedGiven, q.numericAnswer ?? NaN, q.scale ?? 0)
            : scoreMultipleChoice(normalizedGiven, q.correctAnswer);
      }

      const isFinalQuestion = attempt.currentPosition >= DAILY_QUIZ_QUESTION_COUNT;
      attempt.answers.push({
        questionId: q.id,
        position: attempt.currentPosition,
        givenValue: normalizedGiven,
        score,
        timeMs: elapsedMs,
        isLate,
        submittedAt: now,
      });
      attempt.totalScore += score;
      attempt.totalTimeMs += elapsedMs;
      const submittedPos = attempt.currentPosition;

      if (isFinalQuestion) {
        attempt.finishedAt = now;
        const user = users.get(req.user!.userId);
        const country = user?.country ?? null;
        const wk = getIsoWeekKey(todayDate);

        leaderboardEntries.set(`${req.user!.userId}:DAILY:${todayDate}`, {
          userId: req.user!.userId,
          period: LeaderboardPeriod.DAILY,
          periodKey: todayDate,
          score: attempt.totalScore,
          timeMs: attempt.totalTimeMs,
          country,
          updatedAt: now,
        });
        for (const [p, pk] of [
          [LeaderboardPeriod.WEEKLY, wk],
          [LeaderboardPeriod.ALL_TIME, 'ALL'],
        ] as const) {
          const k = `${req.user!.userId}:${p}:${pk}`;
          const prev = leaderboardEntries.get(k);
          leaderboardEntries.set(k, {
            userId: req.user!.userId,
            period: p,
            periodKey: pk,
            score: (prev?.score ?? 0) + attempt.totalScore,
            timeMs: (prev?.timeMs ?? 0) + attempt.totalTimeMs,
            country,
            updatedAt: now,
          });
        }
      } else {
        attempt.currentPosition += 1;
        attempt.currentQuestionStartedAt = now;
      }

      const tKey = isLate
        ? AristotleTemplateKey.FEEDBACK_TIMEOUT
        : score >= 700
          ? AristotleTemplateKey.FEEDBACK_CORRECT
          : AristotleTemplateKey.FEEDBACK_INCORRECT;

      const aristotleFeedback = renderMemTemplate(
        tKey,
        {
          position: submittedPos,
          score,
          correctAnswer: q.correctAnswer,
          numericAnswer: q.numericAnswer ?? '',
          explanation: q.explanation,
        },
        `Score: ${score}`,
      );

      res.status(200).json({
        questionId: q.id,
        position: submittedPos,
        givenValue: normalizedGiven,
        score,
        timeMs: elapsedMs,
        isLate,
        correctAnswer: q.correctAnswer,
        numericAnswer: q.numericAnswer,
        explanation: q.explanation,
        aristotleFeedback,
        isFinalQuestion,
        attempt: {
          id: attempt.id,
          totalScore: attempt.totalScore,
          totalTimeMs: attempt.totalTimeMs,
          finishedAt: attempt.finishedAt,
          nextPosition: isFinalQuestion ? null : attempt.currentPosition,
        },
      });
    }),
  );

  router.get(
    '/daily/result',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const quizDate =
        typeof req.query.quizDate === 'string'
          ? req.query.quizDate
          : formatDateInTimezone(now, env.DAILY_TZ);
      const attempt = dailyAttempts.get(`${req.user!.userId}:${quizDate}`);
      if (!attempt) throw new NotFoundError(`No daily quiz attempt for ${quizDate}`);
      if (!attempt.finishedAt) {
        throw new ForbiddenError('Results are locked until all 7 questions are answered', 'DAILY_RESULT_LOCKED');
      }
      const aristotleSummary = renderMemTemplate(
        AristotleTemplateKey.RESULT_SUMMARY,
        {
          quizDate,
          totalScore: attempt.totalScore,
          totalTimeMs: attempt.totalTimeMs,
          questionCount: DAILY_QUIZ_QUESTION_COUNT,
        },
        `Total score: ${attempt.totalScore}`,
      );
      res.status(200).json({
        attemptId: attempt.id,
        quizDate,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        totalScore: attempt.totalScore,
        totalTimeMs: attempt.totalTimeMs,
        maxScore: 7000,
        aristotleSummary,
        answers: attempt.answers.map((ans) => {
          const q = dailyQuestions.find((item) => item.id === ans.questionId);
          return {
            ...ans,
            type: q?.type ?? null,
            prompt: q?.prompt ?? null,
            codeSnippet: q?.codeSnippet ?? null,
            options: q?.options ?? null,
            correctAnswer: q?.correctAnswer ?? null,
            numericAnswer: q?.numericAnswer ?? null,
            explanation: q?.explanation ?? null,
          };
        }),
      });
    }),
  );

  function getSortedEligibleLeaderboard(period: LeaderboardPeriod, periodKey: string) {
    return Array.from(leaderboardEntries.values())
      .filter((e) => {
        if (e.period !== period || e.periodKey !== periodKey) return false;
        const u = users.get(e.userId);
        return Boolean(u && u.displayName && u.displayNameStatus === DisplayNameStatus.APPROVED);
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
        return a.userId.localeCompare(b.userId);
      });
  }

  router.get(
    '/leaderboard',
    asyncHandler(async (req: Request, res: Response) => {
      const periodRaw = typeof req.query.period === 'string' ? req.query.period : 'daily';
      const periodKeyRaw = typeof req.query.periodKey === 'string' ? req.query.periodKey : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
      const cursorRaw = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const { period, periodKey } = resolvePeriodAndKey(periodRaw, periodKeyRaw, new Date());
      const cursor = cursorRaw ? decodeLeaderboardCursor(cursorRaw) : null;

      let sorted = getSortedEligibleLeaderboard(period, periodKey);
      if (cursor) {
        sorted = sorted.filter(
          (e) =>
            e.score < cursor.score ||
            (e.score === cursor.score && e.timeMs > cursor.timeMs) ||
            (e.score === cursor.score && e.timeMs === cursor.timeMs && e.userId > cursor.userId),
        );
      }
      const pageRows = sorted.slice(0, limit);
      const hasMore = sorted.length > limit;
      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeLeaderboardCursor({
              score: pageRows[pageRows.length - 1].score,
              timeMs: pageRows[pageRows.length - 1].timeMs,
              userId: pageRows[pageRows.length - 1].userId,
            })
          : null;

      res.status(200).json({
        period,
        periodKey,
        entries: pageRows.map((e) => {
          const u = users.get(e.userId)!;
          return {
            userId: e.userId,
            displayName: u.displayName!,
            country: e.country ?? u.country ?? null,
            score: e.score,
            timeMs: e.timeMs,
            updatedAt: e.updatedAt,
          };
        }),
        nextCursor,
      });
    }),
  );

  router.get(
    '/leaderboard/me',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const periodRaw = typeof req.query.period === 'string' ? req.query.period : 'daily';
      const periodKeyRaw = typeof req.query.periodKey === 'string' ? req.query.periodKey : undefined;
      const { period, periodKey } = resolvePeriodAndKey(periodRaw, periodKeyRaw, new Date());
      const user = users.get(req.user!.userId);
      if (!user || !user.displayName || user.displayNameStatus !== DisplayNameStatus.APPROVED) {
        res.status(200).json({
          period,
          periodKey,
          eligible: false,
          reason: 'Approved displayName required to appear on leaderboards',
          rank: null,
          me: null,
          neighbors: [],
        });
        return;
      }
      const ordered = getSortedEligibleLeaderboard(period, periodKey);
      const idx = ordered.findIndex((e) => e.userId === user.id);
      if (idx === -1) {
        res.status(200).json({ period, periodKey, eligible: true, rank: null, me: null, neighbors: [] });
        return;
      }
      const start = Math.max(0, idx - 2);
      const end = Math.min(ordered.length, idx + 3);
      const neighbors = ordered.slice(start, end).map((row, off) => {
        const u = users.get(row.userId)!;
        return {
          rank: start + off + 1,
          userId: row.userId,
          displayName: u.displayName!,
          country: row.country ?? u.country ?? null,
          score: row.score,
          timeMs: row.timeMs,
          isMe: row.userId === user.id,
        };
      });
      res.status(200).json({
        period,
        periodKey,
        eligible: true,
        rank: idx + 1,
        me: neighbors.find((n) => n.isMe) ?? null,
        neighbors,
      });
    }),
  );

  // Admin Daily Quiz endpoints in Sandbox
  router.get(
    '/admin/daily/questions',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const status = req.query.status as DailyQuestionStatus | undefined;
      const list = dailyQuestions.filter((q) => !status || q.status === status);
      res.status(200).json({ questions: list });
    }),
  );

  router.post(
    '/admin/daily/questions',
    requireAuth,
    requireAdmin,
    validateBody(
      z.object({
        type: z.nativeEnum(DailyQuestionType),
        prompt: z.string().min(5),
        codeSnippet: z.string().nullable().optional(),
        spokenText: z.string().nullable().optional(),
        options: z.array(z.string().min(1)).nullable().optional(),
        correctAnswer: z.string().min(1).optional(),
        numericAnswer: z.number().nullable().optional(),
        scale: z.number().nullable().optional(),
        explanation: z.string().min(1),
        sourceUrl: z.string().url().nullable().optional(),
        license: z.string().min(1).nullable().optional(),
        generatedBy: z.nativeEnum(DailyQuestionOrigin).default(DailyQuestionOrigin.HUMAN),
        dailyQuizId: z.string().min(1).nullable().optional(),
        position: z.number().int().min(1).max(7).nullable().optional(),
        isFactualClaim: z.boolean().optional(),
        isCodeOutput: z.boolean().optional(),
      }),
    ),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { normalizedCorrectAnswer } = validateDailyQuestionCandidatePayload(req.body);
      const fp = computePromptFingerprint(req.body.prompt);
      const since = Date.now() - FINGERPRINT_WINDOW_DAYS * 86_400_000;
      if (dailyQuestions.some((q) => q.fingerprint === fp && q.createdAt.getTime() >= since)) {
        throw new ConflictError('Duplicate question prompt within 365 days', 'DUPLICATE_FINGERPRINT');
      }
      const q: MemDailyQuestion = {
        id: crypto.randomUUID(),
        dailyQuizId: req.body.dailyQuizId ?? null,
        position: req.body.position ?? null,
        type: req.body.type,
        prompt: String(req.body.prompt).trim(),
        codeSnippet: req.body.codeSnippet ?? null,
        spokenText: req.body.spokenText ?? null,
        options: req.body.options ?? null,
        correctAnswer: normalizedCorrectAnswer,
        numericAnswer: req.body.type === DailyQuestionType.ESTIMATE ? req.body.numericAnswer : null,
        scale: req.body.type === DailyQuestionType.ESTIMATE ? req.body.scale : null,
        explanation: String(req.body.explanation).trim(),
        sourceUrl: req.body.sourceUrl ?? null,
        license: req.body.license ?? null,
        status: DailyQuestionStatus.DRAFT,
        rejectionReason: null,
        generatedBy: req.body.generatedBy ?? DailyQuestionOrigin.HUMAN,
        fingerprint: fp,
        lastUsedDate: null,
        isReserve: req.body.dailyQuizId ? false : true,
        createdAt: new Date(),
      };
      dailyQuestions.unshift(q);
      auditLogs.unshift({
        id: crypto.randomUUID(),
        actorUserId: req.user!.userId,
        actorEmail: req.user!.email,
        entityType: 'DailyQuestion',
        entityId: q.id,
        action: 'CANDIDATE_SUBMITTED',
        reason: null,
        changes: { generatedBy: q.generatedBy, status: q.status },
        createdAt: new Date(),
      });
      res.status(201).json(q);
    }),
  );

  router.post(
    '/admin/daily/questions/:id/review',
    requireAuth,
    requireAdmin,
    validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().min(1) })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const q = dailyQuestions.find((item) => item.id === req.params.id);
      if (!q) throw new NotFoundError('Daily question not found');
      const prev = q.status;
      q.status = req.body.decision === 'APPROVED' ? DailyQuestionStatus.APPROVED : DailyQuestionStatus.REJECTED;
      q.rejectionReason = q.status === DailyQuestionStatus.REJECTED ? req.body.reason : null;
      auditLogs.unshift({
        id: crypto.randomUUID(),
        actorUserId: req.user!.userId,
        actorEmail: req.user!.email,
        entityType: 'DailyQuestion',
        entityId: q.id,
        action: `REVIEW_${q.status}`,
        reason: req.body.reason,
        changes: { fromStatus: prev, toStatus: q.status },
        createdAt: new Date(),
      });
      res.status(200).json(q);
    }),
  );

  router.get(
    '/admin/daily/buffer',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const todayDate = formatDateInTimezone(new Date(), env.DAILY_TZ);
      const cutoff = addDaysToDateString(todayDate, -FINGERPRINT_WINDOW_DAYS);
      const availableReserveCount = dailyQuestions.filter(
        (q) =>
          q.status === DailyQuestionStatus.APPROVED &&
          q.dailyQuizId === null &&
          (!q.lastUsedDate || q.lastUsedDate <= cutoff),
      ).length;
      const days = [];
      for (let i = 0; i <= env.DAILY_BUFFER_DAYS; i++) {
        const d = addDaysToDateString(todayDate, i);
        const quiz = dailyQuizzes.get(d);
        const qList = quiz ? dailyQuestions.filter((q) => q.dailyQuizId === quiz.id) : [];
        const approvedCount = qList.filter((q) => q.status === DailyQuestionStatus.APPROVED).length;
        days.push({
          quizDate: d,
          status: quiz?.status ?? null,
          totalQuestions: qList.length,
          approvedCount,
          publishable: approvedCount === DAILY_QUIZ_QUESTION_COUNT,
          usedReserveFallback: quiz?.usedReserveFallback ?? false,
        });
      }
      res.status(200).json({
        todayDate,
        dailyTz: env.DAILY_TZ,
        bufferDaysConfigured: env.DAILY_BUFFER_DAYS,
        availableReserveCount,
        days,
      });
    }),
  );

  router.post(
    '/admin/daily/scheduler/run',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const now = new Date();
      const todayDate = formatDateInTimezone(now, env.DAILY_TZ);
      const todayRes = ensureSandboxLiveQuiz(todayDate, now);
      let closedCount = 0;
      for (const quiz of dailyQuizzes.values()) {
        if (quiz.status === DailyQuizStatus.LIVE && quiz.quizDate < todayDate) {
          quiz.status = DailyQuizStatus.CLOSED;
          quiz.closedAt = now;
          closedCount++;
        }
      }
      const cutoff = addDaysToDateString(todayDate, -FINGERPRINT_WINDOW_DAYS);
      const bufferedDatesCreated: string[] = [];
      for (let offset = 1; offset <= env.DAILY_BUFFER_DAYS; offset++) {
        const d = addDaysToDateString(todayDate, offset);
        const existing = dailyQuizzes.get(d);
        const existingApproved = existing
          ? dailyQuestions.filter((q) => q.dailyQuizId === existing.id && q.status === DailyQuestionStatus.APPROVED)
          : [];
        if (existingApproved.length === DAILY_QUIZ_QUESTION_COUNT) continue;
        const needed = DAILY_QUIZ_QUESTION_COUNT - existingApproved.length;
        const reserve = dailyQuestions.filter(
          (q) =>
            q.status === DailyQuestionStatus.APPROVED &&
            q.dailyQuizId === null &&
            (!q.lastUsedDate || q.lastUsedDate <= cutoff),
        );
        if (reserve.length < needed) continue;
        const targetQuiz =
          existing ??
          (() => {
            const created: MemDailyQuiz = {
              id: `dq-quiz-${d}`,
              quizDate: d,
              status: DailyQuizStatus.BUFFERED,
              publishedAt: null,
              closedAt: null,
              usedReserveFallback: false,
            };
            dailyQuizzes.set(d, created);
            return created;
          })();
        for (let i = 0; i < needed; i++) {
          reserve[i].dailyQuizId = targetQuiz.id;
          reserve[i].position = i + 1;
          reserve[i].lastUsedDate = d;
          reserve[i].isReserve = false;
        }
        bufferedDatesCreated.push(d);
      }
      res.status(200).json({
        todayDate,
        todayUsedReserveFallback: todayRes.usedReserveFallback,
        closedCount,
        bufferedDatesCreated,
        alertsCreated: 0,
      });
    }),
  );

  router.get(
    '/admin/daily/templates',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({ templates: Array.from(aristotleTemplates.values()) });
    }),
  );

  router.put(
    '/admin/daily/templates/:key',
    requireAuth,
    requireAdmin,
    validateBody(z.object({ title: z.string().min(1), body: z.string().min(1), language: z.string().optional(), voiceId: z.string().optional() })),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const key = req.params.key as AristotleTemplateKey;
      if (!Object.values(AristotleTemplateKey).includes(key)) {
        throw new BadRequestError(`Invalid template key: ${key}`);
      }
      const updated = {
        id: aristotleTemplates.get(key)?.id ?? crypto.randomUUID(),
        key,
        title: req.body.title,
        body: req.body.body,
        language: req.body.language ?? 'en',
        voiceId: req.body.voiceId ?? 'aristotle',
        updatedAt: new Date(),
      };
      aristotleTemplates.set(key, updated);
      res.status(200).json({ template: updated });
    }),
  );

  router.get(
    '/admin/daily/alerts',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({ alerts: adminAlerts.filter((a) => !a.resolvedAt) });
    }),
  );

  router.post(
    '/admin/daily/alerts/:id/resolve',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const a = adminAlerts.find((item) => item.id === req.params.id);
      if (!a) throw new NotFoundError('Alert not found');
      a.resolvedAt = new Date();
      res.status(200).json(a);
    }),
  );

  return router;
}
