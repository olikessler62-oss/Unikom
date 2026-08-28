import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Job, KonsolidierungConfig } from '../api/types.js';
import { Empty, Field, Loading, Notice } from '../components/Pieces.js';

/**
 * Der Blick ins Archiv (FR_006, Runde 10).
 *
 * ## Wofür dieser Bildschirm da ist
 *
 * Das Archiv hält die Eingangsdateien im Original, verschlüsselt. Daran hängt
 * die Zusage, die das Zerlegen einer Lieferung überhaupt erlaubt: Erledigt und
 * Gescheitert tragen abgeleitete Dateien, das Original liegt im Archiv.
 *
 * Ein Rückweg, den nur der Quelltext kennt, löst diese Zusage nicht ein. Hier
 * steht der Mensch davor und fragt: Was hat der Lieferant am Dienstag
 * geschickt?
 *
 * ## Warum das Verzeichnis nicht getippt wird
 *
 * Es steht schon am Workflow. Wer es hier noch einmal eintippen müsste, tippt
 * es eines Tages falsch und sieht dann in ein leeres Verzeichnis — ohne zu
 * merken, dass er am falschen Ort sucht.
 */
interface Archivort {
  verzeichnis: string;
  workflow: string;
  durchgang?: string;
}

/** Jedes Archivverzeichnis, das an einem Workflow dieses Mandanten steht. */
export function archivorte(jobs: readonly Job[], tenantId: string): Archivort[] {
  const gefunden = new Map<string, Archivort>();

  const sammle = (job: Job, durchgang: KonsolidierungConfig | undefined, name?: string): void => {
    const verzeichnis = durchgang?.dateien?.abholung?.archiv;

    /*
     * Nach Verzeichnis und nicht je Durchgang: Zwei Durchgänge dürfen dasselbe
     * Archiv benutzen, und dann steht es einmal in der Auswahl und nicht
     * zweimal mit demselben Inhalt.
     */
    if (verzeichnis && !gefunden.has(verzeichnis)) {
      gefunden.set(verzeichnis, { verzeichnis, workflow: job.name, durchgang: name });
    }
  };

  for (const job of jobs.filter((eintrag) => eintrag.tenantId === tenantId)) {
    sammle(job, job.consolidation, job.consolidation?.name);

    for (const weiterer of job.consolidation?.weitere ?? []) {
      sammle(job, weiterer as KonsolidierungConfig, weiterer.name);
    }
  }

  return [...gefunden.values()].sort((eine, andere) => eine.verzeichnis.localeCompare(andere.verzeichnis, 'de'));
}

interface Paket {
  name: string;
  pfad: string;
  geaendert?: string;
}

interface Inhalt {
  pfad: string;
  dateien: { name: string; groesse: number }[];
}

/**
 * Der Mandant kommt von außen und wird nicht mehr hier gewählt — siehe
 * `TenantsScreen`. Ein Archiv ist die Ablage **dieses** Kunden; die Frage
 * „wessen Archiv?" gehört nicht auf den Bildschirm, sondern darüber.
 */
export function ArchivScreen({ mandant }: { mandant: string }) {
  const jobs = useResource<Job[]>('/api/jobs');

  const [ort, setOrt] = useState<string>();
  const [pakete, setPakete] = useState<Paket[]>();
  const [inhalt, setInhalt] = useState<Inhalt>();
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);

  const orte = jobs.data ? archivorte(jobs.data, mandant) : [];
  const gewaehlt = ort && orte.some((eintrag) => eintrag.verzeichnis === ort) ? ort : orte[0]?.verzeichnis;

  useEffect(() => {
    if (!mandant || !gewaehlt) {
      setPakete(undefined);
      setInhalt(undefined);

      return;
    }

    let abgelöst = false;

    setInhalt(undefined);
    setFehler(undefined);

    api
      .get<Paket[]>(
        `/api/archive/packages?tenantId=${encodeURIComponent(mandant)}&directory=${encodeURIComponent(gewaehlt)}`
      )
      .then((geladen) => {
        if (!abgelöst) {
          setPakete(geladen);
        }
      })
      .catch((problem) => {
        if (!abgelöst) {
          setPakete([]);
          setFehler(messageOf(problem, 'Das Archiv ließ sich nicht auflisten'));
        }
      });

    return () => {
      abgelöst = true;
    };
  }, [mandant, gewaehlt]);

  async function oeffne(paket: Paket): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      setInhalt(await api.post<Inhalt>('/api/archive/open', { tenantId: mandant, pfad: paket.pfad }));
    } catch (problem) {
      setInhalt(undefined);
      setFehler(messageOf(problem, `„${paket.name}" ließ sich nicht öffnen`));
    } finally {
      setBusy(false);
    }
  }

  async function hole(name: string): Promise<void> {
    if (!inhalt) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      const datei = await api.post<{ name: string; inhalt: string }>('/api/archive/file', {
        tenantId: mandant,
        pfad: inhalt.pfad,
        name,
      });

      speichern(datei.name, datei.inhalt);
    } catch (problem) {
      setFehler(messageOf(problem, `„${name}" ließ sich nicht herausholen`));
    } finally {
      setBusy(false);
    }
  }

  if (jobs.loading) {
    return <Loading />;
  }

  return (
    <>
      <section className="card">
        <h2>Archiv</h2>
        <p className="muted">
          Die Eingangsdateien, wie sie ankamen - verschlüsselt abgelegt, bevor der Lauf sie angefasst hat.
        </p>

        {orte.length === 0 ? (
          <Notice kind="info">
            Für diesen Mandanten ist an keinem Workflow ein Archivverzeichnis eingetragen. Es steht am
            Konsolidierungsschritt unter „Verzeichnisse festlegen".
          </Notice>
        ) : (
          <Field
            label="Archivverzeichnis"
            explain="Die Verzeichnisse, die an den Workflows dieses Mandanten stehen. Getippt wird hier nichts - ein Tippfehler führte in ein leeres Verzeichnis, ohne dass jemand merkt, dass er am falschen Ort sucht."
          >
            <select className="input--wahl" value={gewaehlt ?? ''} onChange={(event) => setOrt(event.target.value)}>
              {orte.map((eintrag) => (
                <option key={eintrag.verzeichnis} value={eintrag.verzeichnis}>
                  {eintrag.verzeichnis} - {eintrag.workflow}
                  {eintrag.durchgang ? ` / ${eintrag.durchgang}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
      </section>

      {fehler && <Notice kind="error">{fehler}</Notice>}

      {pakete && (
        <section className="card">
          <h3>Lieferungen</h3>

          {pakete.length === 0 ? (
            <Empty>In diesem Archiv liegt noch nichts.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Paket</th>
                    <th>Abgelegt</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pakete.map((paket) => (
                    <tr key={paket.pfad} className={inhalt?.pfad === paket.pfad ? 'row--selected' : undefined}>
                      <td>{paket.name}</td>
                      <td className="muted">{paket.geaendert ?? '-'}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="secondary" disabled={busy} onClick={() => void oeffne(paket)}>
                            Öffnen
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
      )}

      {inhalt && (
        <section className="card">
          <h3>Was darin steckt</h3>
          <p className="muted">{inhalt.pfad}</p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datei</th>
                  <th className="numeric">Bytes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inhalt.dateien.map((datei) => (
                  <tr key={datei.name}>
                    <td>{datei.name}</td>
                    <td className="numeric">{datei.groesse}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="secondary" disabled={busy} onClick={() => void hole(datei.name)}>
                          Speichern
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * Die Datei beim Benutzer ablegen.
 *
 * Aus Base64 und nicht aus Text: Im Archiv liegt, was der Lieferant geschickt
 * hat — auch eine Arbeitsmappe. Sie unterwegs durch eine Zeichenkette zu
 * schicken machte sie kaputt, und zwar unbemerkt.
 */
function speichern(name: string, base64: string): void {
  const roh = atob(base64);
  const bytes = new Uint8Array(roh.length);

  for (let stelle = 0; stelle < roh.length; stelle += 1) {
    bytes[stelle] = roh.charCodeAt(stelle);
  }

  const link = window.document.createElement('a');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));

  link.href = url;
  link.download = name;
  link.click();

  URL.revokeObjectURL(url);
}
