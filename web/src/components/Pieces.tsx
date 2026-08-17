import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { RunStatus } from '../api/types.js';
import { locale } from '../i18n/texts.js';
import { useText } from '../i18n/useText.js';

/** Der Anschluss in der Kopfzeile, in den Ansichten ihre Knöpfe hängen. */
export const HEADER_ACTIONS = 'header-actions';

/**
 * Ein Knopf, der in die Kopfzeile gehört, aber tief darunter entsteht.
 *
 * „Zurück zur Historie" gehört neben die Überschrift — inhaltlich zum Kopf, im
 * Bauwerk aber drei Ebenen tiefer, in der Ansicht eines einzelnen Laufs. Statt
 * den Zustand nach oben zu reichen und durch drei Bildschirme zurück, hängt der
 * Knopf sich dorthin, wo er hingehört. Die Ansicht behält ihn; nur gezeichnet
 * wird er woanders.
 *
 * Das Ziel steht erst nach dem ersten Durchlauf fest, deshalb der Umweg über
 * den Zustand: Beim ersten Zeichnen gibt es die Kopfzeile im Baum noch nicht.
 */
export function HeaderAction({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(HEADER_ACTIONS));
  }, []);

  return target ? createPortal(children, target) : null;
}

export type Tone = 'error' | 'info' | 'warn';

const TONE_KEYS = {
  info: 'piece.tone.info',
  warn: 'piece.tone.warn',
  error: 'piece.tone.error',
} as const;

/**
 * Eine Meldung — immer als eigenes Fenster in der Mitte des Bildschirms.
 *
 * Vorher stand sie als Streifen irgendwo auf der Seite. Das ging gut, solange
 * man hinsah; eine Fehlermeldung am Fuß eines langen Formulars hat aber schon
 * mancher übersehen und danach gerätselt, warum nichts gespeichert wurde. Ein
 * Fenster in der Mitte lässt sich nicht übersehen und muss weggeklickt werden —
 * bei einer Meldung ist genau das die Absicht.
 *
 * Sie schließt sich und kommt nicht von selbst wieder: Wer sie gelesen hat, ist
 * fertig mit ihr.
 */
export function Notice({ kind, children }: { kind: Tone; children: ReactNode }) {
  const t = useText();
  const [open, setOpen] = useState(true);

  if (!open) {
    return null;
  }

  return (
    <Modal tone={kind} title={t(TONE_KEYS[kind])} onClose={() => setOpen(false)}>
      {children}
    </Modal>
  );
}

/**
 * Ein ruhender Erklärtext.
 *
 * Er sagt dasselbe wie eine Meldung, aber er ist kein Ereignis — er gilt immer.
 * Deshalb springt er nicht auf, sondern wartet hinter einem kleinen runden Knopf
 * neben dem Bedienelement, um das es geht. Wer die Regel kennt, sieht ein
 * Zeichen; wer sie nicht kennt, ist einen Klick davon entfernt.
 */
export function Hint({
  kind = 'info',
  title,
  children,
}: {
  kind?: Tone;
  /** Überschrift des Fensters; ohne Angabe die des Tonfalls. */
  title?: string;
  children: ReactNode;
}) {
  const t = useText();
  const [open, setOpen] = useState(false);
  const heading = title ?? t(TONE_KEYS[kind]);

  return (
    <>
      <button
        type="button"
        className={`hint-button hint-button--${kind}`}
        aria-label={heading}
        title={heading}
        onClick={() => setOpen(true)}
      >
        !
      </button>

      {open && (
        <Modal tone={kind} title={heading} onClose={() => setOpen(false)}>
          {children}
        </Modal>
      )}
    </>
  );
}

export function Loading() {
  const t = useText();
  return <div className="empty">{t('piece.loading')}</div>;
}

/**
 * Ein kleiner runder Knopf neben einem Eingabefeld. Er trägt die Erklärung,
 * ohne dass sie dauerhaft Platz nimmt: eine Regel, die man einmal versteht,
 * muss nicht bei jedem Bearbeiten wieder mitgelesen werden.
 */
export function InfoButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="info-button" aria-label={label} title={label} onClick={onClick}>
      i
    </button>
  );
}

/**
 * Ein Fenster über der Seite. Escape und ein Klick daneben schließen es — beides
 * erwartet man, und ein Fenster, das nur einen Knopf kennt, hält fest.
 */
export function Modal({
  title,
  tone,
  ownActions = false,
  onClose,
  children,
}: {
  title: string;
  /** Färbt Überschrift und Rand; ohne Angabe ein gewöhnliches Fenster. */
  tone?: Tone;
  /**
   * Ob der Inhalt seine eigenen Knöpfe mitbringt.
   *
   * Ein Fenster, das nur etwas mitteilt, braucht genau einen Ausgang, und den
   * stellt es selbst. Ein Formular bringt seine Knöpfe mit — dort stand
   * „Schließen" als dritter neben „Anlegen" und „Abbrechen" und tat dasselbe
   * wie der zweite. Escape und der Klick daneben bleiben in beiden Fällen.
   */
  ownActions?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const t = useText();

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" onClick={onClose}>
      <div
        className={tone ? `card modal__box modal__box--${tone}` : 'card modal__box'}
        role={tone === 'error' || tone === 'warn' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        // Sonst schlüge jeder Klick im Fenster bis zum Hintergrund durch und
        // schlösse es — auch der auf ein Wort im Text.
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <div className="prose">{children}</div>

        {!ownActions && (
          <div className="row" style={{ marginTop: '1.2rem' }}>
            <button className="secondary" autoFocus onClick={onClose}>
              {t('piece.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}

const RUN_TONES: Record<RunStatus, string> = {
  PENDING: 'badge--muted',
  RUNNING: '',
  SUCCESS: 'badge--good',
  PARTIAL_SUCCESS: 'badge--warn',
  FAILED: 'badge--bad',
  CANCELLED: 'badge--muted',
};

export function RunBadge({ status }: { status: RunStatus }) {
  const t = useText();
  return <span className={`badge ${RUN_TONES[status] ?? 'badge--muted'}`}>{t(`run.${status}`)}</span>;
}

export function formatMoment(iso?: string): string {
  if (!iso) {
    return '—';
  }

  return new Date(iso).toLocaleString(locale(), {
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
  explain,
  action,
  children,
}: {
  label: string;
  /** Erklärung unter dem Feld — für einen kurzen Nachsatz. */
  hint?: ReactNode;
  /**
   * Erklärung hinter einem Knopf neben dem Feld.
   *
   * Zwei Wege für dasselbe, und die Wahl ist keine Geschmacksfrage: Unter dem
   * Feld liest man den Satz jedes Mal mit, ob man ihn braucht oder nicht, und
   * jede Zeile macht die Fläche höher. Hinter dem Knopf ist er einen Klick
   * entfernt und sonst aus dem Weg. Was eine Regel erklärt, die man einmal
   * versteht, gehört dorthin.
   */
  explain?: ReactNode;
  /**
   * Ein Knopf, der auf dieses Feld wirkt — ein Verzeichnis aussuchen etwa.
   *
   * Er steht direkt neben dem Feld und nicht in einer Zeile darunter. Ein Knopf
   * darunter gehört optisch zu nichts: Stehen mehrere Felder untereinander, ist
   * nicht mehr zu sehen, welcher Knopf welches Feld meint. Vor dem Erklärknopf,
   * wo es einen gibt — der gehört zum Feld als Ganzem, dieser zu seinem Inhalt.
   */
  action?: ReactNode;
  children: ReactNode;
}) {
  const beside = Boolean(explain) || Boolean(action);

  return (
    <div className="field">
      <label>{label}</label>
      {beside ? (
        <div className="field__row">
          {children}
          {action}
          {explain && <Hint title={label}>{explain}</Hint>}
        </div>
      ) : (
        children
      )}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

/**
 * Der quadratische Knopf neben einem Feld.
 *
 * Quadratisch und so hoch wie das Feld, damit Ober- und Unterkante bündig
 * bleiben — ein Knopf, der einen Hauch übersteht, sieht aus wie ein Versehen,
 * und genau das ist es dann auch.
 */
export function FieldButton({
  title,
  disabled,
  onClick,
  children,
}: {
  /** Was er tut, als Satz — er trägt keine Beschriftung, nur ein Zeichen. */
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="field-button" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Ein Ordner, als Zeichen für „hier ein Verzeichnis aussuchen". */
export function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2c.5 0 1 .24 1.3.64l1 1.36h7.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

export function CheckField({
  label,
  hint,
  hintInline = false,
  explain,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  /**
   * Ob der Hinweis neben die Beschriftung gehört statt darunter.
   *
   * Ein kurzer Nachsatz kostet unter der Zeile eine eigene Zeile und macht das
   * Panel höher, obwohl rechts daneben Platz frei ist. In Klammern dahinter
   * liest er sich als das, was er ist: eine Fußnote zum Haken, kein eigener
   * Gedanke. Für längere Erklärungen bleibt die Zeile darunter richtig.
   */
  hintInline?: boolean;
  /** Erklärung hinter einem Knopf neben der Beschriftung — siehe `Field`. */
  explain?: ReactNode;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="field">
      <label className="check">
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
        {hint && hintInline && <span className="check__aside">({hint})</span>}
        {explain && <Hint title={label}>{explain}</Hint>}
      </label>
      {hint && !hintInline && <div className="field__hint">{hint}</div>}
    </div>
  );
}

/** Sekunden in Stunden, Minuten, Sekunden — als Text, damit ein Feld leer sein darf. */
function splitDuration(seconds: number): { hours: string; minutes: string; seconds: string } {
  const total = Math.max(0, Math.floor(seconds));

  return {
    hours: String(Math.floor(total / 3600)),
    minutes: String(Math.floor((total % 3600) / 60)),
    seconds: String(total % 60),
  };
}

function joinDuration(parts: { hours: string; minutes: string; seconds: string }): number {
  const number = (value: string) => Math.max(0, Math.floor(Number(value) || 0));
  return number(parts.hours) * 3600 + number(parts.minutes) * 60 + number(parts.seconds);
}

/**
 * Eine Dauer, eingestellt in Stunden, Minuten und Sekunden.
 *
 * Nicht `input type="time"`, obwohl das die naheliegende Wahl wäre: Das Bauteil
 * meint eine Uhrzeit und kann deshalb nicht über 23:59:59 hinaus. Eine Dauer
 * kann das — „nur Dateien, die mindestens zwei Tage liegen" ist eine
 * Archivregel, die es gibt. Ein Job mit einem größeren Wert wäre in einer
 * Uhrzeit-Auswahl nicht darstellbar und beim ersten Anfassen still gekürzt.
 *
 * Die drei Felder halten ihren eigenen Zustand, statt ihn bei jedem Zeichen aus
 * der Summe neu zu bilden. Sonst würde aus getippten „90" Minuten sofort „1 Std.
 * 30 Min.", und der Cursor spränge mitten im Tippen weg.
 */
export function DurationField({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange(seconds: number): void;
}) {
  const [parts, setParts] = useState(() => splitDuration(seconds));

  // Nur wenn der Wert von außen kommt — ein anderer Job, ein Zurücksetzen.
  useEffect(() => {
    setParts((current) => (joinDuration(current) === seconds ? current : splitDuration(seconds)));
  }, [seconds]);

  function set(patch: Partial<typeof parts>): void {
    const next = { ...parts, ...patch };
    setParts(next);
    onChange(joinDuration(next));
  }

  const fields: { key: keyof typeof parts; unit: string; label: string }[] = [
    { key: 'hours', unit: 'Std.', label: 'Stunden' },
    { key: 'minutes', unit: 'Min.', label: 'Minuten' },
    { key: 'seconds', unit: 'Sek.', label: 'Sekunden' },
  ];

  return (
    <div className="duration">
      {fields.map((field) => (
        <div key={field.key} className="duration__part">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={field.label}
            value={parts[field.key]}
            onChange={(event) => set({ [field.key]: event.target.value })}
            // Ein leeres Feld beim Verlassen wieder auf null: „   " ist keine Dauer.
            onBlur={() => set({ [field.key]: String(Number(parts[field.key]) || 0) })}
          />
          <span className="duration__unit">{field.unit}</span>
        </div>
      ))}
    </div>
  );
}
