/**
 * File: apps/web/src/features/admin/UsageTable.tsx
 * Purpose: The Admin → Usage table: Claude requests per user today and over the last 7 days, with
 *          who is at the daily limit (v1.0.2, ADR-0036). Counts only; no text.
 * Used by: app/(app)/admin/usage/page.tsx
 * Depends on: src/features/admin/usageTypes.ts
 * Architecture: docs/decisions/ADR-0036-daily-limit-and-usage-counts.md
 */
import type { UsageTableRow } from './usageTypes';

/** Props for UsageTable. */
export interface UsageTableProps {
  /** One row per account (most requests first). */
  rows: readonly UsageTableRow[];
  /** The daily limit in force (a row at or over it is marked). */
  limit: number;
}

/**
 * The usage table.
 *
 * @param props See UsageTableProps.
 * @returns The table section.
 * Rendered by: app/(app)/admin/usage/page.tsx
 */
export function UsageTable({ rows, limit }: UsageTableProps) {
  return (
    <section className="overflow-x-auto rounded-card border border-ui-border bg-ui-surface shadow-card">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-ui-border bg-ui-band text-[13px] text-ui-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 text-right font-semibold">Today</th>
            <th className="px-4 py-3 text-right font-semibold">Last 7 days</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ui-border">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-3 text-ui-muted">
                No accounts yet.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className="px-4 py-3 font-semibold text-ui-heading">{row.name}</td>
              <td className="px-4 py-3 text-ui-muted">{row.email}</td>
              <td className="px-4 py-3 text-right tabular-nums text-ui-text">
                {row.today}
                {/* Counts go past the limit: refused requests are counted too (ADR-0036). */}
                {row.today >= limit && (
                  <span className="ml-2 rounded-full bg-ui-warning-bg px-2 py-0.5 text-[13px] text-ui-warning">
                    at limit
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ui-text">{row.lastDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
