import vm from 'node:vm';
import { sha256 } from './hash.ts';

export function computePromptFingerprint(prompt: string): string {
  const normalized = prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!,;:]+$/g, '')
    .trim();
  return sha256(normalized);
}

/**
 * Exact scoring formula for ESTIMATE:
 *   score_estimate = round(1000 * max(0, 1 - abs(guess - numericAnswer) / scale))
 *   exact = 1000; non-finite guess = 0
 */
export function scoreEstimate(
  guessInput: string | number | null | undefined,
  numericAnswer: number,
  scale: number,
): number {
  if (!Number.isFinite(numericAnswer) || !Number.isFinite(scale) || scale <= 0) {
    return 0;
  }
  if (guessInput === null || guessInput === undefined) return 0;
  const trimmed = typeof guessInput === 'string' ? guessInput.trim() : guessInput;
  if (trimmed === '') return 0;
  const guess = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  if (!Number.isFinite(guess)) {
    return 0;
  }
  const ratio = 1 - Math.abs(guess - numericAnswer) / scale;
  return Math.round(1000 * Math.max(0, ratio));
}

export function scoreMultipleChoice(
  givenValue: string | null | undefined,
  correctAnswer: string,
): number {
  if (givenValue === null || givenValue === undefined) return 0;
  return givenValue.trim() === correctAnswer.trim() ? 1000 : 0;
}

/**
 * Computes ISO 8601 week key (e.g. "2026-W47") from a YYYY-MM-DD calendar date.
 */
export function getIsoWeekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

const BLOCKED_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'nigger',
  'faggot',
  'slut',
  'whore',
];

export function moderateDisplayName(displayName: string): {
  approved: boolean;
  reason?: string;
} {
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 32) {
    return { approved: false, reason: 'displayName must be 2-32 characters' };
  }
  const lower = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      return { approved: false, reason: 'displayName failed profanity moderation' };
    }
  }
  return { approved: true };
}

/**
 * Runs a JS codeSnippet in an isolated Node vm context with zero host capabilities
 * and captures console.log output for AI question pipeline verification.
 */
export function executeCodeSnippetSandbox(
  codeSnippet: string,
  timeoutMs = 500,
): { ok: boolean; stdout: string; error?: string } {
  const lines: string[] = [];
  const sandbox = {
    console: {
      log: (...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      },
    },
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };

  try {
    const context = vm.createContext(sandbox);
    vm.runInContext(codeSnippet, context, { timeout: timeoutMs });
    return { ok: true, stdout: lines.join('\n').trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: lines.join('\n').trim(),
      error: err instanceof Error ? err.message : 'Sandbox execution failed',
    };
  }
}

export function renderAristotleTemplate(
  body: string,
  vars: Record<string, string | number>,
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : '',
  );
}
