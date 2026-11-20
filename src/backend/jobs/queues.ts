import { Queue } from 'bullmq';
import { env } from '../config/env.ts';
import { getRedisConnection, isRedisConfigured } from '../config/redis.ts';

export const QUEUE_NAMES = {
  VOICE_GENERATION: 'voice-generation',
  COMMITMENT_DAILY_EVAL: 'commitment-daily-eval',
  PENALTY_RETRY: 'penalty-retry',
  COMMITMENT_CLOSE: 'commitment-close',
  DAILY_QUIZ_SCHEDULER: 'daily-quiz-scheduler',
} as const;

export interface VoiceGenerationJobData {
  voiceAssetId: string;
}

export interface PenaltyRetryJobData {
  commitmentId: string;
  attemptNumber: number;
}

export interface CommitmentCloseJobData {
  commitmentId: string;
}

class JobDispatcher {
  private queues = new Map<string, Queue>();

  private getQueue(name: string): Queue | null {
    if (!isRedisConfigured()) {
      return null;
    }
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: getRedisConnection(),
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueueVoiceGeneration(data: VoiceGenerationJobData): Promise<void> {
    const queue = this.getQueue(QUEUE_NAMES.VOICE_GENERATION);
    if (!queue) return;
    await queue.add('generate-voice', data, {
      jobId: `voice-${data.voiceAssetId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    });
  }

  async enqueuePenaltyRetry(data: PenaltyRetryJobData, delayMs: number): Promise<void> {
    const queue = this.getQueue(QUEUE_NAMES.PENALTY_RETRY);
    if (!queue) return;
    await queue.add('retry-penalty-charge', data, {
      jobId: `penalty-retry-${data.commitmentId}-${data.attemptNumber}`,
      delay: delayMs,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  }

  async enqueueCommitmentClose(data: CommitmentCloseJobData, delayMs = 0): Promise<void> {
    const queue = this.getQueue(QUEUE_NAMES.COMMITMENT_CLOSE);
    if (!queue) return;
    await queue.add('close-commitment', data, {
      jobId: `close-${data.commitmentId}`,
      delay: delayMs,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  }

  async scheduleDailyCommitmentEval(): Promise<void> {
    const queue = this.getQueue(QUEUE_NAMES.COMMITMENT_DAILY_EVAL);
    if (!queue) return;
    await queue.upsertJobScheduler(
      'daily-commitment-eval-cron',
      { pattern: '5 0 * * *' },
      { name: 'daily-commitment-eval', data: {} },
    );
  }

  async scheduleDailyQuizRollover(): Promise<void> {
    const queue = this.getQueue(QUEUE_NAMES.DAILY_QUIZ_SCHEDULER);
    if (!queue) return;
    await queue.upsertJobScheduler(
      'daily-quiz-aristotle-midnight',
      { pattern: '0 0 * * *', tz: env.DAILY_TZ },
      { name: 'daily-quiz-rollover', data: {} },
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.queues.values()).map((q) => q.close()));
    this.queues.clear();
  }
}

export const jobDispatcher = new JobDispatcher();
