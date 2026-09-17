import type { ReactNode } from 'react';
interface StatusBadgeProps { tone?: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode; }
export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
