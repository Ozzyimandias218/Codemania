import 'dotenv/config';
import {
  AristotleTemplateKey,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  DailyQuizStatus,
  DisplayNameStatus,
  LevelType,
  Prisma,
  PrismaClient,
  QuestionOrigin,
  QuestionStatus,
  QuestionType,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { computePromptFingerprint } from '../src/backend/utils/dailyQuiz.ts';
import { addDaysToDateString, formatDateInTimezone } from '../src/backend/utils/timezone.ts';

const prisma = new PrismaClient();

const PYTHON_UNIT_TITLES = [
  'Unit 1: Python Basics & Variables',
  'Unit 2: Control Flow & Loops',
  'Unit 3: Functions & Scope',
  'Unit 4: Collections & Strings',
  'Unit 5: Classes, Errors & Modules',
];

const PLACEHOLDER_UNIT_TITLES = [
  'Unit 1: Core Fundamentals',
  'Unit 2: Control Flow',
  'Unit 3: Functions & Scope',
  'Unit 4: Data Structures',
  'Unit 5: Mastery & Patterns',
];

async function seedTrackStructure(params: {
  slug: string;
  title: string;
  levelCount: number;
  order: number;
  isPlaceholder: boolean;
  unitTitles: string[];
}) {
  const track = await prisma.track.upsert({
    where: { slug: params.slug },
    update: {
      title: params.title,
      levelCount: params.levelCount,
      order: params.order,
      isPlaceholder: params.isPlaceholder,
    },
    create: {
      slug: params.slug,
      title: params.title,
      levelCount: params.levelCount,
      order: params.order,
      isPlaceholder: params.isPlaceholder,
    },
  });

  const levelsPerUnit = Math.ceil(params.levelCount / params.unitTitles.length);
  const createdLevels = [];

  for (let uIdx = 0; uIdx < params.unitTitles.length; uIdx++) {
    const unitOrder = uIdx + 1;
    const unit = await prisma.unit.upsert({
      where: { trackId_order: { trackId: track.id, order: unitOrder } },
      update: { title: params.unitTitles[uIdx] },
      create: {
        trackId: track.id,
        title: params.unitTitles[uIdx],
        order: unitOrder,
      },
    });

    const startNum = uIdx * levelsPerUnit + 1;
    const endNum = Math.min(params.levelCount, (uIdx + 1) * levelsPerUnit);

    for (let num = startNum; num <= endNum; num++) {
      const levelType: LevelType =
        num % 5 === 0 ? LevelType.CHECKPOINT : LevelType.LESSON;

      const level = await prisma.level.upsert({
        where: { trackId_number: { trackId: track.id, number: num } },
        update: { unitId: unit.id, type: levelType },
        create: {
          trackId: track.id,
          unitId: unit.id,
          number: num,
          type: levelType,
          title:
            levelType === LevelType.CHECKPOINT
              ? `${params.title} Checkpoint ${num / 5}`
              : `${params.title} Lesson ${num}`,
        },
      });
      createdLevels.push(level);
    }
  }

  return { track, levels: createdLevels };
}

async function seedPythonQuestions(
  pythonLevels: Array<{ id: string; number: number; type: LevelType }>,
  adminId: string,
) {
  const lessonLevels = pythonLevels.filter((l) => l.type === LevelType.LESSON);

  for (const level of lessonLevels) {
    const existingCount = await prisma.question.count({ where: { levelId: level.id } });
    if (existingCount > 0) continue;

    const n = level.number;
    const authoredQuestions = [
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: `Python Lesson ${n}: Which keyword defines a function in Python?`,
        spokenText: `In Python Lesson ${n}, which keyword is used to define a function?`,
        codeSnippet: null,
        options: ['func', 'def', 'function', 'lambda_def'],
        answer: '1',
        explanation: 'In Python, functions are defined using the def keyword.',
      },
      {
        type: QuestionType.TYPE_OUTPUT,
        prompt: `Python Lesson ${n}: What does this code print?`,
        spokenText: `In Python Lesson ${n}, determine the exact printed output of the snippet.`,
        codeSnippet: `x = ${n}\nprint(x * 2)`,
        options: null,
        answer: String(n * 2),
        explanation: `Multiplying ${n} by 2 produces ${n * 2}, which print outputs.`,
      },
      {
        type: QuestionType.MULTIPLE_CHOICE,
        prompt: `Python Lesson ${n}: What is the type of [1, 2, 3] in Python?`,
        spokenText: `In Python Lesson ${n}, what built-in type represents square-bracket sequences?`,
        codeSnippet: 'items = [1, 2, 3]',
        options: ['tuple', 'dict', 'list', 'set'],
        answer: '2',
        explanation: 'Square brackets create a mutable list in Python.',
      },
    ];

    for (const q of authoredQuestions) {
      await prisma.question.create({
        data: {
          levelId: level.id,
          questionGroupId: crypto.randomUUID(),
          type: q.type,
          prompt: q.prompt,
          codeSnippet: q.codeSnippet,
          spokenText: q.spokenText,
          options: q.options ? q.options : Prisma.JsonNull,
          answer: q.answer,
          explanation: q.explanation,
          origin: QuestionOrigin.AUTHORED,
          status: QuestionStatus.APPROVED,
          version: 1,
          isLatest: true,
          createdById: adminId,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
    }

    // Seed an approved WEB question on every 4th lesson + a DRAFT WEB question on lesson 1
    if (n % 4 === 0) {
      await prisma.question.create({
        data: {
          levelId: level.id,
          questionGroupId: crypto.randomUUID(),
          type: QuestionType.MULTIPLE_CHOICE,
          prompt: `Python Lesson ${n} (Web Community): Which built-in returns the length of a sequence?`,
          spokenText: 'Which Python built-in function returns the number of items in a sequence?',
          codeSnippet: 'len("codemania")',
          options: ['count()', 'size()', 'len()', 'length()'],
          answer: '2',
          explanation: 'The built-in len() function returns the item count of sequences and collections.',
          origin: QuestionOrigin.WEB,
          sourceUrl: 'https://docs.python.org/3/library/functions.html#len',
          license: 'PSF-2.0',
          status: QuestionStatus.APPROVED,
          version: 1,
          isLatest: true,
          createdById: adminId,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
    }

    if (n === 1) {
      await prisma.question.create({
        data: {
          levelId: level.id,
          questionGroupId: crypto.randomUUID(),
          type: QuestionType.TYPE_OUTPUT,
          prompt: 'Pending review: What does print("hi".upper()) output?',
          spokenText: 'What does calling upper on the string hi print?',
          codeSnippet: 'print("hi".upper())',
          options: Prisma.JsonNull,
          answer: 'HI',
          explanation: 'str.upper() returns an uppercase copy of the string.',
          origin: QuestionOrigin.WEB,
          sourceUrl: 'https://docs.python.org/3/library/stdtypes.html#str.upper',
          license: 'PSF-2.0',
          status: QuestionStatus.DRAFT,
          version: 1,
          isLatest: true,
          createdById: adminId,
        },
      });
    }
  }
}

async function seedAristotleDailyQuiz(adminId: string) {
  const templates: Array<{
    key: AristotleTemplateKey;
    title: string;
    body: string;
  }> = [
    {
      key: AristotleTemplateKey.INTRO,
      title: 'Aristotle Daily Intro',
      body: 'Greetings, scholar. Today is {{quizDate}}. Seven sharp questions await you, each within {{timeLimitSeconds}} seconds.',
    },
    {
      key: AristotleTemplateKey.FEEDBACK_CORRECT,
      title: 'Aristotle Correct Feedback',
      body: 'Well reasoned on question {{position}}! You earned {{score}} points. {{explanation}}',
    },
    {
      key: AristotleTemplateKey.FEEDBACK_INCORRECT,
      title: 'Aristotle Incorrect Feedback',
      body: 'Not quite on question {{position}} — you scored {{score}} points. The key insight: {{explanation}}',
    },
    {
      key: AristotleTemplateKey.FEEDBACK_TIMEOUT,
      title: 'Aristotle Timeout Feedback',
      body: 'The hourglass ran dry on question {{position}}, so 0 points are recorded. Remember: {{explanation}}',
    },
    {
      key: AristotleTemplateKey.RESULT_SUMMARY,
      title: 'Aristotle Result Summary',
      body: 'Wisdom grows through reflection. For {{quizDate}}, your total score is {{totalScore}} across {{totalTimeMs}} milliseconds.',
    },
  ];

  for (const tpl of templates) {
    await prisma.aristotleTemplate.upsert({
      where: { key: tpl.key },
      update: { title: tpl.title, body: tpl.body },
      create: {
        key: tpl.key,
        title: tpl.title,
        body: tpl.body,
        language: 'en',
        voiceId: 'aristotle',
        updatedById: adminId,
      },
    });
  }

  const existingDailyCount = await prisma.dailyQuestion.count();
  if (existingDailyCount === 0) {
    const dailyTz = process.env.DAILY_TZ || 'UTC';
    const todayDate = formatDateInTimezone(new Date(), dailyTz);

    // Build 70 approved questions: 49 assigned to today (LIVE) + next 6 days (BUFFERED), 21 in reserve
    const buildQuestionData = (idx: number, quizId: string | null, pos: number | null, usedDate: string | null) => {
      const isEstimate = idx % 2 === 0;
      const numVal = 1970 + idx;
      const prompt = isEstimate
        ? `Aristotle Challenge #${idx + 1}: In what year or numeric milestone did milestone #${idx + 1} normalize around ${numVal}?`
        : `Aristotle Challenge #${idx + 1}: Which expression evaluates to ${idx + 10}?`;
      const options = isEstimate
        ? Prisma.JsonNull
        : [`${idx + 8}`, `${idx + 10}`, `${idx + 12}`, `${idx + 14}`];
      return {
        dailyQuizId: quizId,
        position: pos,
        type: isEstimate ? DailyQuestionType.ESTIMATE : DailyQuestionType.MULTIPLE_CHOICE,
        prompt,
        codeSnippet: isEstimate ? null : `console.log(${idx} + 10);`,
        spokenText: prompt,
        options,
        correctAnswer: isEstimate ? String(numVal) : '1',
        numericAnswer: isEstimate ? numVal : null,
        scale: isEstimate ? 20 : null,
        explanation: isEstimate
          ? `The reference milestone value for challenge #${idx + 1} is ${numVal}.`
          : `Adding ${idx} and 10 logs ${idx + 10}.`,
        sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
        license: 'CC-BY-SA-2.5',
        status: DailyQuestionStatus.APPROVED,
        generatedBy: DailyQuestionOrigin.HUMAN,
        fingerprint: computePromptFingerprint(prompt),
        lastUsedDate: usedDate,
        isReserve: quizId === null,
        createdById: adminId,
        reviewedById: adminId,
        reviewedAt: new Date(),
      };
    };

    let qIdx = 0;
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const quizDate = addDaysToDateString(todayDate, dayOffset);
      const isLive = dayOffset === 0;
      const quiz = await prisma.dailyQuiz.create({
        data: {
          quizDate,
          status: isLive ? DailyQuizStatus.LIVE : DailyQuizStatus.BUFFERED,
          publishedAt: isLive ? new Date() : null,
        },
      });
      for (let pos = 1; pos <= 7; pos++) {
        await prisma.dailyQuestion.create({
          data: buildQuestionData(qIdx++, quiz.id, pos, quizDate),
        });
      }
    }

    // 21 approved reserve questions ready for fallback / future buffering
    for (let r = 0; r < 21; r++) {
      await prisma.dailyQuestion.create({
        data: buildQuestionData(qIdx++, null, null, null),
      });
    }

    // 1 AI-generated DRAFT candidate awaiting human admin review
    const aiPrompt = 'What is the approximate number of RFCs published by the IETF by 2024?';
    await prisma.dailyQuestion.create({
      data: {
        type: DailyQuestionType.ESTIMATE,
        prompt: aiPrompt,
        spokenText: aiPrompt,
        options: Prisma.JsonNull,
        correctAnswer: '9500',
        numericAnswer: 9500,
        scale: 1500,
        explanation: 'By 2024 the IETF RFC series surpassed roughly 9,500 published documents.',
        sourceUrl: 'https://www.rfc-editor.org/rfc-index.html',
        license: 'IETF-Trust',
        status: DailyQuestionStatus.DRAFT,
        generatedBy: DailyQuestionOrigin.AI,
        fingerprint: computePromptFingerprint(aiPrompt),
        isReserve: true,
        createdById: adminId,
      },
    });
  }
}

async function main() {
  const adminEmail = (process.env.ADMIN_EMAILS?.split(',')[0] || 'admin@codemania.dev')
    .trim()
    .toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'CodemaniaAdmin123!';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: UserRole.ADMIN },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Codemania Admin',
      displayName: 'AristotleAdmin',
      displayNameStatus: DisplayNameStatus.APPROVED,
      role: UserRole.ADMIN,
      timezone: 'UTC',
      isAdult: true,
    },
  });

  // 1. Python Track (50 levels -> maxPoints = 5)
  const python = await seedTrackStructure({
    slug: 'python',
    title: 'Python',
    levelCount: 50,
    order: 1,
    isPlaceholder: false,
    unitTitles: PYTHON_UNIT_TITLES,
  });

  // 2. JavaScript Track (isPlaceholder = true, levelCount = 50 -> maxPoints = 5, requires 5 Python points)
  const javascript = await seedTrackStructure({
    slug: 'javascript',
    title: 'JavaScript',
    levelCount: 50,
    order: 2,
    isPlaceholder: true,
    unitTitles: PLACEHOLDER_UNIT_TITLES,
  });

  // 3. C++ Track (isPlaceholder = true, levelCount = 50 -> maxPoints = 5, requires all JavaScript points)
  const cpp = await seedTrackStructure({
    slug: 'cpp',
    title: 'C++',
    levelCount: 50,
    order: 3,
    isPlaceholder: true,
    unitTitles: PLACEHOLDER_UNIT_TITLES,
  });

  // Prerequisites: Python -> JavaScript (5 Python points) -> C++ (all JS points = floor(50/10) = 5)
  await prisma.trackPrerequisite.upsert({
    where: {
      trackId_requiredTrackId: {
        trackId: javascript.track.id,
        requiredTrackId: python.track.id,
      },
    },
    update: { requiredPoints: 5 },
    create: {
      trackId: javascript.track.id,
      requiredTrackId: python.track.id,
      requiredPoints: 5,
    },
  });

  const allJsPoints = Math.floor(javascript.track.levelCount / 10);
  await prisma.trackPrerequisite.upsert({
    where: {
      trackId_requiredTrackId: {
        trackId: cpp.track.id,
        requiredTrackId: javascript.track.id,
      },
    },
    update: { requiredPoints: allJsPoints },
    create: {
      trackId: cpp.track.id,
      requiredTrackId: javascript.track.id,
      requiredPoints: allJsPoints,
    },
  });

  await seedPythonQuestions(python.levels, admin.id);
  await seedAristotleDailyQuiz(admin.id);

  console.info(
    `[seed] Seeded admin (${admin.email}), tracks, and Aristotle Daily Quiz templates + buffered quizzes + reserve pool.`,
  );
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
