import { StripeWebhookEventStatus } from '@prisma/client';

export interface StripeWebhookEventRecord {
  id: string;
  type: string;
  status: StripeWebhookEventStatus;
  commitmentId: string | null;
  summary: string | null;
  errorMessage: string | null;
  duplicateCount: number;
  receivedAt: Date;
  processedAt: Date | null;
  lastDuplicateAt: Date | null;
}

export interface StripeWebhookListFilters {
  status?: StripeWebhookEventStatus;
  type?: string;
  search?: string;
  limit: number;
}

export interface StripeWebhookStatusCounts {
  total: number;
  processed: number;
  failed: number;
  ignored: number;
  processing: number;
}

let sandboxMode = false;

export function setWebhookSandboxMode(enabled: boolean): void {
  sandboxMode = enabled;
}

export function isWebhookSandboxMode(): boolean {
  return sandboxMode;
}

function buildSeededSandboxEvents(): StripeWebhookEventRecord[] {
  const now = Date.now();
  return [
    {
      id: 'evt_3Q8mK9L2eZvKYlo21A9c8f10',
      type: 'checkout.session.completed',
      status: StripeWebhookEventStatus.PROCESSED,
      commitmentId: 'cm_py_2026_0941',
      summary: 'Activated commitment cm_py_2026_0941 after Setup Checkout completed',
      errorMessage: null,
      duplicateCount: 0,
      receivedAt: new Date(now - 6 * 60_000),
      processedAt: new Date(now - 6 * 60_000 + 142),
      lastDuplicateAt: null,
    },
    {
      id: 'evt_3Q8mJ4L2eZvKYlo20B7d2e84',
      type: 'setup_intent.succeeded',
      status: StripeWebhookEventStatus.PROCESSED,
      commitmentId: 'cm_py_2026_0941',
      summary: 'Attached payment method pm_1Q8mJ1 and captured deposit PaymentIntent pi_3Q8mJ2',
      errorMessage: null,
      duplicateCount: 1,
      receivedAt: new Date(now - 14 * 60_000),
      processedAt: new Date(now - 14 * 60_000 + 286),
      lastDuplicateAt: new Date(now - 13 * 60_000),
    },
    {
      id: 'evt_3Q8mA1L2eZvKYlo29F4a1102',
      type: 'payment_intent.payment_failed',
      status: StripeWebhookEventStatus.FAILED,
      commitmentId: 'cm_js_2026_0884',
      summary: 'Penalty retry #3 dispatch failed during database lock timeout',
      errorMessage: 'P2034: Transaction failed due to a write conflict or a deadlock on Commitment(cm_js_2026_0884)',
      duplicateCount: 2,
      receivedAt: new Date(now - 38 * 60_000),
      processedAt: new Date(now - 38 * 60_000 + 812),
      lastDuplicateAt: new Date(now - 31 * 60_000),
    },
    {
      id: 'evt_3Q8lZ2L2eZvKYlo27C109b44',
      type: 'payment_intent.succeeded',
      status: StripeWebhookEventStatus.PROCESSED,
      commitmentId: 'cm_ts_2026_0819',
      summary: 'Settled close penalty PaymentIntent pi_3Q8lYx and marked commitment CLOSED',
      errorMessage: null,
      duplicateCount: 0,
      receivedAt: new Date(now - 95 * 60_000),
      processedAt: new Date(now - 95 * 60_000 + 118),
      lastDuplicateAt: null,
    },
    {
      id: 'evt_3Q8lR8L2eZvKYlo24E33a719',
      type: 'customer.subscription.updated',
      status: StripeWebhookEventStatus.IGNORED,
      commitmentId: null,
      summary: 'Ignored unhandled Stripe event type customer.subscription.updated',
      errorMessage: null,
      duplicateCount: 0,
      receivedAt: new Date(now - 3 * 3_600_000),
      processedAt: new Date(now - 3 * 3_600_000 + 19),
      lastDuplicateAt: null,
    },
    {
      id: 'evt_3Q8lK0L2eZvKYlo21D88c503',
      type: 'payment_intent.payment_failed',
      status: StripeWebhookEventStatus.PROCESSED,
      commitmentId: 'cm_py_2026_0772',
      summary: 'Scheduled penalty retry attempt #2 (48h backoff) for commitment cm_py_2026_0772',
      errorMessage: null,
      duplicateCount: 0,
      receivedAt: new Date(now - 5 * 3_600_000),
      processedAt: new Date(now - 5 * 3_600_000 + 194),
      lastDuplicateAt: null,
    },
  ];
}

class SandboxWebhookStore {
  private readonly events = new Map<string, StripeWebhookEventRecord>();

  constructor() {
    for (const evt of buildSeededSandboxEvents()) {
      this.events.set(evt.id, evt);
    }
  }

  recordIfNew(eventId: string, type: string): boolean {
    if (this.events.has(eventId)) {
      return false;
    }
    this.events.set(eventId, {
      id: eventId,
      type,
      status: StripeWebhookEventStatus.PROCESSING,
      commitmentId: null,
      summary: null,
      errorMessage: null,
      duplicateCount: 0,
      receivedAt: new Date(),
      processedAt: null,
      lastDuplicateAt: null,
    });
    return true;
  }

  markDuplicate(eventId: string): void {
    const existing = this.events.get(eventId);
    if (!existing) return;
    existing.duplicateCount += 1;
    existing.lastDuplicateAt = new Date();
  }

  updateResult(
    eventId: string,
    data: {
      status: StripeWebhookEventStatus;
      commitmentId?: string | null;
      summary?: string | null;
      errorMessage?: string | null;
      processedAt?: Date;
    },
  ): void {
    const existing = this.events.get(eventId);
    if (!existing) return;
    existing.status = data.status;
    if (data.commitmentId !== undefined) existing.commitmentId = data.commitmentId;
    if (data.summary !== undefined) existing.summary = data.summary;
    if (data.errorMessage !== undefined) existing.errorMessage = data.errorMessage;
    existing.processedAt = data.processedAt ?? new Date();
  }

  list(filters: StripeWebhookListFilters): {
    events: StripeWebhookEventRecord[];
    counts: StripeWebhookStatusCounts;
  } {
    const all = [...this.events.values()].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );

    const counts: StripeWebhookStatusCounts = {
      total: all.length,
      processed: all.filter((e) => e.status === StripeWebhookEventStatus.PROCESSED).length,
      failed: all.filter((e) => e.status === StripeWebhookEventStatus.FAILED).length,
      ignored: all.filter((e) => e.status === StripeWebhookEventStatus.IGNORED).length,
      processing: all.filter((e) => e.status === StripeWebhookEventStatus.PROCESSING).length,
    };

    const searchTerm = filters.search?.trim().toLowerCase();
    const typeTerm = filters.type?.trim().toLowerCase();

    const filtered = all
      .filter((item) => {
        if (filters.status && item.status !== filters.status) return false;
        if (typeTerm && item.type.toLowerCase() !== typeTerm) return false;
        if (searchTerm) {
          const hay = [
            item.id,
            item.type,
            item.commitmentId ?? '',
            item.summary ?? '',
            item.errorMessage ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(searchTerm)) return false;
        }
        return true;
      })
      .slice(0, filters.limit);

    return { events: filtered, counts };
  }
}

export const sandboxWebhookStore = new SandboxWebhookStore();
