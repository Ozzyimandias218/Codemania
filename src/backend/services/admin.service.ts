import {
  AppealStatus,
  FinalSubmissionStatus,
  Prisma,
  QuestionOrigin,
  QuestionStatus,
  QuestionType,
} from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../config/prisma.ts';
import { auditLogRepository } from '../repositories/auditLog.repository.ts';
import { commitmentRepository } from '../repositories/commitment.repository.ts';
import { questionRepository } from '../repositories/question.repository.ts';
import { trackRepository } from '../repositories/track.repository.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.ts';
import { voiceService } from './tts/voice.service.ts';

export function validateQuestionContentRules(input: {
  type: QuestionType;
  options?: string[] | null;
  answer: string;
  explanation: string;
  origin: QuestionOrigin;
  sourceUrl?: string | null;
  license?: string | null;
}) {
  if (!input.explanation || input.explanation.trim().length === 0) {
    throw new BadRequestError('explanation must be non-empty');
  }

  if (input.type === QuestionType.MULTIPLE_CHOICE) {
    if (!Array.isArray(input.options) || input.options.length !== 4) {
      throw new BadRequestError('MULTIPLE_CHOICE questions must have exactly 4 options');
    }
    const idx = Number(input.answer);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) {
      throw new BadRequestError('MULTIPLE_CHOICE answer must be a valid option index ("0".."3")');
    }
  }

  if (input.origin === QuestionOrigin.WEB) {
    if (!input.sourceUrl || input.sourceUrl.trim().length === 0) {
      throw new BadRequestError('WEB questions require sourceUrl');
    }
    if (!input.license || input.license.trim().length === 0) {
      throw new BadRequestError('WEB questions require license');
    }
  }
}

export class AdminService {
  async listQuestions(filters: {
    status?: QuestionStatus;
    origin?: QuestionOrigin;
    levelId?: string;
  }) {
    return questionRepository.listForAdmin({
      ...filters,
      isLatest: true,
    });
  }

  async createQuestion(
    actorUserId: string,
    input: {
      levelId: string;
      type: QuestionType;
      prompt: string;
      codeSnippet?: string | null;
      spokenText?: string | null;
      options?: string[] | null;
      answer: string;
      explanation: string;
      origin: QuestionOrigin;
      sourceUrl?: string | null;
      license?: string | null;
      status?: QuestionStatus;
    },
  ) {
    const level = await trackRepository.findLevelById(input.levelId);
    if (!level) throw new NotFoundError('Level not found');

    validateQuestionContentRules(input);

    // WEB questions ALWAYS start as DRAFT regardless of requested initial status
    const initialStatus =
      input.origin === QuestionOrigin.WEB
        ? QuestionStatus.DRAFT
        : input.status ?? QuestionStatus.DRAFT;

    const created = await prisma.$transaction(async (tx) => {
      const q = await tx.question.create({
        data: {
          levelId: input.levelId,
          questionGroupId: crypto.randomUUID(),
          type: input.type,
          prompt: input.prompt.trim(),
          codeSnippet: input.codeSnippet ?? null,
          spokenText: input.spokenText ?? null,
          options:
            input.type === QuestionType.MULTIPLE_CHOICE && input.options
              ? input.options
              : Prisma.JsonNull,
          answer: input.answer.trim(),
          explanation: input.explanation.trim(),
          origin: input.origin,
          sourceUrl: input.sourceUrl ?? null,
          license: input.license ?? null,
          status: initialStatus,
          version: 1,
          isLatest: true,
          createdById: actorUserId,
          reviewedById: initialStatus === QuestionStatus.APPROVED ? actorUserId : null,
          reviewedAt: initialStatus === QuestionStatus.APPROVED ? new Date() : null,
        },
      });

      await auditLogRepository.create(
        {
          actorUserId,
          entityType: 'Question',
          entityId: q.id,
          action: 'CREATE',
          changes: { status: q.status, origin: q.origin, version: q.version },
        },
        tx,
      );

      return q;
    });

    if (created.status === QuestionStatus.APPROVED) {
      await voiceService.queueVoiceForApprovedQuestion(created);
    }

    return created;
  }

  /**
   * Editing an approved question creates a new version (version + 1),
   * supersedes the previous version, records AuditLog, and re-queues voice generation.
   */
  async editQuestion(
    actorUserId: string,
    questionId: string,
    updates: {
      prompt?: string;
      codeSnippet?: string | null;
      spokenText?: string | null;
      options?: string[] | null;
      answer?: string;
      explanation?: string;
      sourceUrl?: string | null;
      license?: string | null;
      reason?: string;
    },
  ) {
    const existing = await questionRepository.findById(questionId);
    if (!existing) throw new NotFoundError('Question not found');

    const merged = {
      type: existing.type,
      prompt: updates.prompt ?? existing.prompt,
      codeSnippet: updates.codeSnippet !== undefined ? updates.codeSnippet : existing.codeSnippet,
      spokenText: updates.spokenText !== undefined ? updates.spokenText : existing.spokenText,
      options:
        updates.options !== undefined
          ? updates.options
          : (existing.options as string[] | null),
      answer: updates.answer ?? existing.answer,
      explanation: updates.explanation ?? existing.explanation,
      origin: existing.origin,
      sourceUrl: updates.sourceUrl !== undefined ? updates.sourceUrl : existing.sourceUrl,
      license: updates.license !== undefined ? updates.license : existing.license,
    };

    validateQuestionContentRules(merged);

    if (existing.status === QuestionStatus.APPROVED) {
      const nextVersion = await prisma.$transaction(async (tx) => {
        await questionRepository.markSuperseded(existing.id, tx);

        const created = await tx.question.create({
          data: {
            levelId: existing.levelId,
            questionGroupId: existing.questionGroupId,
            type: merged.type,
            prompt: merged.prompt.trim(),
            codeSnippet: merged.codeSnippet,
            spokenText: merged.spokenText,
            options:
              merged.type === QuestionType.MULTIPLE_CHOICE && merged.options
                ? merged.options
                : Prisma.JsonNull,
            answer: merged.answer.trim(),
            explanation: merged.explanation.trim(),
            origin: merged.origin,
            sourceUrl: merged.sourceUrl,
            license: merged.license,
            status: QuestionStatus.APPROVED,
            version: existing.version + 1,
            isLatest: true,
            createdById: existing.createdById,
            reviewedById: actorUserId,
            reviewedAt: new Date(),
          },
        });

        await tx.reviewQueueItem.updateMany({
          where: { questionId: existing.id },
          data: { questionId: created.id },
        });

        await auditLogRepository.create(
          {
            actorUserId,
            entityType: 'Question',
            entityId: created.id,
            action: 'NEW_VERSION',
            reason: updates.reason ?? null,
            changes: {
              previousQuestionId: existing.id,
              previousVersion: existing.version,
              newVersion: created.version,
              updates,
            },
          },
          tx,
        );

        return created;
      });

      await voiceService.queueVoiceForApprovedQuestion(nextVersion);
      return nextVersion;
    }

    // Editing a DRAFT or REJECTED question updates in-place with audit trail
    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.question.update({
        where: { id: existing.id },
        data: {
          prompt: merged.prompt.trim(),
          codeSnippet: merged.codeSnippet,
          spokenText: merged.spokenText,
          options:
            merged.type === QuestionType.MULTIPLE_CHOICE && merged.options
              ? merged.options
              : Prisma.JsonNull,
          answer: merged.answer.trim(),
          explanation: merged.explanation.trim(),
          sourceUrl: merged.sourceUrl,
          license: merged.license,
        },
      });

      await auditLogRepository.create(
        {
          actorUserId,
          entityType: 'Question',
          entityId: q.id,
          action: 'EDIT_DRAFT',
          reason: updates.reason ?? null,
          changes: { updates },
        },
        tx,
      );

      return q;
    });

    return updated;
  }

  async reviewQuestion(
    actorUserId: string,
    questionId: string,
    input: { decision: 'APPROVED' | 'REJECTED'; reason: string },
  ) {
    const existing = await questionRepository.findById(questionId);
    if (!existing) throw new NotFoundError('Question not found');

    const status =
      input.decision === 'APPROVED' ? QuestionStatus.APPROVED : QuestionStatus.REJECTED;

    const updated = await prisma.$transaction(async (tx) => {
      const q = await questionRepository.updateReviewStatus(
        existing.id,
        {
          status,
          rejectionReason: status === QuestionStatus.REJECTED ? input.reason : null,
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
        tx,
      );

      await auditLogRepository.create(
        {
          actorUserId,
          entityType: 'Question',
          entityId: q.id,
          action: status === QuestionStatus.APPROVED ? 'APPROVE' : 'REJECT',
          reason: input.reason,
          changes: { fromStatus: existing.status, toStatus: status },
        },
        tx,
      );

      return q;
    });

    if (updated.status === QuestionStatus.APPROVED) {
      await voiceService.queueVoiceForApprovedQuestion(updated);
    }

    return updated;
  }

  async listAuditLogs(limit = 100) {
    return auditLogRepository.listRecent(limit);
  }

  async listFinalSubmissions(status?: FinalSubmissionStatus) {
    return commitmentRepository.listFinalSubmissions(status);
  }

  async reviewFinalSubmission(
    actorUserId: string,
    submissionId: string,
    input: {
      decision: 'APPROVED' | 'REJECTED';
      reviewNotes: string;
      resolveAppealId?: string;
    },
  ) {
    const sub = await commitmentRepository.findFinalSubmissionById(submissionId);
    if (!sub) throw new NotFoundError('Final submission not found');

    const now = new Date();
    const newStatus =
      input.decision === 'APPROVED'
        ? FinalSubmissionStatus.APPROVED
        : FinalSubmissionStatus.REJECTED;

    return prisma.$transaction(async (tx) => {
      const updated = await commitmentRepository.updateFinalSubmission(
        sub.id,
        {
          status: newStatus,
          reviewerId: actorUserId,
          reviewNotes: input.reviewNotes,
          reviewedAt: now,
        },
        tx,
      );

      if (newStatus === FinalSubmissionStatus.APPROVED && !sub.commitment.finalPassedAt) {
        await commitmentRepository.update(
          sub.commitmentId,
          { finalPassedAt: now },
          tx,
        );
      }

      if (input.resolveAppealId) {
        await commitmentRepository.resolveAppeal(
          input.resolveAppealId,
          {
            status:
              input.decision === 'APPROVED'
                ? AppealStatus.APPROVED
                : AppealStatus.REJECTED,
            adminDecisionNotes: input.reviewNotes,
            decidedById: actorUserId,
          },
          tx,
        );

        const remainingPending = await commitmentRepository.countPendingAppeals(
          sub.commitmentId,
          tx,
        );
        if (remainingPending === 0) {
          await commitmentRepository.update(
            sub.commitmentId,
            { hasActiveAppeal: false },
            tx,
          );
        }
      }

      await auditLogRepository.create(
        {
          actorUserId,
          entityType: 'FinalSubmission',
          entityId: sub.id,
          action: `REVIEW_${newStatus}`,
          reason: input.reviewNotes,
          changes: { fromStatus: sub.status, toStatus: newStatus },
        },
        tx,
      );

      return updated;
    });
  }

  async voidPenalty(
    actorUserId: string,
    commitmentId: string,
    penaltyId: string,
    reason: string,
  ) {
    const penalty = await commitmentRepository.findPenaltyById(penaltyId);
    if (!penalty || penalty.commitmentId !== commitmentId) {
      throw new NotFoundError('Penalty not found for commitment');
    }
    if (penalty.voidedAt) {
      throw new ConflictError('Penalty is already voided');
    }

    const updated = await commitmentRepository.voidPenalty(penalty.id, actorUserId, reason);
    await auditLogRepository.create({
      actorUserId,
      entityType: 'CommitmentPenalty',
      entityId: penalty.id,
      action: 'VOID_PENALTY',
      reason,
      changes: { commitmentId, amountCents: penalty.amountCents, type: penalty.type },
    });
    return updated;
  }
}

export const adminService = new AdminService();
