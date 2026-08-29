import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as Tastenereignis,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { RunStatus } from '../api/types.js';
import { locale } from '../i18n/texts.js';
import { useText } from '../i18n/useText.js';
import { alsEineZeile } from './Einzeiler.js';

/** Der Anschluss in der Kopfzeile, in den Ansichten ihre Knöpfe hängen. */
export const HEADER_ACTIONS = 'header-actions';

/**
 * Ein Knopf, der in den Rahmen gehört, aber tief darin entsteht.
 *
 * „Zurück zur Historie" gehört neben die Überschrift, „Speichern" unter die
 * Fläche — inhaltlich zum Rahmen, im Bauwerk aber drei Ebenen tiefer, in der
 * Ansicht eines einzelnen Laufs oder Mandanten. Statt den Zustand nach oben zu
 * reichen und durch drei Bildschirme zurück, hängt der Knopf sich dorthin, wo
 * er hingehört. Die Ansicht behält ihn; nur gezeichnet wird er woanders.
 *
 * Das Ziel steht erst nach dem ersten Durchlauf fest, deshalb der Umweg über
 * den Zustand: Beim ersten Zeichnen gibt es den Rahmen im Baum noch nicht.
 */
function Anschluss({ ziel, children }: { ziel: string; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(ziel));
  }, [ziel]);

  return target ? createPortal(children, target) : null;
}

/** Ein Knopf neben der Überschrift. */
export function HeaderAction({ children }: { children: ReactNode }) {
  return <Anschluss ziel={HEADER_ACTIONS}>{children}</Anschluss>;
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
    <WF_Modal tone={kind} title={t(TONE_KEYS[kind])} onClose={() => setOpen(false)}>
      {children}
    </WF_Modal>
  );
}

/**
 * Ein ruhender Erklärtext.
 *
 * Er sagt dasselbe wie eine Meldung, aber er ist kein Ereignis — er gilt immer.
 * Deshalb springt er nicht auf, sondern wartet hinter einem kleinen Knopf neben
 * dem Bedienelement, um das es geht. Wer die Regel kennt, sieht ein
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
        <WF_Modal tone={kind} title={heading} onClose={() => setOpen(false)}>
          {children}
        </WF_Modal>
      )}
    </>
  );
}

export function Loading() {
  const t = useText();
  return <div className="empty">{t('piece.loading')}</div>;
}

/**
 * Ein kleiner Knopf neben einem Eingabefeld. Er trägt die Erklärung,
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
export function WF_Modal({
  title,
  tone,
  ownActions = false,
  schmal = false,
  breit = false,
  geteilt = false,
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
  /**
   * Ob das Fenster nur halb so breit steht.
   *
   * Für Inhalte, die von Haus aus schmal sind — eine Spalte aus Endungen etwa.
   * Die volle Breite ist für Text und Formulare gemessen; eine Liste kurzer
   * Wörter füllt davon keine Hälfte, und der Rest wäre leere Fläche um den
   * eigentlichen Inhalt herum.
   */
  schmal?: boolean;
  /**
   * Ob das Fenster die Breite eines Bildschirms nimmt.
   *
   * Für Fenster, die selbst ein Bildschirm sind - der Mandant etwa, der neun
   * Blätter trägt und darunter Tabellen. Die gewöhnliche Breite ist für Text
   * und Formulare gemessen; eine Tabelle mit sechs Spalten fängt darin an, sich
   * zu winden.
   */
  breit?: boolean;
  /**
   * Ob Kopf und Knopfleiste stehen bleiben und nur die Mitte rollt.
   *
   * Für Fenster, die eine Liste zeigen: Wer unten sucht, verliert sonst den
   * Pfad aus dem Blick, und der Knopf, mit dem er übernimmt, wandert aus dem
   * Bild. Der Inhalt bestimmt dabei selbst, was die Mitte ist — er umfasst sie
   * mit `.fenster__mitte`.
   */
  geteilt?: boolean;
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
        className={[
          'card',
          'modal__box',
          tone ? `modal__box--${tone}` : '',
          schmal ? 'modal__box--schmal' : '',
          breit ? 'modal__box--breit' : '',
          geteilt ? 'modal__box--geteilt' : '',
        ].join(' ')}
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
          <div className="row modal__actions">
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
    return '-';
  }

  return new Date(iso).toLocaleString(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Eine Byte-Zahl, wie ein Mensch sie liest.
 *
 * Bis tausend Bytes die Zahl selbst — „847 B" sagt mehr als „0,8 kB". Darüber
 * eine Stelle hinter dem Komma: Ob eine Lieferung 12,4 oder 12,7 MB hat, ist
 * eine Auskunft; die dritte Nachkommastelle ist keine mehr.
 *
 * Hier und nicht im Laufbildschirm, wo sie herkommt: Es gibt inzwischen einen
 * zweiten Ort, der Dateigrößen anzeigt, und zwei Fassungen würden sich früher
 * oder später darin uneins, wo das Komma steht.
 */
export function formatSize(bytes?: number): string {
  if (bytes === undefined) {
    return '-';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) {
    return '-';
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const seconds = milliseconds / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function Field({
  label,
  pflicht,
  hint,
  explain,
  action,
  children,
}: {
  label: string;
  /**
   * Ob dieses Feld ausgefüllt sein muss.
   *
   * Als Zeichen am Etikett und nicht als Farbe am leeren Feld: Rot am Feld
   * hieße „falsch", und leer ist nicht falsch — es ist unfertig. Der Stern sagt,
   * was verlangt wird, **bevor** jemand anfängt, statt es beim Speichern
   * vorzuwerfen.
   */
  pflicht?: boolean;
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
      <label>
        {label}
        {pflicht && (
          <span className="field__pflicht" title="Pflichtangabe">
            *
          </span>
        )}
      </label>
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

/**
 * Ein Feld für eine Angabe, die mehr als eine Zeile sein darf.
 *
 * ```text
 * Mandanten-Beschreibung
 * ┌──────────────────────────────────────────┬───┐
 * │ Norddeutsche Handels AG …                │ ✎ │
 * ├──────────────────────────────────────────┴───┘
 * │ Norddeutsche Handels AG                  │
 * │ Ansprechpartner: Frau Ohlsen             │   das Fenster, unmittelbar
 * │ Abrechnung monatlich                     │   unter dem Feld
 * │                          [ OK ] [ Abbr. ]│
 * └──────────────────────────────────────────┘
 * ```
 *
 * ## Warum die Zeile nicht beschriftet wird
 *
 * Ein `input` **kann** keine zweite Zeile tragen: Der Browser streicht
 * Zeilenumbrüche aus seinem Wert, sobald ihn jemand anfasst. Ein Feld, in das
 * man hier tippt, hätte den Rest des Textes beim ersten Zeichen fortgeworfen —
 * und zwar den unsichtbaren Teil, also den, dessen Verlust niemand bemerkt.
 *
 * Die Zeile zeigt deshalb nur und nimmt nichts an. Geschrieben wird im Fenster,
 * und dorthin führen beide Wege, die man ausprobiert: der Stift daneben und ein
 * Klick auf die Zeile selbst.
 *
 * ## Warum das Fenster unter dem Feld steht und nicht in der Mitte
 *
 * Es bearbeitet **dieses** Feld und nicht die Seite. Ein Fenster in der Mitte
 * des Bildschirms verdeckt, wovon es handelt, und lässt offen, welche der
 * Angaben man gerade ändert — bei „Name" und „Beschreibung" nebeneinander ist
 * das eine Frage, die man sich stellt. Unter dem Feld beantwortet die Stelle
 * sie.
 *
 * Es ist so breit wie die Zeile darüber und höher als sie. Die Breite ist die
 * Zusage: Was hier hineinpasst, passt auch dorthin — nur eben in mehr Zeilen.
 *
 * ## Die drei Ausgänge, und warum nur einer verwirft
 *
 * `OK` übernimmt, `Abbrechen` und `Escape` verwerfen. Ein Klick **daneben**
 * übernimmt ebenfalls: Das Fenster steht mitten im Formular, und wer daneben
 * klickt, wollte meist zum nächsten Feld — nicht seinen Text fortwerfen.
 * Verwerfen soll man sagen müssen; das ist die Richtung, in der ein Versehen
 * nichts kostet.
 */
export function Memofeld({
  label,
  value,
  placeholder,
  explain,
  onChange,
}: {
  label: string;
  value: string;
  /** Beispieltext — in der Zeile und im Fenster derselbe. */
  placeholder?: string;
  /** Erklärung hinter einem Knopf neben dem Feld — siehe `Field`. */
  explain?: ReactNode;
  onChange(text: string): void;
}) {
  const [offen, setOffen] = useState(false);
  const [entwurf, setEntwurf] = useState(value);
  const fenster = useRef<HTMLDivElement>(null);

  /*
   * Was beim Schließen gilt, wird beim Schließen gelesen.
   *
   * Der Horcher auf den Klick daneben wird einmal angemeldet, wenn das Fenster
   * aufgeht. Läse er den Entwurf aus dem Abschluss von damals, übernähme er den
   * Stand vom Öffnen — und jedes getippte Zeichen wäre fort. Ihn bei jedem
   * Zeichen neu anzumelden wäre die andere Lösung; sie kostet einen Horcher pro
   * Tastendruck und geht schief, sobald noch etwas anderes davon abhängt.
   */
  const stand = useRef({ entwurf, onChange });
  stand.current = { entwurf, onChange };

  const vorschau = alsEineZeile(value);

  function oeffne(): void {
    setEntwurf(value);
    setOffen(true);
  }

  function uebernimm(): void {
    setOffen(false);
    stand.current.onChange(stand.current.entwurf);
  }

  /* Zeile und Stift tun dasselbe: auf und wieder zu, und zu heißt übernehmen. */
  function umschalten(): void {
    if (offen) {
      uebernimm();
    } else {
      oeffne();
    }
  }

  useEffect(() => {
    if (!offen) {
      return;
    }

    function daneben(ereignis: PointerEvent): void {
      /*
       * „Daneben" ist außerhalb der ganzen Zeile und nicht nur des Fensters:
       * Der Stift steht in derselben Zeile, und ein Klick auf ihn schlösse
       * sonst erst hier und öffnete gleich danach wieder.
       */
      const zeile = fenster.current?.parentElement;

      if (zeile && !zeile.contains(ereignis.target as Node)) {
        uebernimm();
      }
    }

    document.addEventListener('pointerdown', daneben);
    return () => document.removeEventListener('pointerdown', daneben);
  }, [offen]);

  /*
   * Der Merkzettel zeigt, was die Zeile verschweigt — und sonst nichts. Beide
   * Kürzungen zählen: die nach der ersten Zeile, die wir selbst vornehmen, und
   * die nach der Breite, die der Browser vornimmt.
   */
  function merkzettel(ereignis: MouseEvent<HTMLInputElement>): void {
    const feld = ereignis.currentTarget;
    const verborgen = vorschau !== value || feld.scrollWidth > feld.clientWidth;

    if (value !== '' && verborgen) {
      feld.title = value;
    } else {
      feld.removeAttribute('title');
    }
  }

  return (
    <Field
      label={label}
      explain={explain}
      action={
        <FieldButton title={`„${label}" bearbeiten`} onClick={umschalten}>
          <PencilIcon />
        </FieldButton>
      }
    >
      <input
        className="input--waehlbar"
        readOnly
        aria-label={label}
        value={vorschau}
        placeholder={placeholder}
        onMouseEnter={merkzettel}
        onClick={umschalten}
        // Eine Zeile, die sich anklicken lässt, muss sich auch drücken lassen.
        onKeyDown={(ereignis) => {
          if (ereignis.key === 'Enter' || ereignis.key === ' ') {
            ereignis.preventDefault();
            umschalten();
          }
        }}
      />

      {offen && (
        <div
          ref={fenster}
          className="memo"
          role="dialog"
          aria-label={label}
          // Escape gehört dem Fenster, nicht der Seite darunter.
          onKeyDown={(ereignis) => {
            if (ereignis.key === 'Escape') {
              ereignis.stopPropagation();
              setOffen(false);
            }
          }}
        >
          <textarea
            className="memo__text"
            autoFocus
            value={entwurf}
            placeholder={placeholder}
            onChange={(ereignis) => setEntwurf(ereignis.target.value)}
          />

          {/* Rechtsbündig, OK vor Abbrechen — wie in jedem Fenster hier. */}
          <div className="row memo__knoepfe">
            <button onClick={uebernimm}>OK</button>
            <button className="secondary" onClick={() => setOffen(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </Field>
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

/**
 * Derselbe Ordner, offen — für einen aufgeklappten Zweig im Verzeichnisbaum.
 *
 * Als eigenes Zeichen und nicht als gedrehtes: Ein Ordner, der sich beim
 * Aufklappen nur neigt, liest sich als Bewegung; einer, der offen steht, sagt
 * den Zustand. Und der Zustand ist hier die Auskunft — der Baum zeigt an
 * derselben Stelle mal drei Zeilen und mal dreißig.
 */
export function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h4.2c.5 0 1 .24 1.3.64l1 1.36H18A1.5 1.5 0 0 1 19.5 8.5V10H7.7c-.9 0-1.7.6-2 1.45L3.4 18.5a1.5 1.5 0 0 1-.9-1.37z" />
      <path d="M6.6 12.2c.2-.6.75-1 1.4-1h13.1c1.03 0 1.76.99 1.44 1.96l-1.75 5.3c-.2.63-.78 1.04-1.44 1.04H4.3z" />
    </svg>
  );
}

/**
 * Eine Liste zum Abhaken, als Zeichen für „hier aus einer Liste aussuchen".
 *
 * Drei Kästchen mit Zeilen daneben — dasselbe Bild wie das Fenster, das sich
 * öffnet. Ein Ordner wäre hier falsch: Er verspricht ein Verzeichnis, und es
 * kommt eine Auswahl von Endungen. Gefüllte Flächen, keine Striche: Der Knopf
 * färbt seine Zeichen über `fill`, ein Strichbild bliebe unsichtbar.
 */
export function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h4.5v4.5H3zM3 9.75h4.5v4.5H3zM3 15.5h4.5v4.5H3zM10.5 5h10.5v2.5H10.5zM10.5 10.75h10.5v2.5H10.5zM10.5 16.5h10.5v2.5H10.5z" />
    </svg>
  );
}

/**
 * Ein quadratischer Knopf in einer Tabellenzeile.
 *
 * Drei beschriftete Knöpfe nebeneinander verbrauchen mehr Breite als der Inhalt
 * der Zeile: In der Benutzerliste blieb für den Namen so wenig übrig, dass
 * „Administrator" umbrach und die Zeile zwei hoch wurde. Ein Zeichen sagt
 * dasselbe auf einem Achtel der Fläche.
 *
 * Was es bedeutet, steht im `title` — sichtbar beim Verweilen und für
 * Vorlesegeräte über `aria-label`. Ein Zeichen ohne Erklärung wäre ein Rätsel,
 * und Rätsel gehören nicht in eine Benutzerverwaltung.
 */
export function RowButton({
  title,
  tone,
  disabled,
  onClick,
  children,
}: {
  /** Was er tut, als kurzer Satz — er trägt keine Beschriftung. */
  title: string;
  /** `bad` färbt ihn erst beim Verweilen ein: Löschen soll sich ankündigen. */
  tone?: 'bad';
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={tone === 'bad' ? 'row-button row-button--bad' : 'row-button'}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/*
 * Die Zeichen der Zeilenknöpfe. Gleiche Grammatik wie im Hauptmenü: 24er-Raster,
 * nur Linien, gleiche Strichstärke — die Farbe kommt vom Knopf.
 */

/** Stift — etwas ändern. */
/**
 * Stift — bearbeiten.
 *
 * Ein Umriss mit Spitze, dazu die Linie darunter, auf der geschrieben wird.
 *
 * Er war vorher ein Viereck: unten eine waagerechte Kante von vier Einheiten
 * statt einer Spitze, und der Strich für die Zwinge lag außerhalb des Körpers.
 * Bei siebzehn Pixeln sah man davon einen Balken und einen losen Strich daneben.
 */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon--strich">
      <path d="M17.2 3.6a2.2 2.2 0 0 1 3.2 3.2L8.6 18.6l-4.2 1.2 1.2-4.2z" />
      <path d="M14.9 5.9l3.2 3.2" />
      <path d="M4 21.6h9" />
    </svg>
  );
}

/** Schlüssel — ein Passwort vergeben. */
export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon--strich">
      <path d="M13 11a3 3 0 1 0 6 0 3 3 0 0 0-6 0M13 11H4M6 11v3M9 11v2" />
    </svg>
  );
}

/** Geschlossenes Schloss — sperren. */
export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon--strich">
      <path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" />
    </svg>
  );
}

/** Offenes Schloss — wieder freigeben. Der Bügel steht auf, das ist der Unterschied. */
export function UnlockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon--strich">
      <path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.8-1.1" />
    </svg>
  );
}

/**
 * Ein Plus — eine Zeile mehr.
 *
 * Als zwei Striche und nicht als Kreuz aus einer Schrift: Ein Zeichen aus der
 * Schrift säße auf der Grundlinie und stünde damit in einem quadratischen Knopf
 * ein wenig zu tief; ein gezeichnetes steht in der Mitte seines Feldes.
 */
export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
    </svg>
  );
}

/*
 * `icon--strich` an den Zeichen, die aus Linien bestehen.
 *
 * Ein Pfad wie `M5 7h14M9 7V5h6v2…` beschreibt Striche und keine Flächen. Wird
 * er gefüllt, entsteht daraus ein Klecks — genau das war im Spring zu sehen:
 * ein schwarzer Fleck statt eines Papierkorbs. In Tabellenzeilen fiel es nie
 * auf, weil `.row-button svg` dort längst auf Strich stellte; erst als dieselben
 * Zeichen in einen Feldknopf kamen, kam der Klecks mit.
 *
 * Die Angabe steht am Zeichen und nicht am Knopf: Ob ein Zeichen aus Flächen
 * oder aus Strichen besteht, weiß es selbst — der Knopf, in dem es sitzt, nicht.
 */
/**
 * Papierkorb — löschen.
 *
 * Deckel, Griff, Korb — und sonst nichts. Er trug einmal zwei senkrechte
 * Striche darin, die Rillen andeuten sollten. Bei siebzehn Pixeln stehen die so
 * eng, dass daraus ein Gitter wird und der Korb sein Inneres verliert; ein
 * Zeichen dieser Größe verträgt drei Linien, nicht fünf.
 *
 * Der Korb verjüngt sich nach unten und ist unten gerundet. Ein Rechteck sähe
 * aus wie eine Kiste.
 */
export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon--strich">
      <path d="M5 7h14M10 7V5.4h4V7M6.6 7l.9 12.3a1.3 1.3 0 0 0 1.3 1.2h6.4a1.3 1.3 0 0 0 1.3-1.2L17.4 7" />
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

/**
 * Zeigt den ganzen Inhalt eines Feldes an, wenn er nicht hineinpasst.
 *
 * Ein Pfad wie `C:\Kunden\Nord\Eingang\2026\Lieferschein_*.csv` ist breiter als
 * das Feld, in dem er steht. Sichtbar bleibt sein Anfang; wo er endet, muss man
 * scrollen — und beim Vergleichen zweier Zeilen ist genau das Ende der
 * Unterschied.
 *
 * ## Warum gemessen und nicht immer gesetzt
 *
 * Ein Merkzettel, der bei jedem Feld erscheint und nur wiederholt, was daneben
 * steht, ist einer, den man wegsieht. Er soll etwas hinzufügen — und das tut er
 * nur, wenn wirklich etwas fehlt.
 *
 * ## Warum beim Überfahren und nicht beim Tippen
 *
 * Gemessen wird `scrollWidth` gegen `clientWidth`, und das geht nur am
 * gebauten Feld. Bei jeder Änderung zu messen hieße, nach jedem Tastendruck im
 * Baum nachzusehen; beim Überfahren wird genau dann gemessen, wenn die Antwort
 * gebraucht wird — der Browser lässt sich mit dem Anzeigen ohnehin Zeit.
 */
export function titelBeiUeberlauf(): { onMouseEnter(event: MouseEvent<HTMLInputElement>): void } {
  return {
    onMouseEnter: (event) => {
      const feld = event.currentTarget;

      if (feld.value !== '' && feld.scrollWidth > feld.clientWidth) {
        feld.title = feld.value;
      } else {
        feld.removeAttribute('title');
      }
    },
  };
}

/**
 * Derselbe Merkzettel für ein Auswahlfeld.
 *
 * Ein Auswahlfeld trägt in `value` die **Kennung** und nicht den Text — „en-GS"
 * statt „Südgeorgien und die Südlichen Sandwichinseln". Gezeigt werden muss, was
 * dasteht; die Kennung im Merkzettel beantwortete eine Frage, die niemand
 * stellt.
 *
 * Gebraucht wird er nur, wo das Feld schmaler ist als seine Liste — siehe
 * `select.input--wahl-lang`. Ein Feld, das seinen längsten Eintrag ohnehin
 * trägt, läuft nie über, und die Messung sagt das auch.
 */
export function titelBeiUeberlaufWahl(): { onMouseEnter(event: MouseEvent<HTMLSelectElement>): void } {
  return {
    onMouseEnter: (event) => {
      const feld = event.currentTarget;
      const text = feld.selectedOptions[0]?.text ?? '';

      if (text !== '' && feld.scrollWidth > feld.clientWidth) {
        feld.title = text;
      } else {
        feld.removeAttribute('title');
      }
    },
  };
}

/**
 * Ein Winkel, der die Richtung zeigt.
 *
 * Nur einer, nicht zwei: Ein Zeichen, das sich dreht, sagt „hier bewegt sich
 * etwas, und zwar dorthin". Zwei verschiedene Zeichen für auf und zu sagen
 * dasselbe zweimal und lassen sich beim Umschalten nicht verfolgen — der eine
 * springt, der andere wandert.
 *
 * Gefüllt und nicht gestrichelt, weil die Stile der Oberfläche `fill:
 * currentColor` setzen: Ein Pfad, der auf `stroke` baut, käme hier als
 * schwarzer Klecks an.
 */
/**
 * Läuft oder ruht - zwei Zeichen, die man auch ohne Farbe unterscheidet.
 *
 * Der Haken und das Kreuz tragen zwar Grün und Rot, aber die Form sagt es schon
 * allein. Wer Rot und Grün schlecht unterscheidet, sieht sonst zwei gleich
 * helle Punkte untereinander und liest daraus gar nichts.
 */
export function HakenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

export function KreuzIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.1 4.9 16.2 12l-7.1 7.1-2.1-2.1L12 12 7 7z" />
    </svg>
  );
}

/**
 * Eine Karte, die sich zuklappen lässt.
 *
 * ## Warum überhaupt zuklappen
 *
 * Der Workflow-Editor stellt in einem Glied mehr ein, als auf einen Bildschirm
 * geht. Wer die Quelle einmal festgelegt hat, arbeitet danach unten weiter und
 * scrollt an ihr jedes Mal vorbei. Zugeklappt bleibt sie sichtbar — als Pille
 * mit ihrem Namen —, nimmt aber keine Höhe mehr.
 *
 * ## Warum die Höhe nicht gemessen wird
 *
 * Aufgeklappt wird über `grid-template-rows: 0fr → 1fr`. Der Browser rechnet
 * die Zielhöhe selbst aus. Eine gemessene Höhe (`max-height: 800px`) wäre eine
 * Zahl, die rät: Zu klein schneidet sie ab, zu groß macht die Bewegung träge —
 * und beides ändert sich mit jedem Feld, das dazukommt.
 *
 * ## Der Zustand gehört nicht an den Workflow
 *
 * Ob eine Karte offen steht, ist eine Sache des Hinsehens und keine des
 * Auftrags. Gespeichert würde daraus eine Einstellung, die zwei Leute
 * gegeneinander verstellen.
 */
export function Klappkarte({
  titel,
  stand = 'LEER',
  anfangsOffen = true,
  children,
}: {
  titel: string;
  /**
   * Der Zustand dieser Fläche — er färbt den Punkt neben der Überschrift.
   *
   * ```text
   * LEER            grau    nichts eingetragen
   * UNVOLLSTAENDIG  gelb    angefangen, etwas Nötiges fehlt
   * FEHLERHAFT      rot     eingetragen und in sich falsch
   * GUELTIG         grün    vollständig und brauchbar
   * ```
   *
   * Am Punkt und nicht als Streifen am Rand: Der Punkt gehört zur Pille, und
   * die Pille ist das, was von einer zugeklappten Fläche zu sehen ist. Vier
   * Zustände an einem Rand unterzubringen hieße außerdem, vier Farben als
   * Linien zu unterscheiden — als Punkt sind sie eine Farbe an einer Stelle.
   *
   * Was die Zustände je Fläche bedeuten, entscheidet der Aufrufer; die Karte
   * weiß nichts von Workflows. Für den Editor steht es in
   * `screens/job/feldstand.ts`.
   */
  stand?: 'LEER' | 'UNVOLLSTAENDIG' | 'FEHLERHAFT' | 'GUELTIG';
  /** Ob sie beim ersten Erscheinen offen steht. */
  anfangsOffen?: boolean;
  children: ReactNode;
}) {
  const [offen, setOffen] = useState(anfangsOffen);

  return (
    <section
      className={['card', 'card--klapp', offen ? '' : 'card--zu', `card--${stand.toLowerCase()}`].join(' ')}
    >
      {/*
        * Die Überschrift steht **vor** dem Knopf, obwohl der Knopf oben links
        * sitzt: Die Pille entsteht über `.card h2:first-child`. Käme der Knopf
        * zuerst, verlöre die Überschrift ihre Form. Er liegt ohnehin absolut
        * und richtet sich nicht nach der Reihenfolge.
        */}
      <h2>{titel}</h2>

      <button
        type="button"
        className="klapp"
        aria-expanded={offen}
        title={offen ? `„${titel}" zuklappen` : `„${titel}" aufklappen`}
        onClick={() => setOffen(!offen)}
      >
        <ChevronIcon />
      </button>

      <div className="klapp__body" data-offen={offen}>
        <div>{children}</div>
      </div>
    </section>
  );
}

/**
 * Pfeiltasten bewegen den Fokus in einer Liste von Knöpfen.
 *
 * An das umgebende `ul` gehängt, nicht an jede Zeile: Eine Liste, die sich
 * ändert, hätte sonst Zeilen mit und ohne Tastatur, je nachdem, wann sie
 * entstanden sind.
 *
 * `Pos1` und `Ende` gehen an den Anfang und ans Ende — bei dreißig Zeilen ist
 * das der Unterschied zwischen einem Tastendruck und dreißig. Der Browser
 * scrollt den fokussierten Knopf von selbst in den sichtbaren Bereich; eine
 * eigene Rechnung dafür wäre eine, die bei jeder Änderung an der Zeilenhöhe
 * still falsch würde.
 *
 * Gesucht werden die Geschwister im Baum und keine gemerkte Nummer: Die Liste
 * kann sich ändern, das DOM ist die Wahrheit.
 */
export function listentasten(event: Tastenereignis<HTMLElement>): void {
  const tasten = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

  if (!tasten.includes(event.key)) {
    return;
  }

  const knoepfe = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('li > button')];

  if (knoepfe.length === 0) {
    return;
  }

  // Sonst scrollte die Seite zusätzlich — der Fokus wandert, die Liste bleibt.
  event.preventDefault();

  const jetzt = knoepfe.indexOf(document.activeElement as HTMLButtonElement);
  const ziel =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? knoepfe.length - 1
        : Math.min(knoepfe.length - 1, Math.max(0, jetzt + (event.key === 'ArrowDown' ? 1 : -1)));

  knoepfe[ziel]?.focus();
}

/**
 * Eine Reihe von Reitern über einem Inhalt.
 *
 * ## Warum Reiter und keine Klappflächen
 *
 * Ein Eingangsprofil hat fünf Gruppen von Angaben, und man arbeitet immer an
 * genau einer davon. Untereinander als Klappflächen wären es fünf Überschriften
 * mit vier zugeklappten Flächen dazwischen — der Reiter „Spalten" läge dann
 * unter dreißig Zeilen anderer Einstellungen. Reiter beantworten „wo bin ich"
 * und „was gibt es noch" in einer einzigen Zeile.
 *
 * ## Alles bleibt im Speicher
 *
 * Ausgeblendet wird nur gezeichnet, nicht verworfen: Wer im Reiter „Spalten"
 * etwas ändert, im Reiter „Werte" nachsieht und zurückkommt, findet seine
 * Änderung vor. Der Zustand hängt deshalb nicht an den Reitern, sondern über
 * ihnen.
 *
 * ## Die Pfeiltasten
 *
 * Links und rechts wechseln, `Pos1` und `Ende` springen an den Rand — so, wie
 * Reiter überall sonst zu bedienen sind. Ohne das erreicht man den fünften
 * Reiter nur mit der Maus oder mit vier Tabulatorsprüngen.
 */
export function Reiter<T extends string>({
  reiter,
  offen,
  stil = 'blatt',
  onOeffnen,
}: {
  reiter: readonly { id: T; text: string; trennerDavor?: boolean }[];
  offen: T;
  /**
   * Wie die Zeile aussieht — beide sind Reiter, nur an verschiedenen Ebenen.
   *
   * ```text
   * pille   ─ über einem ganzen Bildschirm: Mandant, Konsolidierung, Auskunft
   * blatt   ─ innerhalb eines Formulars: die fünf Blätter eines Schemas
   * ```
   *
   * Zwei Aussehen und ein Bauteil. Die Pillenzeile stand vorher zweimal von
   * Hand da — einmal in der Konsolidierung, einmal in der Auskunft —, und
   * beide Male ohne Tastatur: Die Pfeiltasten gab es nur bei den Blättern,
   * obwohl es dieselbe Bedienung ist.
   */
  stil?: 'blatt' | 'pille';
  onOeffnen(id: T): void;
}) {
  function tasten(event: Tastenereignis<HTMLDivElement>): void {
    const richtung = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 }[event.key];

    if (richtung === undefined) {
      return;
    }

    // Sonst scrollte die Seite zusätzlich — der Fokus wandert, die Zeile bleibt.
    event.preventDefault();

    const jetzt = reiter.findIndex((einer) => einer.id === offen);
    const ziel =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? reiter.length - 1
          : Math.min(reiter.length - 1, Math.max(0, jetzt + richtung));

    const naechster = reiter[ziel];

    if (naechster) {
      onOeffnen(naechster.id);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[ziel]?.focus();
    }
  }

  const pille = stil === 'pille';

  return (
    <div className={pille ? 'subnav' : 'reiter'} role="tablist" onKeyDown={tasten}>
      {reiter.map((einer) => (
        <Fragment key={einer.id}>
          {/*
            * Ein Strich zwischen zwei Gruppen derselben Zeile.
            *
            * Beim Mandanten trennt er, wer er **ist**, von dem, was er
            * **liefert**. Zwei Zeilen daraus zu machen wäre die falsche
            * Antwort: Es ist eine Ebene, und zwei Zeilen sähen aus wie zwei.
            */}
          {einer.trennerDavor && <span className="subnav__trenner" aria-hidden="true" />}

          <button
            type="button"
            role="tab"
            aria-selected={einer.id === offen}
            /*
             * Nur der offene Reiter ist mit der Tabulatortaste erreichbar; die
             * übrigen über die Pfeiltasten. So sind es aus dem Formular heraus
             * ein Sprung zurück zur Reiterzeile und nicht fünf.
             */
            tabIndex={einer.id === offen ? 0 : -1}
            className={
              pille
                ? einer.id === offen
                  ? 'subnav__tab subnav__tab--active'
                  : 'subnav__tab'
                : einer.id === offen
                  ? 'reiter__blatt reiter__blatt--offen'
                  : 'reiter__blatt'
            }
            onClick={() => onOeffnen(einer.id)}
          >
            {einer.text}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
