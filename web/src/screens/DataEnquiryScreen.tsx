import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type {
  Auskunft,
  Behandlung,
  Bestandsauskunft,
  Frist,
  Loeschbericht,
  PrivacyReport,
  Tenant,
} from '../api/types.js';
import { Empty, Field, formatMoment, Loading, Modal, Notice, Reiter } from '../components/Pieces.js';

type Teil = 'suche' | 'bogen';

const TEILE: readonly { id: Teil; text: string }[] = [
  { id: 'suche', text: 'Auskunft und Löschung' },
  { id: 'bogen', text: 'Was diese Installation speichert' },
];

/**
 * Auskunft, Löschauftrag und die Auskunftsseite (FR_009, Abschnitte 5, 6 und 9).
 *
 * Zwei Aufgaben, ein Ort: Wer eine Löschung ausführt, sollte im selben Fenster
 * nachlesen können, was diese Installation überhaupt speichert und wie lange —
 * die Frage kommt beim Löschen unweigerlich auf. Getrennt bleiben sie nur in
 * der Ansicht, weil der eine sucht und der andere liest.
 *
 * Nicht zu verwechseln mit `PrivacyScreen`: Das ist die Datenschutzerklärung
 * für jeden Besucher. Hier stehen die Daten dieser Installation, und dafür
 * braucht es Verwaltungsrechte.
 */

const BEHANDLUNG: Record<Behandlung, string> = {
  LOESCHEN: 'wird gelöscht',
  SCHWAERZEN: 'wird unkenntlich gemacht',
  ANZEIGEN: 'wird nur angezeigt',
};

const ORT: Record<string, string> = {
  DATENBANK: 'Datenbank',
  DATEISYSTEM: 'Dateisystem',
};

const PERSONENBEZUG: Record<string, string> = {
  JA: 'ja',
  MITTELBAR: 'mittelbar',
  NEIN: 'nein',
};

/** Der kleinste Begriff, den der Server annimmt — hier nur, um früher zu antworten. */
const MIN_BEGRIFF = 3;

/**
 * Eine Datei aus einer Antwort des Servers.
 *
 * Erzeugt wird sie dort, gespeichert hier: Der Bildschirm zeigt eine Auswahl,
 * die Datei muss vollständig sein. Aus dem Angezeigten eine Auskunft zu bauen
 * hieße, eine Kürzung auszuliefern, die niemand angeordnet hat.
 */
function speichern(datei: { filename: string; text: string }): void {
  const link = window.document.createElement('a');
  const url = URL.createObjectURL(new Blob([datei.text], { type: 'text/plain;charset=utf-8' }));

  link.href = url;
  link.download = datei.filename;
  link.click();

  URL.revokeObjectURL(url);
}

function Fundstellen({ bestand }: { bestand: Bestandsauskunft }) {
  const [offen, setOffen] = useState(false);

  if (bestand.treffer === 0) {
    return <span className="muted">—</span>;
  }

  return (
    <>
      <button className="secondary" onClick={() => setOffen(!offen)}>
        {offen ? 'Fundstellen verbergen' : `${bestand.funde.length} Fundstelle(n) ansehen`}
      </button>

      {offen && (
        <div className="browse" style={{ marginTop: '0.8rem' }}>
          {bestand.funde.map((fund, stelle) => (
            <div key={`${fund.wo}-${stelle}`} style={{ marginBottom: '0.6rem' }}>
              <div className="cell__sub">
                {fund.wo}
                {fund.wann ? ` · ${formatMoment(fund.wann)}` : ''}
              </div>
              <code>{fund.auszug}</code>
            </div>
          ))}

          {bestand.funde.length < bestand.treffer && (
            <p className="muted">
              Hier stehen {bestand.funde.length} von {bestand.treffer}. Die vollständige Aufstellung steht in der
              Datei — der Bildschirm kürzt, die Auskunft nicht.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Fristenliste({ fristen }: { fristen: Frist[] }) {
  return (
    <ul className="prose">
      {fristen.map((frist) => (
        <li key={frist.was}>
          <strong>{frist.was}:</strong> {frist.wert}
          {frist.voreingestellt && <span className="badge badge--muted"> Voreinstellung</span>}
          {frist.hinweis && <div className="cell__sub">{frist.hinweis}</div>}
        </li>
      ))}
    </ul>
  );
}

export function DataEnquiryScreen() {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const bogen = useResource<PrivacyReport>('/api/privacy/report');
  const [teil, setTeil] = useState<Teil>('suche');
  const [begriff, setBegriff] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [auskunft, setAuskunft] = useState<Auskunft>();
  const [bericht, setBericht] = useState<Loeschbericht>();
  const [nachfrage, setNachfrage] = useState(false);
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (tenants.error || bogen.error) {
    return <Notice kind="error">{tenants.error ?? bogen.error}</Notice>;
  }

  if (!tenants.data || !bogen.data) {
    return <Loading />;
  }

  const auftrag = { term: begriff.trim(), tenantId: tenantId === '' ? undefined : tenantId };
  const mandant = tenants.data.find((eintrag) => eintrag.id === tenantId)?.name;
  const zuLoeschen = auskunft?.bestaende.filter((bestand) => bestand.behandlung !== 'ANZEIGEN' && bestand.treffer > 0);
  const stehenBleibt = auskunft?.bestaende.filter((bestand) => bestand.behandlung === 'ANZEIGEN' && bestand.treffer > 0);

  async function laufen<T>(arbeit: () => Promise<T>, misslungen: string): Promise<T | undefined> {
    setBusy(true);
    setFehler(undefined);

    try {
      return await arbeit();
    } catch (error) {
      setFehler(messageOf(error, misslungen));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function suchen(): Promise<void> {
    // Ein neuer Suchlauf wirft den alten Bericht fort: Sonst stünde unter einem
    // frischen Ergebnis noch die Bestätigung einer anderen Löschung.
    setBericht(undefined);
    setAuskunft(await laufen(() => api.post<Auskunft>('/api/privacy/search', auftrag), 'Die Suche ist misslungen'));
  }

  async function ausleiten(): Promise<void> {
    const datei = await laufen(
      () => api.post<{ filename: string; text: string }>('/api/privacy/export', auftrag),
      'Die Auskunft konnte nicht erstellt werden'
    );

    if (datei) {
      speichern(datei);
    }
  }

  async function loeschen(): Promise<void> {
    setNachfrage(false);

    const ergebnis = await laufen(
      () => api.post<Loeschbericht>('/api/privacy/erase', { ...auftrag, confirmed: true }),
      'Der Löschauftrag ist misslungen'
    );

    if (ergebnis) {
      setBericht(ergebnis);
      // Was gelöscht ist, darf nicht weiter als Fund auf dem Bildschirm stehen.
      setAuskunft(undefined);
    }
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}

      {/* Dieselbe Reiterzeile wie überall — sie stand hier von Hand und ohne Tastatur. */}
      <Reiter<Teil> stil="pille" reiter={TEILE} offen={teil} onOeffnen={setTeil} />

      {teil === 'suche' ? (
        <>
          <section className="card">
            <h2>Wen oder was suchen wir?</h2>

            <Field
              label="Suchbegriff"
              explain={
                <>
                  <p>
                    Ein Name, eine Kundennummer, eine E-Mail-Adresse — alles, woran die Person in den Daten zu
                    erkennen ist.
                  </p>
                  <p>
                    Gesucht wird über alle Bestände: Protokoll, Dateiliste und die Dateien in den
                    Mandantenverzeichnissen. Groß- und Kleinschreibung spielt keine Rolle, Umlaute auch nicht.
                  </p>
                  <p>
                    Mindestens {MIN_BEGRIFF} Zeichen. Ein kürzerer Begriff trifft halbe Bestände, und beim Löschen
                    ist das nicht mehr zu berichtigen.
                  </p>
                </>
              }
            >
              <input
                value={begriff}
                placeholder="Mustermann"
                onChange={(event) => setBegriff(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && auftrag.term.length >= MIN_BEGRIFF) {
                    void suchen();
                  }
                }}
              />
            </Field>

            <Field
              label="Mandant"
              explain={
                <>
                  <p>Ohne Auswahl wird die gesamte Installation durchsucht.</p>
                  <p>
                    Nicht jeder Bestand lässt sich eingrenzen. Wo es nicht geht, sagt Unikom es beim Ergebnis — und
                    löscht dort nichts, statt die Zeilen der übrigen Mandanten mitzunehmen.
                  </p>
                </>
              }
            >
              <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
                <option value="">Alle Mandanten</option>
                {tenants.data.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="row">
              <button disabled={busy || auftrag.term.length < MIN_BEGRIFF} onClick={() => void suchen()}>
                {busy ? 'Wird gesucht …' : 'Suchen'}
              </button>
            </div>
          </section>

          {auskunft && auskunft.treffer === 0 && (
            <Empty>
              Zu „{auskunft.begriff}" liegt in dieser Installation nichts vor
              {mandant ? ` — jedenfalls nicht bei ${mandant}` : ''}. Auch das ist eine Auskunft, und sie lässt sich
              als Datei speichern.
              <div className="row" style={{ marginTop: '1rem' }}>
                <button className="secondary" disabled={busy} onClick={() => void ausleiten()}>
                  Auskunft als Datei speichern
                </button>
              </div>
            </Empty>
          )}

          {auskunft && auskunft.treffer > 0 && (
            <section className="card">
              <h2>
                {auskunft.treffer} Fundstelle(n) zu „{auskunft.begriff}"
              </h2>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bestand</th>
                      <th>Fundstellen</th>
                      <th>Beim Löschen</th>
                      <th>Ansehen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auskunft.bestaende.map((bestand) => (
                      <tr key={bestand.key}>
                        <td>
                          {bestand.name}
                          {bestand.hinweis && <div className="cell__sub">{bestand.hinweis}</div>}
                        </td>
                        <td>{bestand.treffer}</td>
                        <td>
                          <span
                            className={
                              bestand.behandlung === 'ANZEIGEN' && bestand.treffer > 0
                                ? 'badge badge--warn'
                                : 'badge badge--muted'
                            }
                          >
                            {BEHANDLUNG[bestand.behandlung]}
                          </span>
                        </td>
                        <td>
                          <Fundstellen bestand={bestand} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ marginTop: '1.2rem' }}>
                <button className="secondary" disabled={busy} onClick={() => void ausleiten()}>
                  Auskunft als Datei speichern
                </button>
                <button disabled={busy || !zuLoeschen?.length} onClick={() => setNachfrage(true)}>
                  Daten löschen …
                </button>
              </div>

              {!zuLoeschen?.length && (
                <p className="muted">
                  Hier ist nichts zu löschen: Was gefunden wurde, liegt in Beständen, die Unikom nur anzeigt.
                </p>
              )}
            </section>
          )}

          {nachfrage && auskunft && (
            <Modal title="Löschauftrag ausführen?" tone="warn" ownActions onClose={() => setNachfrage(false)}>
              <p>
                Gelöscht wird nach dem Begriff <strong>„{auskunft.begriff}"</strong>
                {mandant ? (
                  <>
                    {' '}
                    beim Mandanten <strong>{mandant}</strong>
                  </>
                ) : (
                  ' in der gesamten Installation'
                )}
                . Das lässt sich nicht rückgängig machen.
              </p>

              <ul>
                {zuLoeschen?.map((bestand) => (
                  <li key={bestand.key}>
                    <strong>{bestand.name}:</strong> {bestand.treffer} Fundstelle(n) — {BEHANDLUNG[bestand.behandlung]}
                  </li>
                ))}
              </ul>

              {stehenBleibt?.length ? (
                <>
                  <p>
                    Nicht angefasst wird — hier bleibt Arbeit für einen Menschen:
                  </p>
                  <ul>
                    {stehenBleibt.map((bestand) => (
                      <li key={bestand.key}>
                        <strong>{bestand.name}:</strong> {bestand.treffer} Fundstelle(n)
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <p className="muted">
                Was schon in ein Ziel außerhalb geflossen ist, erreicht dieser Auftrag nicht. Dort ist gesondert
                nachzufassen.
              </p>

              <div className="row modal__actions">
                <button disabled={busy} onClick={() => void loeschen()}>
                  Ja, jetzt löschen
                </button>
                <button className="secondary" autoFocus onClick={() => setNachfrage(false)}>
                  Abbrechen
                </button>
              </div>
            </Modal>
          )}

          {bericht && (
            <section className="card">
              <h2>Löschauftrag ausgeführt</h2>

              <ul className="prose">
                {bericht.entfernt.map((eintrag) => (
                  <li key={eintrag.key}>
                    <strong>{eintrag.name}:</strong> {eintrag.stellen} Stelle(n){' '}
                    {eintrag.behandlung === 'SCHWAERZEN' ? 'unkenntlich gemacht' : 'gelöscht'}
                  </li>
                ))}
              </ul>

              <p className="prose">
                Unkenntlich gemacht heißt: Die Zeile bleibt, der Wert darin geht. Dass eine Verarbeitung
                stattgefunden hat, muss nachvollziehbar bleiben — der Name darin nicht.
              </p>

              {bericht.offen.length > 0 && (
                <>
                  <h3>Was von Hand zu prüfen bleibt</h3>
                  <ul className="prose">
                    {bericht.offen.map((bestand) => (
                      <li key={bestand.key}>
                        <strong>{bestand.name}:</strong> {bestand.treffer} Fundstelle(n)
                        {bestand.hinweis && <div className="cell__sub">{bestand.hinweis}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="row" style={{ marginTop: '1.2rem' }}>
                <button onClick={() => speichern(bericht.beleg)}>Beleg speichern</button>
              </div>

              <p className="muted">
                Der Beleg ist im Augenblick der Löschung entstanden. Später ließe er sich nicht mehr erzeugen — eine
                zweite Suche fände nichts mehr und belegte gar nichts.
              </p>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="card">
            <h2>Bestände</h2>
            <p className="prose">
              Vollständige Aufstellung dessen, was diese Installation führt — erzeugt aus ihrem tatsächlichen
              Zustand, nicht aus einer Vorlage. Ein Bestand, der hier fehlt, darf nicht entstehen.
            </p>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bestand</th>
                    <th>Inhalt</th>
                    <th>Ort</th>
                    <th>Personenbezug</th>
                    <th>Aufbewahrung</th>
                    <th>Bei einem Löschauftrag</th>
                  </tr>
                </thead>
                <tbody>
                  {bogen.data.bestaende.map((bestand) => (
                    <tr key={bestand.key}>
                      <td>{bestand.name}</td>
                      <td>{bestand.inhalt}</td>
                      <td>{ORT[bestand.ort] ?? bestand.ort}</td>
                      <td>{PERSONENBEZUG[bestand.personenbezug] ?? bestand.personenbezug}</td>
                      <td>{bestand.aufbewahrung}</td>
                      <td>
                        {BEHANDLUNG[bestand.behandlung]}
                        {!bestand.mandantenweise && (
                          <div className="cell__sub">nicht auf einen Mandanten eingrenzbar</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Fristen je Mandant</h2>
            <p className="prose">
              Eingestellt werden sie im jeweiligen Workflow. Hier stehen sie nur zusammen — wer sie beauskunften
              soll, müsste sie sonst aus jedem Editor einzeln zusammensuchen.
            </p>

            {bogen.data.fristen.map((mandantsfristen) => (
              <div key={mandantsfristen.tenantId} style={{ marginBottom: '1.6rem' }}>
                <h3>{mandantsfristen.name}</h3>
                <Fristenliste fristen={mandantsfristen.fristen} />

                {mandantsfristen.workflows.length === 0 ? (
                  <p className="muted">Kein Workflow — damit auch keine Fristen aus Workflows.</p>
                ) : (
                  mandantsfristen.workflows.map((workflow) => (
                    <div key={workflow.jobId} style={{ marginTop: '0.8rem' }}>
                      <strong>{workflow.name}</strong>
                      {!workflow.enabled && <span className="badge badge--muted"> ruht</span>}
                      <Fristenliste fristen={workflow.fristen} />
                    </div>
                  ))
                )}
              </div>
            ))}
          </section>

          <section className="card">
            <h2>Was gilt, ohne dass es jemand einstellt</h2>
            <ul className="prose">
              {bogen.data.zusagen.map((zusage) => (
                <li key={zusage}>{zusage}</li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Wer worauf Zugriff hat</h2>
            <div className="prose">
              <p>
                Es gibt zwei Berechtigungsstufen. <strong>Administratoren</strong> verwalten Benutzer, Zugänge und
                Mandanten und haben Zugang zu dieser Seite; <strong>normale Benutzer</strong> arbeiten mit den
                Workflows.
              </p>
              <p>
                Der Zugriff auf <strong>Konfliktdaten</strong> hängt daneben an einem eigenen Recht, das am einzelnen
                Benutzer erteilt wird. Dort stehen ursprüngliche Feldwerte im Klartext — der dichteste Personenbezug
                im ganzen System. Wer ihn sehen darf, soll namentlich feststehen und sich nicht aus einer Stufe
                ergeben, in der zwanzig Leute sind. Auch ein Administrator bekommt es nicht von selbst.
              </p>
              <p>
                Jede ändernde Handlung wird mit Benutzerkennung und Anmeldenamen protokolliert, dieser Löschauftrag
                eingeschlossen — allerdings ohne die gelöschten Werte zu wiederholen.
              </p>
            </div>
          </section>
        </>
      )}
    </>
  );
}
