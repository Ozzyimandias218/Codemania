import { Worker } from 'bullmq';
import { getRedisConnection, isRedisConfigured } from '../config/redis.ts';
import { commitmentService } from '../services/commitment.service.ts';
import { dailyQuizService } from '../services/dailyQuiz.service.ts';
import { stripeService } from '../services/stripe.service.ts';
import { voiceService } from '../services/tts/voice.service.ts';
import {
  CommitmentCloseJobData,
  PenaltyRetryJobData,
  QUEUE_NAMES,
  VoiceGenerationJobData,
  jobDispatcher,
} from './queues.ts';

let activeWorkers: Worker[] = [];

export async function startWorkers(): Promise<void> {
  if (!isRedisConfigured()) {
    console.info('[workers] REDIS_URL not set; BullMQ workers disabled in this process.');
    return;
  }

  const connection = getRedisConnection();

  const voiceWorker = new Worker<VoiceGenerationJobData>(
    QUEUE_NAMES.VOICE_GENERATION,
    async (job) => {
      await voiceService.processVoiceGenerationJob(job.data.voiceAssetId);
    },
    { connection, concurrency: 4 },
  );

  const dailyEvalWorker = new Worker(
    QUEUE_NAMES.COMMITMENT_DAILY_EVAL,
    async () => {
      await commitmentService.evaluateAllActiveCommitments();
    },
    { connection, concurrency: 1 },
  );

  const penaltyRetryWorker = new Worker<PenaltyRetryJobData>(
    QUEUE_NAMES.PENALTY_RETRY,
    async (job) => {
      await stripeService.chargeClosePenaltyOnce(job.data.commitmentId);
    },
    { connection, concurrency: 2 },
  );

  const commitmentCloseWorker = new Worker<CommitmentCloseJobData>(
    QUEUE_NAMES.COMMITMENT_CLOSE,
    async (job) => {
      await commitmentService.evaluateCommitmentById(job.data.commitmentId);
    },
    { connection, concurrency: 2 },
  );

  const dailyQuizWorker = new Worker(
    QUEUE_NAMES.DAILY_QUIZ_SCHEDULER,
    async () => {
      await dailyQuizService.runDailyScheduler(new Date());
    },
    { connection, concurrency: 1 },
  );

  activeWorkers = [
    voiceWorker,
    dailyEvalWorker,
    penaltyRetryWorker,
    commitmentCloseWorker,
    dailyQuizWorker,
  ];

  for (const w of activeWorkers) {
    w.on('failed', (job, err) => {
      console.error(`[worker:${w.name}] job ${job?.id} failed:`, err.message);
    });
  }

  await jobDispatcher.scheduleDailyCommitmentEval();
  await jobDispatcher.scheduleDailyQuizRollover();
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(activeWorkers.map((w) => w.close()));
  activeWorkers = [];
  await jobDispatcher.closeAll();
}
