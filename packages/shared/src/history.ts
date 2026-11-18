export const HISTORY_KINDS = ['gift', 'danmu', 'guard', 'sc'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export type HistoryOutcome = 'added' | 'duplicate' | 'overlap' | 'expired';
export type HistoryCounts = Record<HistoryOutcome, number>;

export interface HistoryPlan {
  events: Record<HistoryKind, HistoryCounts>;
  sessions: { added: number; existing: number };
  exportedAt: number | null;
  from: number | null;
  to: number | null;
  retentionDays: number;
}

export interface HistoryPreview {
  token: string;
  filename: string;
  plan: HistoryPlan;
}
