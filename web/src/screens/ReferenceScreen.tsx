import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Referenzquelle, RemoteDirectoryResult } from '../api/types.js';
import { Empty, Field, Notice } from '../components/Pieces.js';
import { Dateifeld, Verzeichnisfeld } from '../components/Verzeichniswahl.js';

/**
 * Referenzquellen verwalten (SPEC-04, Abschnitt 6 und 8).
 *
 * ## Warum es diesen Bildschirm gibt
 *
 * Der Referenzabgleich war gebaut und vom Workflow aus **unerreichbar**: Ein
 * Lauf übergab nie einen Bestand, weil es keine Stelle gab, an der einer steht.
 * Das ist diese Stelle.
 *
 * ## Hier steht der Verweis, nicht die Datenmenge
 *
 * Name, Verzeichnis, Datei, Version. Die Kundenliste selbst bleibt, wo sie ist.
 * Sie in jeden Workflow zu kopieren ergäbe so viele Stände wie Workflows, und
 * beim nächsten Umzug wüsste niemand, welcher gilt.
 *
 * ## Die Version ist keine Zierde
 *
 * Wer im März wissen will, warum ein Datensatz im Januar durchging und heute
 * ein Prüffall ist, muss sagen können, welcher Stand damals galt. Ohne eigene
 * Angabe gilt das Änderungsdatum der Datei — genau und nichtssagend, aber eine
 * Tatsache.
 */
const LEER = { name: '', beschreibung: '', verzeichnis: '', datei: '', version: '' };

/**
 * Aus dem vollen Pfad wird der Dateiname — solange die Datei im eingestellten
 * Verzeichnis liegt.
 *
 * Die Referenzquelle trägt Verzeichnis und Datei getrennt, und das bleibt so:
 * „leer heißt die erste lesbare" ist eine Aussage über ein Verzeichnis und
 * nicht über einen Pfad. Wer im Fenster in einen anderen Ordner wandert,
 * bekommt den vollen Pfad ins Feld — und sieht damit, dass er woanders gelandet
 * ist, statt dass Unikom es stillschweigend zurechtbiegt.
 */
function nurName(pfad: string, verzeichnis: string): string {
  const trenner = ['/', String.fromCharCode(92)];
  const ohneEnde = (text: string): string =>
    trenner.includes(text.at(-1) ?? '') ? ohneEnde(text.slice(0, -1)) : text;
  const ohneAnfang = (text: string): string =>
    trenner.includes(text[0] ?? '') ? ohneAnfang(text.slice(1)) : text;

  const vorne = ohneEnde(verzeichnis);

  if (vorne && pfad.startsWith(vorne)) {
    return ohneAnfang(pfad.slice(vorne.length));
  }

  return pfad;
}

/**
 * Der Mandant kommt von außen und wird nicht mehr hier gewählt — siehe
 * `TenantsScreen`: Was zuerst nach einem Kunden fragt, ist ein Bildschirm
 * dieses Kunden.
 */
export function ReferenceScreen({ mandant }: { mandant: string }) {
  const quellen = useResource<Referenzquelle[]>(
    `/api/reference-sources?tenantId=${encodeURIComponent(mandant)}`
  );

  const [entwurf, setEntwurf] = useState(LEER);

  /*
   * Örtlich durchsehen: Eine Referenzdatei liegt auf dem Rechner, auf dem
   * Unikom läuft. Derselbe Aufruf für Verzeichnis und Datei — zwei würden sich
   * früher oder später darüber uneins, was ein eingetippter Pfad bedeutet.
   */
  const durchsehen = (pfad: string): Promise<RemoteDirectoryResult> =>
    api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
      name: 'Referenzquelle',
      tenantId: mandant,
      directory: pfad,
      known: [],
      sourceType: 'LOCAL',
    });
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string>();
  const [meldung, setMeldung] = useState<string>();

  async function speichern(): Promise<void> {
    setBusy(true);
    setFehler(undefined);
    setMeldung(undefined);

    try {
      await api.post<Referenzquelle>('/api/reference-sources', {
        tenantId: mandant,
        name: entwurf.name,
        description: entwurf.beschreibung || undefined,
        directory: entwurf.verzeichnis,
        file: entwurf.datei || undefined,
        version: entwurf.version || undefined,
      });

      setEntwurf(LEER);
      quellen.reload();
    } catch (error) {
      setFehler(messageOf(error, 'Die Referenzquelle ließ sich nicht speichern'));
    } finally {
      setBusy(false);
    }
  }

  async function nachsehen(quelle: Referenzquelle): Promise<void> {
    setBusy(true);
    setFehler(undefined);
    setMeldung(undefined);

    try {
      const geprueft = await api.post<Referenzquelle>(`/api/reference-sources/${quelle.id}/check`, {
        tenantId: mandant,
      });

      setMeldung(
        `„${geprueft.name}": ${geprueft.gesehen?.zeilen} Eintrag/Einträge in ${geprueft.gesehen?.datei}, ` +
          `Felder ${geprueft.gesehen?.felder.join(', ')}`
      );
      quellen.reload();
    } catch (error) {
      setFehler(messageOf(error, 'Das Nachsehen ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  async function entfernen(quelle: Referenzquelle): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      await api.delete(`/api/reference-sources/${quelle.id}`);
      quellen.reload();
    } catch (error) {
      setFehler(messageOf(error, 'Die Referenzquelle ließ sich nicht entfernen'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}
      {meldung && <Notice kind="info">{meldung}</Notice>}

      <section className="card">
        <h2>Referenzquellen</h2>

        <p className="muted">
          Ein Nachschlagewerk, gegen das ein Konsolidierungsdurchgang abgleicht - ein Ortsverzeichnis, eine
          Kundenliste, ein Artikelstamm. Hier steht der Verweis darauf und nicht die Datenmenge: Die Datei bleibt,
          wo sie ist, und wird zum Lauf gelesen. <strong>Referenzdaten werden dabei nur gelesen</strong> und nie
          verändert.
        </p>

        {quellen.error && <Notice kind="warn">{quellen.error}</Notice>}

        {quellen.data && quellen.data.length === 0 && <Empty>Noch keine Referenzquelle eingetragen.</Empty>}

        {quellen.data && quellen.data.length > 0 && (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Datei</th>
                  <th>Version</th>
                  <th>Zuletzt gesehen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quellen.data.map((quelle) => (
                  <tr key={quelle.id}>
                    <td>
                      <div>{quelle.name}</div>
                      {quelle.beschreibung && <div className="muted">{quelle.beschreibung}</div>}
                    </td>
                    <td className="muted">
                      {quelle.datei ?? <em>erste lesbare Datei</em>}
                      <div>{quelle.verzeichnis}</div>
                    </td>
                    <td>
                      {quelle.version ?? (
                        <span className="muted" title="ohne eigene Angabe gilt das Änderungsdatum der Datei">
                          aus dem Änderungsdatum
                        </span>
                      )}
                    </td>
                    <td className="muted">
                      {quelle.gesehen ? (
                        <>
                          <div>
                            {quelle.gesehen.zeilen} Eintrag/Einträge in {quelle.gesehen.datei}
                          </div>
                          <div>{quelle.gesehen.felder.join(', ')}</div>
                        </>
                      ) : (
                        <em>noch nicht nachgesehen</em>
                      )}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void nachsehen(quelle)}
                        >
                          Nachsehen
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void entfernen(quelle)}
                        >
                          Entfernen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Referenzquelle eintragen</h3>

        <Field label="Name" explain="Unter ihm wird sie in Regeln und Berichten genannt.">
          <input
            value={entwurf.name}
            placeholder="PLZ-Verzeichnis"
            onChange={(event) => setEntwurf({ ...entwurf, name: event.target.value })}
          />
        </Field>

        <Field label="Wozu" explain="Für den, der sie in einem Jahr vorfindet.">
          <input
            value={entwurf.beschreibung}
            placeholder="Amtliches Ortsverzeichnis, Quartalsstand"
            onChange={(event) => setEntwurf({ ...entwurf, beschreibung: event.target.value })}
          />
        </Field>

        <Verzeichnisfeld
          label="Verzeichnis"
          titel="Verzeichnis der Referenzquelle wählen"
          wert={entwurf.verzeichnis}
          lies={durchsehen}
          onChange={(pfad) => setEntwurf({ ...entwurf, verzeichnis: pfad })}
        />

        <Dateifeld
          label="Datei"
          explain="Leer heißt: die erste lesbare Datei des Verzeichnisses."
          titel="Datei der Referenzquelle wählen"
          wert={entwurf.datei}
          start={entwurf.verzeichnis}
          disabled={!entwurf.verzeichnis.trim()}
          lies={durchsehen}
          onChange={(pfad) => setEntwurf({ ...entwurf, datei: nurName(pfad, entwurf.verzeichnis) })}
        />

        <Field
          label="Version"
          explain="Leer heißt: das Änderungsdatum der Datei. Ein Lauf, der sich nicht auf eine Version berufen kann, ist nicht reproduzierbar."
        >
          <input
            value={entwurf.version}
            placeholder="2026-Q1"
            onChange={(event) => setEntwurf({ ...entwurf, version: event.target.value })}
          />
        </Field>

        <div className="row">
          <button
            type="button"
            disabled={busy || !entwurf.name.trim() || !entwurf.verzeichnis.trim()}
            onClick={() => void speichern()}
          >
            Eintragen
          </button>
        </div>
      </section>
    </>
  );
}
