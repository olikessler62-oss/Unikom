import type { ReactNode } from 'react';

import type { RunStatus } from '../api/types.js';

export function Notice({ kind, children }: { kind: 'error' | 'info' | 'warn'; children: ReactNode }) {
  return <div className={`notice notice--${kind}`}>{children}</div>;
}

export function Loading() {
  return <div className="empty">Wird geladen …</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}

const RUN_LABELS: Record<RunStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Wartet', tone: 'badge--muted' },
  RUNNING: { label: 'Läuft', tone: '' },
  SUCCESS: { label: 'Erfolgreich', tone: 'badge--good' },
  PARTIAL_SUCCESS: { label: 'Teilweise', tone: 'badge--warn' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'badge--bad' },
  CANCELLED: { label: 'Abgebrochen', tone: 'badge--muted' },
};

export function RunBadge({ status }: { status: RunStatus }) {
  const entry = RUN_LABELS[status] ?? { label: status, tone: 'badge--muted' };
  return <span className={`badge ${entry.tone}`}>{entry.label}</span>;
}

export function formatMoment(iso?: string): string {
  if (!iso) {
    return '—';
  }

  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) {
    return '—';
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const seconds = milliseconds / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

export function CheckField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="field">
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 600 }}>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}
