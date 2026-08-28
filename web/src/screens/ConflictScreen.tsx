import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type {
  Anwendung,
  Entscheidungsart,
  Konfliktansicht,
  Konfliktfall,
  Konfliktliste,
  Konfliktstatus,
  Korrekturergebnis,
  Kritikalitaet,
  Massenergebnis,
  Massenvorschau,
  Streitfeld,
  Tenant,
  Ausleitung,
} from '../api/types.js';
import { Empty, Field, Loading, Notice } from '../components/Pieces.js';

/**
 * Die Konfliktbearbeitung (SPEC-07).
 *
 * Die umfangreichste Oberfläche des Moduls, und die einzige, an der ein Mensch
 * wirklich entscheidet. Drei Dinge trägt sie deshalb überall mit:
 *
 * ```text
 * Warum liegt das hier?   Ursache, erwartet, vorgefunden
 * Was kann ich tun?       die zulässigen Entscheidungen, nicht alle denkbaren
 * Was passiert dann?      die Vorschau — vor der Bestätigung
 * ```
 *
 * Und was schon geschehen ist, steht darunter. Eine Konfliktbearbeitung ohne
 * sichtbare Historie ist ein Formular, in dem man sich nicht traut, etwas zu
 * ändern.
 */
const KRITIKALITAET_LABELS: Record<Kritikalitaet, string> = {
  KRITISCH: 'kritisch',
  PRUEFFALL: 'Prüffall',
  KONFLIKT: 'Konflikt',
  WARNUNG: 'Warnung',
  INFORMATION: 'Information',
};

const STATUS_LABELS: Record<Konfliktstatus, string> = {
  OFFEN: 'offen',
  ZURUECKGESTELLT: 'zurückgestellt',
  BEREINIGT: 'bereinigt',
  AKZEPTIERT: 'akzeptiert',
  ERNEUT_VERARBEITET: 'erneut verarbeitet',
  ERFOLGREICH_VERARBEITET: 'erfolgreich verarbeitet',
};

const ENTSCHEIDUNG_LABELS: Record<Entscheidungsart, string> = {
  BEREINIGEN: 'Werte festlegen',
  ZUSAMMENFUEHREN: 'zusammenführen',
  NICHT_ZUSAMMENFUEHREN: 'getrennt lassen',
  AKZEPTIEREN: 'Konflikt akzeptieren',
  ZURUECKSTELLEN: 'zurückstellen',
  WIEDERAUFNEHMEN: 'wieder aufnehmen',
};

/**
 * Welche Entscheidungen ein Fall in seinem Zustand zulässt.
 *
 * SPEC-07, Abschnitt 6: „UniCom muss für jeden Konflikttyp die jeweils
 * zulässigen Bearbeitungs- und Entscheidungsoptionen bereitstellen." Ein Knopf,
 * der beim Drücken einen Fehler bringt, ist schlechter als kein Knopf.
 */
function moeglich(fall: Konfliktfall, akzeptierenErlaubt: boolean): Entscheidungsart[] {
  if (fall.status === 'ERFOLGREICH_VERARBEITET' || fall.status === 'ERNEUT_VERARBEITET') {
    return [];
  }

  const mitWerten = fall.felder.length > 0 ? (['BEREINIGEN'] as Entscheidungsart[]) : [];
  /*
   * Der Mandant kann das Hinnehmen abschalten. Dann steht der Knopf nicht da
   * — der Server lehnt die Entscheidung ohnehin ab, und ein Knopf, der beim
   * Drücken einen Fehler bringt, ist schlechter als kein Knopf.
   */
  const hinnehmen = akzeptierenErlaubt ? (['AKZEPTIEREN'] as Entscheidungsart[]) : [];

  if (fall.status === 'ZURUECKGESTELLT') {
    return [...mitWerten, ...hinnehmen, 'WIEDERAUFNEHMEN'];
  }

  /*
   * Ein hingenommener Fall lässt sich nicht zurückstellen und auch nicht noch
   * einmal hinnehmen — der Lebenszyklus lässt von hier nur zurück ins Offene
   * oder ins Bereinigte. Hier stand bisher dieselbe Zeile wie unten, und beide
   * Knöpfe endeten in einer Absage des Servers.
   */
  if (fall.status === 'AKZEPTIERT') {
    return [...mitWerten, 'WIEDERAUFNEHMEN'];
  }

  return [...mitWerten, ...hinnehmen, 'ZURUECKSTELLEN'];
}

type Wahl = { art: 'QUELLE'; quelle: string } | { art: 'EINGABE'; wert: string } | { art: 'LEER' };

export function ConflictScreen() {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [tenantId, setTenantId] = useState<string>();
  const [suche, setSuche] = useState('');
  const [status, setStatus] = useState<Konfliktstatus | ''>('');
  const [kritikalitaet, setKritikalitaet] = useState<Kritikalitaet | ''>('');
  const [liste, setListe] = useState<Konfliktliste>();
  const [gewaehlt, setGewaehlt] = useState<string>();
  const [ansicht, setAnsicht] = useState<Konfliktansicht>();
  const [wahlen, setWahlen] = useState<Record<string, Wahl>>({});
  const [vorschau, setVorschau] = useState<Anwendung>();
  const [markiert, setMarkiert] = useState<string[]>([]);
  /*
   * Zurückstellen und nicht Akzeptieren: Die Voreinstellung einer
   * Massenentscheidung darf nicht die sein, die Fälle vom Tisch nimmt. Wer
   * hundert Fälle markiert und einmal zu schnell klickt, hat sonst hundert
   * Entscheidungen getroffen, die er nicht getroffen hat.
   */
  const [massenart, setMassenart] = useState<Entscheidungsart>('ZURUECKSTELLEN');
  const [massenvorschau, setMassenvorschau] = useState<Massenvorschau>();
  const [meldung, setMeldung] = useState<string>();
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);

  const mandant = tenantId ?? tenants.data?.[0]?.id;
  /*
   * Ohne Eintrag ist es erlaubt — so war es, bevor es die Einstellung gab.
   * Andersherum verschwände der Knopf für jeden bestehenden Kunden, ohne dass
   * jemand etwas eingestellt hätte.
   */
  const akzeptierenErlaubt =
    tenants.data?.find((eintrag) => eintrag.id === mandant)?.konflikte?.akzeptierenErlaubt ?? true;

  async function laden(): Promise<void> {
    if (!mandant) {
      return;
    }

    const parameter = new URLSearchParams({ tenantId: mandant });

    if (suche.trim() !== '') {
      parameter.set('q', suche.trim());
    }

    if (status !== '') {
      parameter.set('status', status);
    }

    if (kritikalitaet !== '') {
      parameter.set('criticality', kritikalitaet);
    }

    try {
      setListe(await api.get<Konfliktliste>(`/api/conflicts?${parameter.toString()}`));
    } catch (error) {
      setFehler(messageOf(error, 'Die Konfliktliste konnte nicht geladen werden'));
    }
  }

  useEffect(() => {
    void laden();
    // Die Liste hängt am Mandanten und an den Filtern — an nichts sonst.
  }, [mandant, suche, status, kritikalitaet]);

  async function oeffnen(id: string): Promise<void> {
    setGewaehlt(id);
    setVorschau(undefined);
    setWahlen({});
    setMeldung(undefined);

    try {
      const geladen = await api.get<Konfliktansicht>(`/api/conflicts/${id}`);

      setAnsicht(geladen);

      /*
       * Der Wiedereinstiegspunkt wird bei jedem Öffnen fortgeschrieben, nicht
       * erst beim Entscheiden: „Zuletzt bearbeitet" heißt zuletzt angesehen —
       * wer eine Stunde über einem Fall gebrütet und dann Feierabend gemacht
       * hat, will morgen dort weitermachen und nicht beim letzten, den er
       * entschieden hat.
       */
      await api.put('/api/conflicts/progress', {
        tenantId: mandant,
        last: id,
        position: liste?.faelle.findIndex((fall) => fall.id === id) ?? 0,
      });
    } catch (error) {
      setFehler(messageOf(error, 'Der Konfliktfall konnte nicht geladen werden'));
    }
  }

  function entscheidungAus(art: Entscheidungsart): unknown {
    if (art !== 'BEREINIGEN' && art !== 'ZUSAMMENFUEHREN') {
      return { kind: art };
    }

    return {
      kind: art,
      fields: Object.entries(wahlen).map(([feld, wahl]) => ({
        field: feld,
        choice:
          wahl.art === 'QUELLE'
            ? { kind: 'QUELLE', source: wahl.quelle }
            : wahl.art === 'EINGABE'
              ? { kind: 'EINGABE', value: wahl.wert }
              : { kind: 'LEER' },
      })),
    };
  }

  async function zeigen(art: Entscheidungsart): Promise<void> {
    if (!gewaehlt) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      setVorschau(
        await api.post<Anwendung>(`/api/conflicts/${gewaehlt}/preview`, {
          tenantId: mandant,
          decision: entscheidungAus(art),
        })
      );
    } catch (error) {
      setFehler(messageOf(error, 'Die Vorschau ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  async function entscheiden(art: Entscheidungsart): Promise<void> {
    if (!gewaehlt || !ansicht) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      await api.post(`/api/conflicts/${gewaehlt}/decide`, {
        tenantId: mandant,
        decision: entscheidungAus(art),
        version: ansicht.fall.fassung,
      });

      setMeldung(`„${ENTSCHEIDUNG_LABELS[art]}" ist übernommen.`);
      setVorschau(undefined);
      await oeffnen(gewaehlt);
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Entscheidung wurde nicht übernommen'));
    } finally {
      setBusy(false);
    }
  }

  async function sperren(los: boolean): Promise<void> {
    if (!gewaehlt) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      await api.post(`/api/conflicts/${gewaehlt}/${los ? 'unlock' : 'lock'}`, {});
      await oeffnen(gewaehlt);
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Sperre ließ sich nicht ändern'));
    } finally {
      setBusy(false);
    }
  }

  async function massenZeigen(): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      setMassenvorschau(
        await api.post<Massenvorschau>('/api/conflicts/bulk/preview', {
          tenantId: mandant,
          ids: markiert,
          decision: { kind: massenart },
        })
      );
    } catch (error) {
      setFehler(messageOf(error, 'Die Massenvorschau ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  async function massenEntscheiden(): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      const ergebnis = await api.post<Massenergebnis>('/api/conflicts/bulk/decide', {
        tenantId: mandant,
        ids: markiert,
        decision: { kind: massenart },
      });

      setMeldung(
        `Vorgang ${ergebnis.vorgang.slice(0, 8)}: ${ergebnis.uebernommen.length} von ${ergebnis.betroffen} übernommen` +
          (ergebnis.abgelehnt.length > 0 ? `, ${ergebnis.abgelehnt.length} abgelehnt` : '')
      );
      setMassenvorschau(undefined);
      setMarkiert([]);
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Massenentscheidung ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Die Freigabe **ist** der Lauf.
   *
   * Vorher endete sie bei den Daten: Die Fälle standen auf „zur erneuten
   * Verarbeitung gegeben", und niemand verarbeitete sie erneut. Wer zwanzig
   * Fälle entschieden hatte, las „stehen bereit" und wartete auf etwas, das
   * nicht kam.
   */
  async function freigeben(laufId: string): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      const ergebnis = await api.post<Korrekturergebnis>('/api/conflicts/release', {
        tenantId: mandant,
        runId: laufId,
      });

      setMeldung(
        ergebnis.gelungen
          ? `Korrekturlauf ${ergebnis.laufId} ist durch: ${ergebnis.abgeschlossen} von ${ergebnis.faelle} ` +
            'Fall/Fällen gelten als erfolgreich verarbeitet.'
          : `Korrekturlauf ${ergebnis.laufId} ist misslungen: ${ergebnis.meldung}. ` +
            `${ergebnis.faelle} Fall/Fälle stehen weiter auf „zur erneuten Verarbeitung gegeben".`
      );
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Freigabe ist nicht möglich'));
    } finally {
      setBusy(false);
    }
  }

  if (tenants.error) {
    return <Notice kind="error">{tenants.error}</Notice>;
  }

  if (!tenants.data) {
    return <Loading />;
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}
      {meldung && <Notice kind="info">{meldung}</Notice>}

      {liste && (
        <Freigabe
          stand={liste.stand}
          laeufe={laeufeMitBereinigten(liste.faelle)}
          busy={busy}
          onFreigeben={(laufId) => void freigeben(laufId)}
        />
      )}

      {mandant && <Ausleitungen mandant={mandant} />}

      {liste?.einstieg.gilt === false && liste.faelle.length > 0 && (
        <Notice kind="info">{liste.einstieg.grund}</Notice>
      )}

      <section className="card">
        <h2>Prüffälle</h2>

        <div className="row">
          <Field label="Mandant">
            <select value={mandant} onChange={(event) => setTenantId(event.target.value)}>
              {tenants.data.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Suche" explain="Über Ursache, Datensatz, Quelle und Werte.">
            <input value={suche} placeholder="Bonn" onChange={(event) => setSuche(event.target.value)} />
          </Field>

          <Field label="Status">
            <select value={status} onChange={(event) => setStatus(event.target.value as Konfliktstatus | '')}>
              <option value="">alle</option>
              {Object.entries(STATUS_LABELS).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dringlichkeit">
            <select
              value={kritikalitaet}
              onChange={(event) => setKritikalitaet(event.target.value as Kritikalitaet | '')}
            >
              <option value="">alle</option>
              {Object.entries(KRITIKALITAET_LABELS).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {!liste ? (
          <Loading />
        ) : liste.faelle.length === 0 ? (
          <Empty>Kein Fall passt zu dieser Auswahl.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th />
                  <th>Datensatz</th>
                  <th>Art</th>
                  <th>Dringlichkeit</th>
                  <th>Status</th>
                  <th>In Bearbeitung</th>
                </tr>
              </thead>
              <tbody>
                {liste.faelle.map((fall) => (
                  <tr
                    key={fall.id}
                    className={fall.id === gewaehlt ? 'row--selected' : undefined}
                    onClick={() => void oeffnen(fall.id)}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={markiert.includes(fall.id)}
                        onChange={(event) =>
                          setMarkiert(
                            event.target.checked
                              ? [...markiert, fall.id]
                              : markiert.filter((id) => id !== fall.id)
                          )
                        }
                      />
                    </td>
                    <td>{fall.datensatz}</td>
                    <td>{fall.art}</td>
                    <td>{KRITIKALITAET_LABELS[fall.kritikalitaet]}</td>
                    <td>{STATUS_LABELS[fall.status]}</td>
                    <td className="muted">{fall.sperre?.benutzerName ?? fall.sperre?.benutzer ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {markiert.length > 1 && (
        <section className="card">
          <h2>{markiert.length} Fälle gemeinsam bearbeiten</h2>
          <p className="muted">
            Vor der Ausführung wird gezeigt, was geschieht - und mit welchen Fällen es nicht geht. Jede Änderung trägt
            danach dieselbe Vorgangskennung.
          </p>

          <div className="row">
            <Field label="Entscheidung">
              <select value={massenart} onChange={(event) => setMassenart(event.target.value as Entscheidungsart)}>
                {akzeptierenErlaubt && <option value="AKZEPTIEREN">{ENTSCHEIDUNG_LABELS.AKZEPTIEREN}</option>}
                <option value="ZURUECKSTELLEN">{ENTSCHEIDUNG_LABELS.ZURUECKSTELLEN}</option>
                <option value="NICHT_ZUSAMMENFUEHREN">{ENTSCHEIDUNG_LABELS.NICHT_ZUSAMMENFUEHREN}</option>
              </select>
            </Field>

            <button className="secondary" disabled={busy} onClick={() => void massenZeigen()}>
              Was würde geschehen?
            </button>

            <button disabled={busy || !massenvorschau} onClick={() => void massenEntscheiden()}>
              Auf {massenvorschau?.moeglich ?? 0} Fälle anwenden
            </button>
          </div>

          {massenvorschau && (
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Datensatz</th>
                  <th>Geht das?</th>
                  <th>Warum nicht</th>
                </tr>
              </thead>
              <tbody>
                {massenvorschau.betroffen.map((eintrag) => (
                  <tr key={eintrag.id}>
                    <td>{eintrag.datensatz}</td>
                    <td>{eintrag.zulaessig ? 'ja' : 'nein'}</td>
                    <td className="muted">{eintrag.grund ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {ansicht && (
        <Fall
          ansicht={ansicht}
          akzeptierenErlaubt={akzeptierenErlaubt}
          wahlen={wahlen}
          vorschau={vorschau}
          busy={busy}
          onWahl={(feld, wahl) => {
            setWahlen({ ...wahlen, [feld]: wahl });
            setVorschau(undefined);
          }}
          onZeigen={(art) => void zeigen(art)}
          onEntscheiden={(art) => void entscheiden(art)}
          onSperre={(los) => void sperren(los)}
        />
      )}
    </>
  );
}


/**
 * Die Ausleitungen des Konfliktbestands (SPEC-01, Abschnitt 23).
 *
 * ## Wozu eine Datei, wenn alles in der Datenbank steht
 *
 * Zum Weitergeben. Wer einem Lieferanten sagen will, was an seinen Daten nicht
 * stimmt, schickt ihm keine Zugangsdaten zu Unikom. Die Konfliktdatei trägt
 * die UUIDs mit, damit ein Fall auch außerhalb wiedererkennbar bleibt.
 *
 * ## Und warum sie wieder verschwindet
 *
 * Sie führt den Bestand nicht. Nach Ablauf der Aufbewahrungsfrist räumt Unikom
 * sie fort — Konfliktfall, Entscheidungen und Historie bleiben. Der **Eintrag**
 * bleibt ebenfalls stehen: Wer im März wissen will, warum eine Datei vom Januar
 * nicht mehr da ist, findet hier die Antwort und nicht eine Lücke, die nach
 * einem Fehler aussieht.
 *
 * ## Kein Pfadfeld
 *
 * Die Datei landet im Verzeichnis des Mandanten, in einem festen Unterordner.
 * Wer eine Konfliktdatei weitergeben will, soll sich keinen Pfad ausdenken
 * müssen, und wer sie später sucht, soll wissen, wo sie liegt.
 */
function Ausleitungen({ mandant }: { mandant: string }) {
  const [liste, setListe] = useState<Ausleitung[]>();
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string>();

  async function laden(): Promise<void> {
    try {
      setListe(await api.get<Ausleitung[]>(`/api/conflicts/exports?tenantId=${encodeURIComponent(mandant)}`));
    } catch (error) {
      setFehler(messageOf(error, 'Die Ausleitungen ließen sich nicht laden'));
    }
  }

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandant]);

  async function ausleiten(): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      await api.post<Ausleitung>('/api/conflicts/export', { tenantId: mandant });
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Ausleitung ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Ausleitungen</h2>

      {fehler && <Notice kind="warn">{fehler}</Notice>}

      <p className="muted">
        Eine Konfliktdatei ist eine Abschrift zum Weitergeben. Sie trägt die Kennungen der Fälle und wird nach
        Ablauf der Aufbewahrungsfrist fortgeräumt - Fälle, Entscheidungen und Historie bleiben davon unberührt.
      </p>

      <div className="row">
        <button type="button" className="secondary" disabled={busy} onClick={() => void ausleiten()}>
          {busy ? 'Wird geschrieben …' : 'Konflikte ausleiten'}
        </button>
      </div>

      {liste && liste.length === 0 && <Empty>Noch nichts ausgeleitet.</Empty>}

      {liste && liste.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Datei</th>
                <th>Art</th>
                <th>Fälle</th>
                <th>Angelegt</th>
                <th>Zustand</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((ausleitung) => (
                <tr key={ausleitung.id}>
                  <td>
                    <div>{ausleitung.name}</div>
                    <div className="muted">{ausleitung.pfad}</div>
                  </td>
                  <td>{ausleitung.art === 'ZIEL' ? 'Konfliktziel' : 'Konflikte'}</td>
                  <td>{ausleitung.faelle}</td>
                  <td className="muted">
                    {new Date(ausleitung.erstellt).toLocaleString('de-DE')}
                    {ausleitung.erstelltVonName ? ` · ${ausleitung.erstelltVonName}` : ''}
                  </td>
                  <td>
                    {ausleitung.entferntAm ? (
                      <span className="badge badge--muted" title={`fortgeräumt am ${ausleitung.entferntAm}`}>
                        fortgeräumt
                      </span>
                    ) : (
                      <span className="badge badge--good">liegt</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Die Läufe, zu denen bereinigte Fälle vorliegen.
 *
 * Der Korrekturlauf rechnet auf **einer** Lieferung, und die steht im
 * Archivpaket eines bestimmten Laufs. „Alle bereinigten Fälle des Mandanten"
 * ist keine Lieferung, sondern eine Auswahl über mehrere — deshalb wird der
 * Lauf gewählt und nicht weggelassen.
 */
export function laeufeMitBereinigten(faelle: readonly Konfliktfall[]): { laufId: string; faelle: number }[] {
  const gezaehlt = new Map<string, number>();

  for (const fall of faelle) {
    if (fall.status === 'BEREINIGT') {
      gezaehlt.set(fall.laufId, (gezaehlt.get(fall.laufId) ?? 0) + 1);
    }
  }

  return [...gezaehlt]
    .map(([laufId, anzahl]) => ({ laufId, faelle: anzahl }))
    .sort((eins, zwei) => eins.laufId.localeCompare(zwei.laufId));
}

function Freigabe({
  stand,
  laeufe,
  busy,
  onFreigeben,
}: {
  stand: Konfliktliste['stand'];
  laeufe: { laufId: string; faelle: number }[];
  busy: boolean;
  onFreigeben(laufId: string): void;
}) {
  const [gewaehlt, setGewaehlt] = useState('');
  const lauf = laeufe.find((eintrag) => eintrag.laufId === gewaehlt) ?? laeufe[0];

  return (
    <section className="card">
      <h2>Stand der Bearbeitung</h2>

      <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
        <Kennzahl name="Gesamt" wert={stand.gesamt} />
        <Kennzahl name="Offen" wert={stand.offen} />
        <Kennzahl name="Zurückgestellt" wert={stand.zurueckgestellt} />
        <Kennzahl name="Bereinigt" wert={stand.bereinigt} />
        <Kennzahl name="Akzeptiert" wert={stand.akzeptiert} />
        <Kennzahl name="Kritisch offen" wert={stand.kritischOffen} schlecht={stand.kritischOffen > 0} />
        <Kennzahl name="Erfolgreich" wert={stand.erfolgreich} />
      </div>

      {stand.freigabeMoeglich ? (
        <>
          <Notice kind="info">
            Es wartet kein Fall mehr auf eine Entscheidung. Der Korrekturlauf rechnet die ursprüngliche Lieferung
            noch einmal - diesmal mit den getroffenen Entscheidungen. Er bekommt eine eigene Verarbeitungs-ID und
            verweist auf den ursprünglichen Lauf; sein Ergebnis ersetzt das zurückgehaltene.
          </Notice>

          {/*
            * Die Auswahl nur, wo es etwas zu wählen gibt.
            *
            * Bei einem einzigen Lauf wäre sie ein Feld mit genau einem Eintrag —
            * eine Frage, auf die es nur eine Antwort gibt, lässt man besser weg.
            */}
          {laeufe.length > 1 && (
            <Field label="Lauf">
              <select value={lauf?.laufId ?? ''} onChange={(event) => setGewaehlt(event.target.value)}>
                {laeufe.map((eintrag) => (
                  <option key={eintrag.laufId} value={eintrag.laufId}>
                    {eintrag.laufId} ({eintrag.faelle} bereinigt)
                  </option>
                ))}
              </select>
            </Field>
          )}

          <button disabled={busy || !lauf} onClick={() => lauf && onFreigeben(lauf.laufId)}>
            {lauf ? `${lauf.faelle} bereinigte Fälle aus Lauf ${lauf.laufId} erneut verarbeiten` : 'Nichts zu tun'}
          </button>
        </>
      ) : (
        stand.hindernisse.length > 0 && (
          <>
            <p className="muted">
              {stand.hindernisse.length} Fall/Fälle verhindern die erneute Verarbeitung:
            </p>
            <ul>
              {stand.hindernisse.slice(0, 5).map((hindernis) => (
                <li key={hindernis.id}>
                  <strong>{hindernis.datensatz}</strong> ({KRITIKALITAET_LABELS[hindernis.kritikalitaet]},{' '}
                  {STATUS_LABELS[hindernis.status]}) - {hindernis.ursache}
                </li>
              ))}
              {stand.hindernisse.length > 5 && <li className="muted">… und {stand.hindernisse.length - 5} weitere</li>}
            </ul>
          </>
        )
      )}
    </section>
  );
}

function Fall({
  ansicht,
  akzeptierenErlaubt,
  wahlen,
  vorschau,
  busy,
  onWahl,
  onZeigen,
  onEntscheiden,
  onSperre,
}: {
  ansicht: Konfliktansicht;
  akzeptierenErlaubt: boolean;
  wahlen: Record<string, Wahl>;
  vorschau?: Anwendung;
  busy: boolean;
  onWahl(feld: string, wahl: Wahl): void;
  onZeigen(art: Entscheidungsart): void;
  onEntscheiden(art: Entscheidungsart): void;
  onSperre(los: boolean): void;
}) {
  const { fall } = ansicht;
  const arten = moeglich(fall, akzeptierenErlaubt);
  const braucht = arten.includes('BEREINIGEN') ? 'BEREINIGEN' : arten[0];

  return (
    <section className="card">
      <h2>{fall.datensatz}</h2>
      <p className="muted">
        {fall.art} · {KRITIKALITAET_LABELS[fall.kritikalitaet]} · {STATUS_LABELS[fall.status]} · Fassung {fall.fassung}
        {fall.entstandenAus && ' · aus einem früheren Fall hervorgegangen'}
      </p>

      {!ansicht.bearbeitbar && <Notice kind="warn">{ansicht.grund}</Notice>}

      <dl className="details">
        <dt>Ursache</dt>
        <dd>{fall.ursache}</dd>
        <dt>Erwartet</dt>
        <dd>{fall.erwartet}</dd>
        <dt>Vorgefunden</dt>
        <dd>{fall.vorgefunden}</dd>
        <dt>Nächste Schritte</dt>
        <dd>{fall.naechsteSchritte}</dd>
        <dt>Quellen</dt>
        <dd>{fall.quellen.join(', ') || '-'}</dd>
      </dl>

      {fall.felder.map((feld) => (
        <Feldwahl key={feld.feld} feld={feld} wahl={wahlen[feld.feld]} onWahl={(wahl) => onWahl(feld.feld, wahl)} />
      ))}

      {vorschau && (
        <div className="card card--inner">
          <strong>Das würde geschehen</strong>
          <dl className="details">
            {vorschau.herkunft.map((eintrag) => (
              <div key={eintrag.feld} style={{ display: 'contents' }}>
                <dt>{eintrag.feld}</dt>
                <dd>
                  {eintrag.wert === '' ? <span className="muted">leer</span> : eintrag.wert}{' '}
                  <span className="muted">- {eintrag.begruendung}</span>
                </dd>
              </div>
            ))}
          </dl>

          {vorschau.befunde.map((befund, stelle) => (
            <Notice key={stelle} kind={befund.schwere === 'INFO' ? 'info' : 'error'}>
              {befund.ursache} - {befund.auswirkung}
            </Notice>
          ))}

          {!vorschau.zulaessig && (
            <p className="muted">
              So lässt sich das nicht bestätigen. Die Fachregeln gelten auch für einen Wert, den ein Mensch eingibt.
            </p>
          )}
        </div>
      )}

      <div className="row">
        {fall.sperre ? (
          <button className="secondary" disabled={busy} onClick={() => onSperre(true)}>
            Bearbeitung freigeben
          </button>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => onSperre(false)}>
            In Bearbeitung nehmen
          </button>
        )}

        {braucht && (
          <button className="secondary" disabled={busy} onClick={() => onZeigen(braucht)}>
            Was würde geschehen?
          </button>
        )}

        {arten.map((art) => (
          <button
            key={art}
            disabled={busy || !ansicht.bearbeitbar || (art === 'BEREINIGEN' && vorschau?.zulaessig !== true)}
            onClick={() => onEntscheiden(art)}
          >
            {ENTSCHEIDUNG_LABELS[art]}
          </button>
        ))}
      </div>

      {arten.length === 0 && (
        <Notice kind="info">Dieser Fall ist abgeschlossen. Was danach kommt, ist ein neuer Fall.</Notice>
      )}

      <h3>Was bisher geschah</h3>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Was</th>
            <th>Wer</th>
            <th>Wann</th>
            <th>Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {ansicht.historie.map((schritt) => (
            <tr key={schritt.nummer}>
              <td>{schritt.nummer}</td>
              <td>
                {schritt.entscheidung ?? schritt.art}
                {schritt.vorgang && <div className="muted">Massenvorgang {schritt.vorgang.slice(0, 8)}</div>}
              </td>
              <td>{schritt.benutzerName ?? schritt.benutzer}</td>
              <td className="muted">{schritt.zeitpunkt}</td>
              <td>
                {schritt.nachStatus && STATUS_LABELS[schritt.nachStatus]}
                {schritt.nachher && (
                  <div className="muted">
                    {Object.entries(schritt.nachher)
                      .map(([feld, wert]) => `${feld} = „${wert}"`)
                      .join(', ')}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Die Gegenüberstellung eines Feldes (SPEC-07, Abschnitt 4 und 7).
 *
 * Die vorhandenen Werte stehen als Auswahl da, die Eingabe daneben. Beides
 * nebeneinander und nicht hintereinander: Wer erst „eigener Wert" anklicken
 * muss, um zu sehen, dass es die Möglichkeit gibt, findet sie nicht.
 */
function Feldwahl({ feld, wahl, onWahl }: { feld: Streitfeld; wahl?: Wahl; onWahl(wahl: Wahl): void }) {
  return (
    <div className="card card--inner">
      <strong>{feld.feld}</strong>
      {feld.typ && <span className="muted"> · erwartet wird {feld.typ}</span>}

      {feld.angebote.length === 0 ? (
        <p className="muted">Für dieses Feld liegt kein Wert vor. Er ist einzutragen.</p>
      ) : (
        feld.angebote.map((angebot) => (
          <label key={angebot.quelle} className="check">
            <input
              type="radio"
              name={feld.feld}
              checked={wahl?.art === 'QUELLE' && wahl.quelle === angebot.quelle}
              onChange={() => onWahl({ art: 'QUELLE', quelle: angebot.quelle })}
            />
            <span>
              „{angebot.wert}" <span className="muted">aus {angebot.quelle}</span>
              {angebot.metadaten &&
                Object.entries(angebot.metadaten).map(([name, wert]) => (
                  <span key={name} className="muted">
                    {' '}
                    · {wert}
                  </span>
                ))}
            </span>
          </label>
        ))
      )}

      <label className="check">
        <input
          type="radio"
          name={feld.feld}
          checked={wahl?.art === 'EINGABE'}
          onChange={() => onWahl({ art: 'EINGABE', wert: '' })}
        />
        <span>Eigener Wert</span>
      </label>

      {wahl?.art === 'EINGABE' && (
        <input
          value={wahl.wert}
          autoFocus
          placeholder="Wert eintragen"
          onChange={(event) => onWahl({ art: 'EINGABE', wert: event.target.value })}
        />
      )}

      <label className="check">
        <input
          type="radio"
          name={feld.feld}
          checked={wahl?.art === 'LEER'}
          onChange={() => onWahl({ art: 'LEER' })}
        />
        <span>Ausdrücklich leer lassen</span>
      </label>
    </div>
  );
}

function Kennzahl({ name, wert, schlecht }: { name: string; wert: number; schlecht?: boolean }) {
  return (
    <div>
      <div className="muted">{name}</div>
      <div className={schlecht ? 'figure__value figure__value--bad' : 'figure__value'}>{wert}</div>
    </div>
  );
}
