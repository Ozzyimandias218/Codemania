import React, { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  StripeWebhookEventLog,
  StripeWebhookEventStatus,
  StripeWebhookEventsResponse,
  api,
} from '../lib/api.ts';

type StatusFilter = 'ALL' | StripeWebhookEventStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PROCESSED', label: 'Processed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'IGNORED', label: 'Ignored' },
  { value: 'PROCESSING', label: 'Processing' },
];

const EVENT_TYPE_OPTIONS = [
  '',
  'setup_intent.succeeded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'customer.subscription.updated',
];

function formatDurationMs(receivedAt: string, processedAt: string | null): string {
  if (!processedAt) return 'Pending';
  const diff = new Date(processedAt).getTime() - new Date(receivedAt).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '-';
  if (diff < 1000) return `${diff} ms`;
  return `${(diff / 1000).toFixed(2)} s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatusCell({ status }: { status: StripeWebhookEventStatus }) {
  switch (status) {
    case 'PROCESSED':
      return (
        <span className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80] whitespace-nowrap">
          Processed
        </span>
      );
    case 'FAILED':
      return (
        <span className="text-xs font-semibold text-[#DC2626] dark:text-[#F87171] whitespace-nowrap">
          Failed
        </span>
      );
    case 'IGNORED':
      return (
        <span className="text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0] whitespace-nowrap">
          Ignored
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="text-xs font-semibold text-[#C2410C] dark:text-[#FB923C] whitespace-nowrap">
          Processing
        </span>
      );
  }
}

export function StripeWebhookLogsPanel() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [limit, setLimit] = useState<number>(50);

  const [data, setData] = useState<StripeWebhookEventsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListStripeWebhookEvents({
        status: statusFilter,
        type: eventTypeFilter || undefined,
        search: debouncedSearch || undefined,
        limit,
      });
      setData(response);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Failed to load Stripe webhook event logs.',
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, eventTypeFilter, debouncedSearch, limit]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const events: StripeWebhookEventLog[] = data?.events ?? [];
  const counts = data?.counts ?? {
    total: 0,
    processed: 0,
    failed: 0,
    ignored: 0,
    processing: 0,
  };

  const hasActiveFilters =
    statusFilter !== 'ALL' || eventTypeFilter !== '' || debouncedSearch !== '';

  function clearFilters() {
    setStatusFilter('ALL');
    setEventTypeFilter('');
    setSearchInput('');
    setDebouncedSearch('');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
            Stripe Webhook Event Logs
          </h2>
          <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] mt-1">
            Inspect incoming Stripe deliveries, idempotency deduplication counts, and processing outcomes served via{' '}
            <code className="font-mono text-[#1D2433] dark:text-[#E8EBF4]">
              /webhooks/stripe/events
            </code>
            .
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data?.source && (
            <span className="text-[11px] font-mono text-[#4B556B] dark:text-[#B4BCD0] whitespace-nowrap">
              Source: {data.source === 'postgresql' ? 'PostgreSQL' : 'Sandbox Memory'}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchLogs()}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#D5DCE8] dark:divide-[#363D57]">
        <div className="p-4">
          <div className="text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0]">Total Logged</div>
          <div className="text-xl font-bold text-[#1D2433] dark:text-[#E8EBF4] mt-1 tabular-nums">
            {counts.total}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0]">Processed</div>
          <div className="text-xl font-bold text-[#15803D] dark:text-[#4ADE80] mt-1 tabular-nums">
            {counts.processed}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0]">Failed</div>
          <div
            className={`text-xl font-bold mt-1 tabular-nums ${
              counts.failed > 0
                ? 'text-[#DC2626] dark:text-[#F87171]'
                : 'text-[#1D2433] dark:text-[#E8EBF4]'
            }`}
          >
            {counts.failed}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0]">
            Ignored / In Flight
          </div>
          <div className="text-xl font-bold text-[#4B556B] dark:text-[#B4BCD0] mt-1 tabular-nums">
            {counts.ignored + counts.processing}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] rounded-lg">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === opt.value
                  ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                  : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[240px]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search evt_id, type, commitment..."
            aria-label="Search webhook events"
            className="flex-1 max-w-xs min-w-[180px] px-3 py-1.5 text-xs text-[#1D2433] dark:text-[#E8EBF4] bg-[#F6F7FB] dark:bg-[#12141C] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
          />

          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            aria-label="Filter by Stripe event type"
            className="px-2.5 py-1.5 text-xs text-[#1D2433] dark:text-[#E8EBF4] bg-[#F6F7FB] dark:bg-[#12141C] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
          >
            <option value="">All event types</option>
            {EVENT_TYPE_OPTIONS.filter(Boolean).map((evtType) => (
              <option key={evtType} value={evtType}>
                {evtType}
              </option>
            ))}
          </select>

          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            aria-label="Maximum webhook logs to fetch"
            className="px-2.5 py-1.5 text-xs text-[#1D2433] dark:text-[#E8EBF4] bg-[#F6F7FB] dark:bg-[#12141C] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5] tabular-nums"
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl flex items-center justify-between gap-4">
          <div className="text-xs font-medium text-[#DC2626] dark:text-[#F87171]">{error}</div>
          <button
            type="button"
            onClick={() => void fetchLogs()}
            className="px-3 py-1.5 text-xs font-semibold text-[#DC2626] dark:text-[#F87171] bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-xs text-[#4B556B] dark:text-[#B4BCD0]">
          Loading Stripe webhook events...
        </div>
      ) : events.length === 0 ? (
        <div className="p-6 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl text-center space-y-2">
          <div className="text-sm font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
            {hasActiveFilters
              ? 'No Stripe webhook events match your active filters'
              : 'No Stripe webhook events recorded yet'}
          </div>
          <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] max-w-md mx-auto">
            {hasActiveFilters
              ? 'Try clearing your search query or switching back to All statuses.'
              : 'Incoming signed events delivered to POST /webhooks/stripe will appear here with their processing outcomes.'}
          </p>
          {hasActiveFilters && (
            <div className="pt-2">
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-1.5 text-xs font-semibold text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg whitespace-nowrap shrink-0"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-[#D5DCE8] dark:border-[#363D57] text-xs font-semibold text-[#4B556B] dark:text-[#B4BCD0] bg-[#EEF1F7] dark:bg-[#222638]">
                <th className="py-2.5 px-4 w-10" aria-label="Expand details" />
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Event Type & ID</th>
                <th className="py-2.5 px-3">Commitment</th>
                <th className="py-2.5 px-3">Summary / Error</th>
                <th className="py-2.5 px-4 text-right">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D5DCE8] dark:divide-[#363D57] text-xs">
              {events.map((evt) => {
                const isExpanded = expandedId === evt.id;
                return (
                  <React.Fragment key={evt.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                      className="hover:bg-[#F6F7FB] dark:hover:bg-[#222638] cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 pl-4 pr-1 font-mono text-[#4B556B] dark:text-[#B4BCD0]">
                        {isExpanded ? '-' : '+'}
                      </td>
                      <td className="py-2.5 px-3 align-middle">
                        <StatusCell status={evt.status} />
                      </td>
                      <td className="py-2.5 px-3 align-middle">
                        <div className="font-mono font-semibold text-[#1D2433] dark:text-[#E8EBF4]">
                          {evt.type}
                        </div>
                        <div className="font-mono text-[11px] text-[#4B556B] dark:text-[#B4BCD0] mt-0.5 tabular-nums">
                          {evt.id}
                          {evt.duplicateCount > 0 && (
                            <span className="ml-2 text-[#C2410C] dark:text-[#FB923C] font-medium">
                              · {evt.duplicateCount} duplicate{evt.duplicateCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-middle font-mono text-[#1D2433] dark:text-[#E8EBF4] tabular-nums">
                        {evt.commitmentId ?? '-'}
                      </td>
                      <td className="py-2.5 px-3 align-middle max-w-md">
                        {evt.errorMessage ? (
                          <div
                            className="text-[#DC2626] dark:text-[#F87171] truncate"
                            title={evt.errorMessage}
                          >
                            {evt.errorMessage}
                          </div>
                        ) : (
                          <div
                            className="text-[#4B556B] dark:text-[#B4BCD0] truncate"
                            title={evt.summary ?? undefined}
                          >
                            {evt.summary ?? '-'}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 align-middle text-right font-mono text-[#4B556B] dark:text-[#B4BCD0] tabular-nums whitespace-nowrap">
                        {formatTimestamp(evt.receivedAt)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#F6F7FB] dark:bg-[#12141C]">
                        <td
                          colSpan={6}
                          className="px-6 py-3.5 border-t border-[#D5DCE8] dark:border-[#363D57]"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                            <div>
                              <div className="text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0]">
                                Full Stripe Event ID
                              </div>
                              <div className="font-mono text-[#1D2433] dark:text-[#E8EBF4] mt-0.5 break-all">
                                {evt.id}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0]">
                                Commitment ID
                              </div>
                              <div className="font-mono text-[#1D2433] dark:text-[#E8EBF4] mt-0.5 break-all">
                                {evt.commitmentId ?? '-'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] font-medium text-[#4B556B] dark:text-[#B4BCD0]">
                                Processing Latency & Duplicate Hits
                              </div>
                              <div className="font-mono text-[#1D2433] dark:text-[#E8EBF4] mt-0.5 tabular-nums">
                                {formatDurationMs(evt.receivedAt, evt.processedAt)} ·{' '}
                                {evt.duplicateCount} duplicates
                                {evt.lastDuplicateAt
                                  ? ` (last ${formatTimestamp(evt.lastDuplicateAt)})`
                                  : ''}
                              </div>
                            </div>
                          </div>

                          {(evt.summary || evt.errorMessage) && (
                            <div className="mt-3 pt-2.5 border-t border-[#D5DCE8] dark:border-[#363D57] text-xs">
                              <span className="font-medium text-[#4B556B] dark:text-[#B4BCD0] mr-2">
                                {evt.errorMessage ? 'Error Detail:' : 'Outcome:'}
                              </span>
                              <span
                                className={
                                  evt.errorMessage
                                    ? 'text-[#DC2626] dark:text-[#F87171]'
                                    : 'text-[#1D2433] dark:text-[#E8EBF4]'
                                }
                              >
                                {evt.errorMessage ?? evt.summary}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
