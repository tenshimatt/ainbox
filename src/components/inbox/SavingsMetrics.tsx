/**
 * SavingsMetrics — hours saved and money saved by AI-drafted replies.
 *
 * PRD §7.13 Dashboard / inbox view — ROI metrics derived from total sent
 * auto-replies. Assumes 4 min per email handled and $35/hr knowledge-worker cost.
 *
 * Purely presentational: receives the all-time sent draft count from the
 * server component (page.tsx) which fetches it under RLS.
 */

/** Average minutes saved per email handled by AI (industry benchmark). */
const MINUTES_PER_EMAIL = 4;

/** Knowledge-worker hourly rate used for money-saved calculation (USD). */
const HOURLY_RATE_USD = 35;

export type SavingsMetricsProps = {
  /** Total number of auto-replies sent (all-time, RLS-scoped to user). */
  sentDraftCount: number;
};

export function SavingsMetrics({ sentDraftCount }: SavingsMetricsProps) {
  const rawHours = (sentDraftCount * MINUTES_PER_EMAIL) / 60;
  const hoursSaved = Math.round(rawHours * 10) / 10;
  const moneySaved = Math.round(rawHours * HOURLY_RATE_USD);

  return (
    <div
      data-testid="savings-metrics"
      className="grid grid-cols-2 gap-3 w-full max-w-full"
      aria-label="Time and cost savings from AI replies"
    >
      <div
        data-testid="hours-saved-card"
        className="rounded-md border border-slate-200 bg-white px-4 py-3"
      >
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Hours saved
        </p>
        <p
          data-testid="hours-saved-value"
          className="mt-1 text-2xl font-bold text-slate-900"
          aria-label={`${hoursSaved} hours saved`}
        >
          {hoursSaved.toLocaleString()}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {sentDraftCount.toLocaleString()} emails &times; 4 min
        </p>
      </div>

      <div
        data-testid="money-saved-card"
        className="rounded-md border border-slate-200 bg-white px-4 py-3"
      >
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Money saved
        </p>
        <p
          data-testid="money-saved-value"
          className="mt-1 text-2xl font-bold text-slate-900"
          aria-label={`$${moneySaved} money saved`}
        >
          ${moneySaved.toLocaleString()}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          at ${HOURLY_RATE_USD}/hr knowledge-worker rate
        </p>
      </div>
    </div>
  );
}

export default SavingsMetrics;
