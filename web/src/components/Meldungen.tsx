import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { Modal } from './Pieces.js';
import type { Benachrichtigung, Meldestand, Meldungsantwort } from '../api/types.js';

/**
 * Das Benachrichtigungscenter (SPEC-01, Abschnitt 19 bis 22).
 *
 * ## Die Glocke sagt zwei Zahlen, nicht eine
 *
 * ```text
 * offen      wie viel noch aussteht
 * drängend   wie viel davon nicht warten kann
 * ```
 *
 * Nur „7" an der Glocke wäre die Zahl, die man nach drei Tagen nicht mehr
 * ansieht. Ein Punkt in Alarmfarbe erscheint deshalb erst, wenn etwas darunter
 * ist, das eine Handlung verlangt — und dann verschwindet er auch erst, wenn
 * jemand sie vorgenommen hat.
 *
 * ## Wegklicken ist nicht erledigen
 *
 * „Offene, noch nicht bearbeitete bzw. bestätigte Benachrichtigungen werden
 * persistent gespeichert. Sie dürfen nicht verloren gehen, nur weil der
 * Benutzer das Popup schließt." Das Schließen der Liste meldet **gesehen**;
 * fort ist eine Meldung erst, wenn jemand „Erledigt" drückt.
 */
const OFFEN_HOLEN_ALLE_MS = 30_000;

export function Meldungen({ tenantId }: { tenantId: string }) {
  const [antwort, setAntwort] = useState<Meldungsantwort>();
  const [offen, setOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Die Meldung, die sich von selbst zeigt (SPEC-01, Abschnitt 20).
   *
   * Nur eine, und nur eine drängende. Sechs Fenster übereinander sind kein
   * Hinweis mehr, sondern eine Wand, die man wegklickt, ohne hinzusehen — und
   * beim sechsten Klick ist auch die eine weg, auf die es ankam.
   */
  const [popup, setPopup] = useState<Benachrichtigung>();
  /** Was sich schon einmal von selbst gezeigt hat; zweimal wäre Belästigung. */
  const gezeigt = useRef(new Set<string>());
  const strom = useRef<EventSource>(undefined);

  async function laden(): Promise<void> {
    try {
      setAntwort(await api.get<Meldungsantwort>(`/api/notifications?tenantId=${encodeURIComponent(tenantId)}`));

      /*
       * Dieselbe Liste, die der Notification Agent abfragt: was offen ist und
       * eine Handlung verlangt. Sie kommt vom Server und wird nicht im Browser
       * abgeleitet — die Zuordnung Stufe → Kanal steht in SPEC-01 als
       * verbindliche Tabelle, und zweimal geschrieben wäre sie an einer Stelle
       * irgendwann veraltet.
       */
      const draengend = await api.get<Benachrichtigung[]>(
        `/api/notifications/pending?tenantId=${encodeURIComponent(tenantId)}`
      );

      const naechste = draengend.find((meldung) => !gezeigt.current.has(meldung.id));

      if (naechste) {
        gezeigt.current.add(naechste.id);
        setPopup(naechste);
      }
    } catch {
      // Eine Glocke, die einen Fehler anzeigt, hilft niemandem. Beim nächsten
      // Blick ist sie entweder wieder da oder es fehlt Grundsätzlicheres.
    }
  }

  useEffect(() => {
    void laden();

    /*
     * Der Ereignisstrom bringt die Meldung, sobald sie entsteht; das
     * regelmäßige Nachladen ist der Rückfall, wenn er abgerissen ist. Beides
     * zusammen, weil SSE ausdrücklich **keine** Zustellgarantie ist: Wer ein
     * Ereignis verpasst, hat nichts verloren — er sieht es nur später.
     */
    const takt = setInterval(() => void laden(), OFFEN_HOLEN_ALLE_MS);

    strom.current = new EventSource(`/api/events?tenantId=${encodeURIComponent(tenantId)}`);
    const auffrischen = (): void => void laden();

    strom.current.addEventListener('NOTIFICATION', auffrischen);
    strom.current.addEventListener('CONFLICT_FOUND', auffrischen);

    return () => {
      clearInterval(takt);
      strom.current?.close();
    };
  }, [tenantId]);

  const stand: Meldestand = antwort?.stand ?? { offen: 0, draengend: 0 };
  const meldungen = antwort?.meldungen ?? [];

  async function bestaetigen(id: string): Promise<void> {
    setBusy(true);

    try {
      await api.post(`/api/notifications/${id}/acknowledge`, {});
      await laden();
    } finally {
      setBusy(false);
    }
  }

  function umschalten(): void {
    const naechster = !offen;

    setOffen(naechster);

    /*
     * Beim Öffnen gilt alles Sichtbare als gesehen — aber eben nur als gesehen.
     * Das ist die Zusage aus Abschnitt 22: Ein Blick nimmt einer Meldung nicht
     * ihre Gültigkeit.
     */
    if (naechster) {
      for (const meldung of meldungen.filter((eintrag) => !eintrag.gesehen)) {
        void api.post(`/api/notifications/${meldung.id}/seen`, {});
      }
    }
  }

  /**
   * Das Fenster schließen heißt **gesehen** und nicht erledigt.
   *
   * „Offene, noch nicht bearbeitete bzw. bestätigte Benachrichtigungen … dürfen
   * nicht verloren gehen, nur weil der Benutzer das Popup schließt."
   */
  async function schliessePopup(): Promise<void> {
    const meldung = popup;

    setPopup(undefined);

    if (meldung && !meldung.gesehen) {
      await api.post(`/api/notifications/${meldung.id}/seen`, {});
      await laden();
    }
  }

  return (
    <div className="bell">
      {popup && (
        <Modal title={popup.titel} onClose={() => void schliessePopup()}>
          <p>{popup.text}</p>
          <p className="muted">
            {STUFE_LABELS[popup.stufe]} · {popup.entstanden}
          </p>
          <div className="row">
            <button
              disabled={busy}
              onClick={() => {
                const id = popup.id;

                setPopup(undefined);
                void bestaetigen(id);
              }}
            >
              Erledigt
            </button>
            <button className="secondary" onClick={() => void schliessePopup()}>
              Später
            </button>
          </div>
        </Modal>
      )}

      <button
        type="button"
        className={stand.draengend > 0 ? 'bell__button bell__button--urgent' : 'bell__button'}
        title={
          stand.offen === 0
            ? 'Keine offenen Meldungen'
            : `${stand.offen} offen, davon ${stand.draengend} dringend`
        }
        aria-label="Benachrichtigungen"
        onClick={umschalten}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5c0 3.5-1 5-2 6.2-.4.5 0 1.3.7 1.3h13.6c.7 0 1.1-.8.7-1.3-1-1.2-2-2.7-2-6.2A5.5 5.5 0 0 0 12 3z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {stand.offen > 0 && <span className="bell__count">{stand.offen}</span>}
      </button>

      {offen && (
        <div className="bell__panel">
          <div className="row row--between">
            <strong>Benachrichtigungen</strong>
            <span className="muted">{stand.offen} offen</span>
          </div>

          {meldungen.length === 0 ? (
            <p className="muted">Nichts liegt an.</p>
          ) : (
            <ul className="bell__list">
              {meldungen.slice(0, 20).map((meldung) => (
                <Eintrag
                  key={meldung.id}
                  meldung={meldung}
                  busy={busy}
                  onBestaetigen={() => void bestaetigen(meldung.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const STUFE_LABELS: Record<Benachrichtigung['stufe'], string> = {
  INFORMATION: 'Information',
  AKTION_ERFORDERLICH: 'Aktion erforderlich',
  KRITISCH: 'Kritisch',
};

function Eintrag({
  meldung,
  busy,
  onBestaetigen,
}: {
  meldung: Benachrichtigung;
  busy: boolean;
  onBestaetigen(): void;
}) {
  const erledigt = meldung.bestaetigt !== undefined;

  return (
    <li className={erledigt ? 'bell__item bell__item--done' : 'bell__item'}>
      <div className="row row--between">
        <strong>{meldung.titel}</strong>
        <span className={meldung.stufe === 'INFORMATION' ? 'muted' : 'badge badge--warn'}>
          {STUFE_LABELS[meldung.stufe]}
        </span>
      </div>

      <p className="muted">{meldung.text}</p>

      <div className="row row--between">
        <span className="muted">{meldung.entstanden}</span>
        {erledigt ? (
          <span className="muted">erledigt von {meldung.bestaetigtVon}</span>
        ) : (
          <button type="button" className="secondary" disabled={busy} onClick={onBestaetigen}>
            Erledigt
          </button>
        )}
      </div>
    </li>
  );
}
