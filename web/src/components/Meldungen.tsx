import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { useSchliesstBeiAbstand } from './Auswahlschliesser.js';
import { Modal } from './Pieces.js';
import type {
  Benachrichtigung,
  Handlungsbedarf,
  Meldestand,
  Meldungsantwort,
} from '../api/types.js';

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

export function Meldungen({
  tenantId,
  bereich,
  bedarf,
  onZumBedarf,
}: {
  tenantId: string;
  bereich: string;
  /**
   * Was auf eine Entscheidung wartet - über alle Mandanten.
   *
   * Es kommt von außen und wird hier nicht geholt: Die Zahl gilt für die ganze
   * Installation, die Meldungen daneben gelten für einen Mandanten. Zwei
   * Abfragen mit verschiedenem Umfang gehören nicht in dasselbe Bauteil.
   *
   * Fehlt sie, ist sie nicht null, sondern unbekannt - dann steht hier nichts.
   * Eine Null zu zeigen hieße zu behaupten, es liege nichts an, und das ist die
   * eine Auskunft, die niemand nachprüft.
   */
  bedarf?: Handlungsbedarf;
  onZumBedarf?(): void;
}) {
  const [antwort, setAntwort] = useState<Meldungsantwort>();
  const [offen, setOffen] = useState(false);
  /*
   * Knopf und Fach zusammen sind das Aufklappende.
   *
   * Der Knopf muss mitgemessen werden: Das Fach hängt unter ihm, und ohne ihn
   * läge die Grenze mitten auf dem Knopf - der Zeiger, der ihn gerade gedrückt
   * hat, schlösse das Fach im selben Moment wieder.
   */
  const knopf = useRef<HTMLButtonElement>(null);
  const fach = useRef<HTMLDivElement>(null);

  /*
   * Das Fach schließt sich, wenn der Zeiger fortgeht - dieselbe Handbreit wie
   * bei einer aufgeklappten Auswahlliste. Es steht nichts Ungesichertes darin:
   * Was hier geschieht, geschieht auf Knopfdruck und ist dann bereits gesendet.
   */
  useSchliesstBeiAbstand(offen, () => setOffen(false), [knopf, fach]);
  const [busy, setBusy] = useState(false);
  /**
   * Die Meldung, die sich von selbst zeigt (SPEC-01, Abschnitt 20).
   *
   * Nur eine, und nur eine drängende. Sechs Fenster übereinander sind kein
   * Hinweis mehr, sondern eine Wand, die man wegklickt, ohne hinzusehen — und
   * beim sechsten Klick ist auch die eine weg, auf die es ankam.
   */
  const [popup, setPopup] = useState<Benachrichtigung>();
  /**
   * Was sich schon einmal von selbst gezeigt hat; zweimal wäre Belästigung.
   *
   * Der Anlass steht mit dabei, weil Konfliktmeldungen wieder vergessen werden
   * dürfen — siehe unten. Ohne ihn müsste die Meldung dazu noch einmal geholt
   * werden, und zwar genau dann, wenn sie nicht mehr in der Liste steht.
   */
  const gezeigt = useRef(new Map<string, string>());
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
        gezeigt.current.set(naechste.id, naechste.anlass);
        setPopup(naechste);
      }
    } catch {
      // Eine Glocke, die einen Fehler anzeigt, hilft niemandem. Beim nächsten
      // Blick ist sie entweder wieder da oder es fehlt Grundsätzlicheres.
    }
  }

  /**
   * Beim Wechsel der Ansicht dürfen sich Konflikte wieder melden.
   *
   * **Ob** sie es tun, entscheidet der Server: Er kennt das Konfliktverhalten
   * des Mandanten und nennt in `pending` nur, was jetzt an der Reihe ist. Hier
   * wird nur das Gedächtnis dieser Sitzung geleert — sonst käme eine
   * Wiedervorlage nie an, weil der Browser sie für „schon gezeigt" hält.
   *
   * Nur Konfliktmeldungen. Ein gescheiterter Lauf meldet sich einmal je
   * Sitzung, so wie bisher — wer eingestellt hat, dass Konflikte ihm vor der
   * Nase hängen, hat über Konflikte entschieden und nicht über alles andere.
   */
  useEffect(() => {
    for (const [id, anlass] of gezeigt.current) {
      if (anlass === 'KONFLIKTE_ENTSTANDEN') {
        gezeigt.current.delete(id);
      }
    }

    void laden();
  }, [bereich]);

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
  /*
   * Eine Glocke, eine Zahl.
   *
   * Der Handlungsbedarf stand einmal als „(3)" am Menüpunkt. Beides zugleich
   * wären zwei Zähler für dieselbe Sache an zwei Orten - und der eine, den
   * jemand später zu ändern vergisst, widerspricht dann dem anderen.
   *
   * Die Alarmfarbe bekommt er nicht. Sie ist dem vorbehalten, was nicht warten
   * kann; ein Konflikt liegt womöglich seit gestern und darf das auch. Eine
   * Glocke, die dauerhaft rot ist, ist eine Glocke, die niemand mehr ansieht.
   */
  const wartet = bedarf?.gesamt ?? 0;
  const zahl = stand.offen + wartet;
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
   *
   * Gestempelt wird **jedes Mal** und nicht nur beim ersten Mal. Der Stempel
   * ist es, woran der Server die Frist der Wiedervorlage misst: Würde er beim
   * zweiten Zeigen nicht erneuert, käme der Fall danach im Takt der Frist
   * wieder — gerechnet ab dem ersten Blick vor drei Wochen.
   */
  async function schliessePopup(): Promise<void> {
    const meldung = popup;

    setPopup(undefined);

    if (meldung) {
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
        ref={knopf}
        type="button"
        className={stand.draengend > 0 ? 'bell__button bell__button--urgent' : 'bell__button'}
        title={
          zahl === 0
            ? 'Nichts liegt an'
            : `${stand.offen} Meldungen offen, davon ${stand.draengend} dringend; ${wartet} wartet auf eine Entscheidung`
        }
        aria-label="Benachrichtigungen"
        onClick={umschalten}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5c0 3.5-1 5-2 6.2-.4.5 0 1.3.7 1.3h13.6c.7 0 1.1-.8.7-1.3-1-1.2-2-2.7-2-6.2A5.5 5.5 0 0 0 12 3z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {zahl > 0 && <span className="bell__count">{zahl}</span>}
      </button>

      {offen && (
        <div ref={fach} className="bell__panel">
          {/*
            * Was auf eine Entscheidung wartet, steht oben - vor den Meldungen.
            *
            * Eine Meldung sagt, dass etwas geschehen ist; hier steht, dass etwas
            * geschehen soll. Das Zweite hat Vorrang, und deshalb steht es zuerst.
            *
            * Der Abschnitt fehlt ganz, wenn nichts wartet. Eine Überschrift mit
            * zwei Nullen darunter ist eine Zeile, die man ab dem zweiten Mal
            * überliest - und dann auch dann, wenn dort keine Null mehr steht.
            */}
          {bedarf && bedarf.gesamt > 0 && (
            <div className="bell__bedarf">
              <div className="row row--between">
                <strong>Handlungsbedarf</strong>
                <span className="muted">{bedarf.gesamt} offen</span>
              </div>

              <button className="secondary" onClick={() => { setOffen(false); onZumBedarf?.(); }}>
                {bedarf.konflikte} Konflikte, {bedarf.freigaben} Freigaben
              </button>
            </div>
          )}

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
