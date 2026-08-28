import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf } from '../api/useResource.js';
import type {
  Befund,
  DataBlock,
  Dateiprobe,
  DiscoveryAnswer,
  Ebene,
  Erkennungsmodus,
  Herkunft,
  Qualitaetsbericht,
  RemoteDirectoryResult,
  Schwere,
  Snapshot,
} from '../api/types.js';
import {
  Empty,
  Field,
  FieldButton,
  FolderIcon,
  formatSize,
  Notice,
  titelBeiUeberlauf,
} from '../components/Pieces.js';
import { Verzeichnisfenster, verzeichnisTeil } from '../components/Verzeichniswahl.js';

const MODUS_LABELS: Record<Erkennungsmodus, string> = {
  AUTOMATIK: 'Automatisch',
  EINSTELLUNGEN: 'Nach Einstellungen',
  BEIDE: 'Einstellungen und Automatik',
};

const MODUS_HINTS: Record<Erkennungsmodus, string> = {
  AUTOMATIK: 'Unikom erkennt die Struktur allein aus dem Inhalt.',
  EINSTELLUNGEN: 'Es gilt die hinterlegte Struktur; die Daten werden nicht dagegen geprüft.',
  BEIDE: 'Die hinterlegte Struktur wird gegen die tatsächlichen Daten gehalten. Für wiederkehrende Quellen der beste Weg.',
};

const HERKUNFT_LABELS: Record<Herkunft, string> = {
  OBSERVED: 'aus den Daten',
  CONFIGURED: 'hinterlegt',
  INFERRED: 'abgeleitet',
  AI_SUGGESTED: 'KI-Vorschlag',
  CONFIRMED: 'bestätigt',
};

type Art = 'TEXT' | 'EMAIL' | 'JSON' | 'XML';

const ART_LABELS: Record<Art, string> = {
  TEXT: 'Text',
  EMAIL: 'Ganze E-Mail',
  JSON: 'JSON',
  XML: 'XML',
};

const ART_HINTS: Record<Art, string> = {
  TEXT: 'Ein Ausschnitt, eine Liste, eine Tabelle.',
  EMAIL:
    'Die ganze Nachricht mit Kopfzeilen einfügen. Unikom liest Rumpf und Anhänge und merkt sich, woher jeder Block kommt.',
  JSON:
    'Verschachtelte Objekte werden flachgelegt: „kunde.adresse.ort", Listen mit Index. Die Typen kommen aus der Datei und werden nicht geraten.',
  XML:
    'Attribute werden eigene Felder („kunde.@id"). Dateien mit eigenen Entitäten werden abgewiesen - über die wird fremder Inhalt eingeschleust.',
};

type Zielformat = 'CSV' | 'JSON' | 'XML';

const ZIEL_LABELS: Record<Zielformat, string> = { CSV: 'CSV', JSON: 'JSON', XML: 'XML' };

const ZIEL_HINTS: Record<Zielformat, string> = {
  CSV: 'Eine Zeile je Datensatz, Semikolon getrennt.',
  JSON: 'Die Feldnamen bauen die Verschachtelung wieder auf: „kunde.adresse.ort" wird wieder ein Gebilde.',
  XML: 'Felder mit @ werden Attribute. Namen, die als Element nicht taugen, werden umbenannt - das wird gemeldet.',
};

const BEISPIEL = `Sehr geehrte Damen und Herren,

hiermit bestellen wir folgende Artikel.

Artikelnummer   Bezeichnung        Menge   Preis
4711            Schraube M8        500     0,12
4712            Mutter M8          500     0,08
4713            Unterlegscheibe    1000    0,04

Mit freundlichen Grüßen`;

/**
 * Der Mandant kommt von außen und wird nicht mehr hier gewählt — siehe
 * `TenantsScreen`. Er entscheidet, wie Zahlen und Datumsangaben gelesen werden;
 * eine Beispieldatei ohne die Region ihres Kunden ergibt eine Erkennung, die
 * für niemanden stimmt.
 */
export function DiscoveryScreen({ mandant }: { mandant: string }) {
  const [inhalt, setInhalt] = useState('');
  const [modus, setModus] = useState<Erkennungsmodus>('AUTOMATIK');
  const [art, setArt] = useState<Art>('TEXT');
  const [antwort, setAntwort] = useState<DiscoveryAnswer>();
  const [gewaehlt, setGewaehlt] = useState(0);
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [strukturName, setStrukturName] = useState('');
  const [gemerkt, setGemerkt] = useState<string>();
  const [dateiName, setDateiName] = useState('');
  /*
   * Die ausgesuchte Beispieldatei und was beim Ansehen herauskam.
   *
   * Zwei Stücke, weil sie Verschiedenes sagen: Der Pfad steht im Feld, das
   * Ergebnis darunter — und ein Misserfolg („das ist ein PDF") hat einen Pfad,
   * aber keinen Text. Ein gemeinsamer Zustand müsste beim Fehlschlag entscheiden,
   * ob er den Pfad behalten oder verwerfen soll, und beides wäre falsch.
   */
  const [beispielpfad, setBeispielpfad] = useState('');
  const [probe, setProbe] = useState<Dateiprobe>();
  const [dateiwahlOffen, setDateiwahlOffen] = useState(false);
  const [zielformat, setZielformat] = useState<Zielformat>('CSV');
  const [geschrieben, setGeschrieben] = useState<{ file: string; rows: number; notes?: string[] }>();
  const [bericht, setBericht] = useState<Qualitaetsbericht>();

  /*
   * Durchgesehen wird auf dem Server — dieselbe Route wie im Workflow-Editor.
   *
   * Ein Dateidialog im Browser nennt den Pfad des Rechners, an dem jemand sitzt.
   * Die Lieferung liegt aber dort, wo Unikom läuft, und genau die soll erkannt
   * werden — nicht eine Abschrift, die vorher jemand auf seinen Arbeitsplatz
   * kopiert hat.
   */
  const durchsehen = (pfad: string): Promise<RemoteDirectoryResult> =>
    api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
      name: 'Beispieldatei',
      tenantId: mandant,
      directory: pfad,
      known: [],
      sourceType: 'LOCAL',
    });

  /**
   * Den Anfang der ausgesuchten Datei holen und in die Textfläche stellen.
   *
   * Nicht gleich analysieren: Dann bekäme man ein Ergebnis über etwas, das man
   * nie gesehen hat. Das Versprechen dieses Bildschirms ist das Gegenteil —
   * gespeichert wird, was ein Mensch bestätigt. Der gelesene Anfang steht deshalb
   * sichtbar da und läuft danach durch dieselbe Erkennung wie eingefügter Text.
   */
  async function beispielLesen(pfad: string): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      const gelesen = await api.post<Dateiprobe>('/api/discovery/read-file', { tenantId: mandant, path: pfad });

      setBeispielpfad(pfad);
      setProbe(gelesen);

      if (gelesen.ok && gelesen.text !== undefined) {
        setInhalt(gelesen.text);
        /*
         * Was zum vorigen Inhalt gehörte, gehört nicht zu diesem. Ein
         * Erkennungsergebnis, das neben einer anderen Datei stehen bleibt, ist
         * die Sorte Anzeige, die man für aktuell hält.
         */
        setAntwort(undefined);
        setBericht(undefined);
        setGemerkt(undefined);
        setGeschrieben(undefined);
      }
    } catch (error) {
      setFehler(messageOf(error, 'Die Datei ließ sich nicht lesen'));
    } finally {
      setBusy(false);
    }
  }

  async function analysieren(): Promise<void> {
    setBusy(true);
    setFehler(undefined);
    setAntwort(undefined);

    try {
      setAntwort(await api.post<DiscoveryAnswer>('/api/discovery/analyse', { tenantId: mandant, content: inhalt, mode: modus, kind: art }));
      setGewaehlt(0);
      setGemerkt(undefined);
      setGeschrieben(undefined);
    } catch (error) {
      setFehler(messageOf(error, 'Der Inhalt konnte nicht analysiert werden'));
    } finally {
      setBusy(false);
    }
  }

  const block: DataBlock | undefined = antwort?.blocks[gewaehlt];

  async function uebernehmen(): Promise<void> {
    if (!block) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      setGeschrieben(
        await api.post<{ file: string; rows: number; notes?: string[] }>('/api/discovery/extract', {
          tenantId: mandant,
          name: dateiName,
          format: zielformat,
          block,
        })
      );
      setDateiName('');
    } catch (error) {
      setFehler(messageOf(error, 'Der Datenblock konnte nicht übernommen werden'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Die Qualitätsprüfung des erkannten Blocks (Etappe 4).
   *
   * Sie läuft auf Knopfdruck und nicht bei jeder Analyse: Ein Bericht, den
   * niemand angefordert hat, wird auch von niemandem gelesen — und die Prüfung
   * ist die Handlung, mit der jemand wissen *will*, was mit den Daten nicht
   * stimmt.
   */
  async function pruefen(): Promise<void> {
    if (!block) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      setBericht(
        await api.post<Qualitaetsbericht>('/api/quality/check', {
          tenantId: mandant,
          fields: block.columns.map((spalte, index) => spalte.name ?? `Spalte ${index + 1}`),
          rows: block.rows,
        })
      );
    } catch (error) {
      setFehler(messageOf(error, 'Die Prüfung ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  async function merken(): Promise<void> {
    if (!block) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      await api.post('/api/profiles', { tenantId: mandant, name: strukturName, block });
      setGemerkt(strukturName);
      setStrukturName('');
    } catch (error) {
      setFehler(messageOf(error, 'Das Eingangsprofil konnte nicht gespeichert werden'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}

      <section className="card">
        {/*
          * „Beispieldaten" und nicht mehr „Text einfügen": Es gibt jetzt zwei Wege
          * herein — eingefügt oder aus einer Datei auf dem Server —, und die
          * Überschrift soll nicht einen davon zum Ganzen erklären.
          */}
        <h2>Beispieldaten</h2>

        {/*
          * Die Datei steht über der Textfläche, weil sie sie füllt.
          *
          * Das Feld nimmt keine Eingabe an. Ein Pfad, den man hier tippt, wäre
          * fast immer der des eigenen Arbeitsplatzes — genau die Verwechslung, wegen
          * der der Server und nicht der Browser blättert. Ausgesucht wird deshalb
          * im Fenster, und ein Klick auf die Zeile öffnet es ebenfalls.
          */}
        <Field
          label="Datei auf dem Server"
          explain={
            <>
              <p>
                Eine Beispieldatei dort, wo Unikom läuft - nicht auf Ihrem Arbeitsplatz. Gelesen wird nur
                ihr <strong>Anfang</strong>: Aufbau und Typen stehen nach ein paar hundert Zeilen fest, und eine
                Lieferung von zweihundert Megabyte gehört in keine Textfläche.
              </p>
              <p>
                Text, CSV, JSON, XML. Eine Excel-Mappe liest Unikom im Lauf, hier noch nicht - speichern Sie
                das Blatt dafür als CSV.
              </p>
            </>
          }
          hint={
            probe && (
              probe.ok ? (
                <>
                  „{probe.name}" -{' '}
                  {probe.gekuerzt
                    ? `die ersten ${formatSize(probe.gelesen)} von ${formatSize(probe.groesse)}`
                    : `ganz gelesen, ${formatSize(probe.groesse)}`}
                  , {probe.kodierung}.
                </>
              ) : (
                <span className="schlecht">{probe.message}</span>
              )
            )
          }
          action={
            <FieldButton title="Beispieldatei aussuchen" disabled={busy} onClick={() => setDateiwahlOffen(true)}>
              <FolderIcon />
            </FieldButton>
          }
        >
          <input
            className="input--derived input--waehlbar"
            readOnly
            aria-label="Datei auf dem Server"
            value={beispielpfad}
            placeholder="keine - oder unten einfügen"
            {...titelBeiUeberlauf()}
            onClick={() => setDateiwahlOffen(true)}
          />
        </Field>

        {dateiwahlOffen && (
          <Verzeichnisfenster
            titel="Beispieldatei auf dem Server aussuchen"
            /* Im Ordner der bisherigen Datei — ihr voller Pfad wäre keiner. */
            start={verzeichnisTeil(beispielpfad)}
            waehle="DATEI"
            lies={durchsehen}
            onWaehlen={(wahl) => {
              setDateiwahlOffen(false);
              void beispielLesen(wahl.pfad);
            }}
            onClose={() => setDateiwahlOffen(false)}
          />
        )}

        <Field label="Inhalt" explain="Bestellung aus einer E-Mail, ein Ausschnitt aus einer Tabelle, eine Liste - Unikom sucht darin die Daten.">
          <textarea
            rows={12}
            value={inhalt}
            placeholder={BEISPIEL}
            onChange={(event) => setInhalt(event.target.value)}
          />
        </Field>

        <Field label="Art des Inhalts" explain={ART_HINTS[art]}>
          <select value={art} onChange={(event) => setArt(event.target.value as Art)}>
            {Object.entries(ART_LABELS).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Erkennung" explain={MODUS_HINTS[modus]}>
          <select value={modus} onChange={(event) => setModus(event.target.value as Erkennungsmodus)}>
            {Object.entries(MODUS_LABELS).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="row">
          <button disabled={busy || inhalt.trim() === ''} onClick={() => void analysieren()}>
            {busy ? 'Analysieren …' : 'Datenstruktur analysieren'}
          </button>
          {inhalt.trim() === '' && (
            <button className="secondary" onClick={() => setInhalt(BEISPIEL)}>
              Beispiel einsetzen
            </button>
          )}
        </div>
      </section>

      {geschrieben && (
        <Notice kind="info">
          {geschrieben.rows} Datensätze übernommen nach {geschrieben.file}. Ab hier ist es ein gewöhnlicher
          Datenbestand - Anrede und Grußformel sind nicht mit hineingekommen.
          {geschrieben.notes?.length ? (
            <ul>
              {geschrieben.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      )}

      {gemerkt && (
        <Notice kind="info">
          „{gemerkt}" ist gespeichert. Beim nächsten Eingang dieser Quelle steht sie neben der Erkennung.
        </Notice>
      )}

      {antwort?.message && (
        <section className="card">
          <h2>Nachricht</h2>
          <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
            <Kennzahl name="Von" wert={antwort.message.from ?? 'unbekannt'} />
            <Kennzahl name="Betreff" wert={antwort.message.subject ?? 'ohne Betreff'} />
            <Kennzahl name="Anhänge" wert={antwort.message.attachments.join(', ') || 'keine'} />
          </div>
        </section>
      )}

      {antwort?.knownStructures.length ? (
        <section className="card">
          <h2>Bekanntes Eingangsprofil erkannt</h2>
          <ul>
            {antwort.knownStructures.map((bekannt) => (
              <li key={bekannt.id}>
                <strong>{bekannt.name}</strong> (Version {bekannt.version}) - {Math.round(bekannt.score * 100)} %
                Übereinstimmung
                {bekannt.abweichungen > 0 ? ` (${bekannt.abweichungen} Abweichung(en))` : ''}
                {antwort.usedStructure === bekannt.name ? ' - verwendet' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {antwort && <Gelesen snapshot={antwort.snapshot} />}

      {antwort && antwort.blocks.length === 0 && (
        <Empty>
          Keine eindeutige Datenstruktur erkannt. Das ist kein Fehler - in diesem Inhalt steht nichts, was sich
          zuverlässig als Tabelle lesen lässt.
        </Empty>
      )}

      {antwort && antwort.blocks.length > 1 && (
        <section className="card">
          <h2>{antwort.blocks.length} Datenblöcke erkannt</h2>
          <p className="muted">Welcher gemeint ist, entscheiden Sie.</p>
          <div className="row">
            {antwort.blocks.map((kandidat, index) => (
              <button
                key={`${kandidat.start}-${kandidat.end}`}
                className={index === gewaehlt ? undefined : 'secondary'}
                onClick={() => setGewaehlt(index)}
              >
                {kandidat.source ? `${kandidat.source}: ` : ''}Zeilen {kandidat.start}-{kandidat.end} (
                {kandidat.rows.length} Datensätze)
              </button>
            ))}
          </div>
        </section>
      )}

      {block && (
        <section className="card">
          <h2>
            Datenblock - {block.source ? `${block.source}, ` : ''}Zeilen {block.start} bis {block.end}
          </h2>

          <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
            <Kennzahl name="Datensätze" wert={String(block.rows.length)} />
            <Kennzahl name="Spalten" wert={String(block.columns.length)} />
            <Kennzahl name="Zuversicht" wert={`${Math.round(block.confidence * 100)} %`} />
            {block.headerLine !== undefined && <Kennzahl name="Kopfzeile" wert={`Zeile ${block.headerLine}`} />}
          </div>

          <ul className="muted" style={{ marginTop: '0.8rem' }}>
            {block.reasons.map((grund) => (
              <li key={grund}>{grund}</li>
            ))}
          </ul>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Spalte</th>
                  <th>Bezeichnung</th>
                  <th>Datentyp</th>
                  <th>Sicherheit</th>
                  <th>Herkunft</th>
                </tr>
              </thead>
              <tbody>
                {(antwort?.chosen?.columns ?? block.columns).map((spalte, index) => (
                  <tr key={index}>
                    <td className="muted">{index + 1}</td>
                    <td>{spalte.name ?? <span className="muted">ohne Bezeichnung</span>}</td>
                    <td>{spalte.type}</td>
                    <td>{Math.round(spalte.confidence * 100)} %</td>
                    <td>
                      <span className={spalte.herkunft === 'CONFIRMED' ? 'badge badge--good' : 'badge badge--muted'}>
                        {HERKUNFT_LABELS[spalte.herkunft]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Die ersten Zeilen</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {block.rows.slice(0, 5).map((zeile, index) => (
                  <tr key={index}>
                    {zeile.map((feld, stelle) => (
                      <td key={stelle}>{feld}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Datenblock übernehmen</h3>
          <p className="muted">
            Schreibt die erkannten Zeilen in den Eingang des Mandanten. Von dort verarbeitet Unikom sie wie jede
            andere Datei.
          </p>
          <Field label="Dateiname">
            <input
              value={dateiName}
              placeholder="bestellung"
              onChange={(event) => setDateiName(event.target.value)}
            />
          </Field>
          <Field
            label="Format"
            explain={
              <>
                {/* Wechselt mit dem gewählten Format: erst, was dieses eine tut, dann die Regel für alle. */}
                <p>{ZIEL_HINTS[zielformat]}</p>
                <p>
                  Die Werte gehen als Text hinaus. Aus „1.234,50" eine JSON-Zahl zu machen hieße, sie nach der
                  Region umzurechnen - das ist eine Frage der Zuordnung und kommt mit dem Mapping, nicht mit dem
                  Schreiben.
                </p>
              </>
            }
          >
            <select value={zielformat} onChange={(event) => setZielformat(event.target.value as Zielformat)}>
              {Object.entries(ZIEL_LABELS).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button disabled={busy || dateiName.trim() === ''} onClick={() => void uebernehmen()}>
              Als Datei übernehmen
            </button>
          </div>

          <h3>Daten prüfen</h3>
          <p className="muted">
            Normalisieren, in die Zieltypen bringen und gegen die fachlichen Regeln halten. Die Werte bleiben dabei
            unverändert - was auffällt, wird gemeldet und nicht stillschweigend behoben.
          </p>
          <div className="row">
            <button className="secondary" disabled={busy} onClick={() => void pruefen()}>
              Qualität prüfen
            </button>
          </div>

          <h3>Als Eingangsprofil speichern</h3>
          <p className="muted">
            Damit erkennt Unikom diese Quelle beim nächsten Mal wieder, statt von vorn zu raten. Gespeichert wird, was
            Sie hier bestätigen - nicht, was Unikom vermutet hat. Es entsteht Version 1; ändert sich die Quelle
            später, kommt eine Version dazu und die alte bleibt stehen.
          </p>
          <Field label="Name des Profils">
            <input
              value={strukturName}
              placeholder="Bestellung Müller GmbH"
              onChange={(event) => setStrukturName(event.target.value)}
            />
          </Field>
          <div className="row">
            <button disabled={busy || strukturName.trim() === ''} onClick={() => void merken()}>
              Profil speichern
            </button>
          </div>

          {antwort?.ignoredLines.length ? (
            <p className="muted">
              Nicht zum Block gehört: Zeile {antwort.ignoredLines.join(', ')} - Anrede, Grußformel und was sonst noch
              um die Daten herumsteht.
            </p>
          ) : null}
        </section>
      )}

      {antwort?.chosen?.abweichungen.length ? (
        <Notice kind="error">
          Die hinterlegte Struktur und die Daten widersprechen sich:{' '}
          {antwort.chosen.abweichungen
            .map((abweichung) => `Spalte ${abweichung.position} soll ${abweichung.hinterlegt} sein, ist aber ${abweichung.erkannt}`)
            .join('; ')}
        </Notice>
      ) : null}

      {bericht && <Qualitaet bericht={bericht} />}

      {antwort?.notes.length ? (
        <section className="card">
          <h3>Hinweise</h3>
          <ul className="muted">
            {antwort.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Kennzahl({ name, wert }: { name: string; wert: string }) {
  return (
    <div>
      <div className="muted">{name}</div>
      <div className="figure__value">{wert}</div>
    </div>
  );
}

const EBENE_LABELS: Record<Ebene, string> = {
  ALLGEMEIN: 'Allgemein',
  PROFIL: 'Profil',
  MANDANT: 'Mandant',
};

const EINSTELLUNG_LABELS: Record<string, string> = {
  locale: 'Sprache und Land',
  timeZone: 'Zeitzone',
  jahrhundertGrenze: 'Jahrhundertgrenze',
  nullWerte: 'Werte, die als „nichts" gelten',
  stichprobe: 'Stichprobe',
  stichprobeGrenze: 'Stichprobe, erweitert',
  mindestKonfidenz: 'Mindestkonfidenz',
};

function alsText(wert: unknown): string {
  return Array.isArray(wert) ? wert.map((eintrag) => (eintrag === '' ? '(leer)' : String(eintrag))).join(' · ') : String(wert);
}

/**
 * Womit gelesen wurde (SPEC-01, Abschnitt 10; SPEC-02, Abschnitt 41).
 *
 * Der Benutzer muss erkennen können, welche Einstellung tatsächlich gilt — und
 * von welcher Ebene sie kommt. Ohne diese Auskunft sucht jemand, dessen Profil
 * überstimmt wurde, den Fehler im Profil; dort ist er nicht.
 */
function Gelesen({ snapshot }: { snapshot: Snapshot }) {
  const [offen, setOffen] = useState(false);

  return (
    <section className="card">
      <h2>Gelesen mit</h2>

      <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
        <Kennzahl name="Eingangsprofil" wert={snapshot.profileName ?? 'keines'} />
        <Kennzahl name="Version" wert={snapshot.profileVersion ? String(snapshot.profileVersion) : '-'} />
        <Kennzahl name="Sprache" wert={snapshot.einstellungen.locale} />
      </div>

      <p className="muted">
        Diese Angaben sind für diese Analyse festgehalten. Wird morgen am Mandanten etwas umgestellt, ändert das
        nicht, wie hier gelesen wurde.
      </p>

      <div className="row">
        <button className="secondary" onClick={() => setOffen(!offen)}>
          {offen ? 'Einstellungen verbergen' : 'Geltende Einstellungen ansehen'}
        </button>
      </div>

      {offen && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table className="table--compact">
            <thead>
              <tr>
                <th>Einstellung</th>
                <th>Gilt</th>
                <th>Von welcher Ebene</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(snapshot.einstellungen).map(([name, wert]) => {
                const ebene = snapshot.herkunft[name as keyof typeof snapshot.herkunft];

                return (
                  <tr key={name}>
                    <td>{EINSTELLUNG_LABELS[name] ?? name}</td>
                    <td>{alsText(wert)}</td>
                    <td>
                      <span className={ebene === 'ALLGEMEIN' ? 'badge badge--muted' : 'badge'}>
                        {EBENE_LABELS[ebene]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const SCHWERE_TONE: Record<Schwere, string> = {
  INFO: 'badge badge--muted',
  WARNUNG: 'badge badge--warn',
  KONFLIKT: 'badge badge--warn',
  FEHLER: 'badge badge--bad',
};

const SCHWERE_LABELS: Record<Schwere, string> = {
  INFO: 'Hinweis',
  WARNUNG: 'Warnung',
  KONFLIKT: 'Prüffall',
  FEHLER: 'Fehler',
};

/**
 * Der Qualitätsbericht (SPEC-08, Abschnitt 9).
 *
 * Vier Stufen, und nur eine davon hält an. Jeder Befund nennt **Ursache und
 * Auswirkung getrennt** — ein einzelnes Textfeld füllt sich mit
 * „Validierungsfehler in Feld 3", und niemand weiß danach, was zu tun ist.
 */
function Qualitaet({ bericht }: { bericht: Qualitaetsbericht }) {
  const [alle, setAlle] = useState(false);
  const gezeigt = alle ? bericht.befunde : bericht.befunde.slice(0, 20);

  return (
    <section className="card">
      <h2>Qualität</h2>

      <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
        <Kennzahl name="Zeilen" wert={String(bericht.zeilen.length)} />
        <Kennzahl name="Prüffälle" wert={String(bericht.pruefzeilen.length)} />
        <Kennzahl name="Warnungen" wert={String(bericht.zusammenfassung.WARNUNG)} />
        <Kennzahl name="Fehler" wert={String(bericht.zusammenfassung.FEHLER)} />
      </div>

      <p className="prose">
        {bericht.blockiert ? (
          <>
            <strong>Die Verarbeitung würde anhalten.</strong> Ein Fehler bedeutet, dass hier nichts sicher zu
            verarbeiten ist.
          </>
        ) : bericht.pruefzeilen.length > 0 ? (
          <>
            Die Verarbeitung liefe weiter. {bericht.pruefzeilen.length} Zeile(n) gingen als Prüffall an einen
            Menschen, die übrigen {bericht.zeilen.length - bericht.pruefzeilen.length} liefen durch.
          </>
        ) : (
          <>Nichts steht der Verarbeitung entgegen.</>
        )}
      </p>

      {bericht.aenderungen.length > 0 && (
        <>
          <h3>Was vereinheitlicht wurde</h3>
          <ul className="prose">
            {bericht.aenderungen.slice(0, 10).map((aenderung) => (
              <li key={`${aenderung.zeile}-${aenderung.feld}`}>
                Zeile {aenderung.zeile}, {aenderung.feld}: <code>{aenderung.vorher}</code> →{' '}
                <code>{aenderung.nachher}</code>
                <div className="cell__sub">{aenderung.schritte.join(', ')}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {bericht.befunde.length === 0 ? (
        <p className="muted">Kein Befund.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Stufe</th>
                  <th>Zeile</th>
                  <th>Feld</th>
                  <th>Ursache</th>
                  <th>Auswirkung</th>
                </tr>
              </thead>
              <tbody>
                {gezeigt.map((befund: Befund, stelle) => (
                  <tr key={`${befund.zeile}-${befund.feld}-${stelle}`}>
                    <td>
                      <span className={SCHWERE_TONE[befund.schwere]}>{SCHWERE_LABELS[befund.schwere]}</span>
                    </td>
                    <td>{befund.zeile === 0 ? <span className="muted">Bestand</span> : befund.zeile}</td>
                    <td>{befund.feld ?? '-'}</td>
                    <td style={{ whiteSpace: 'normal' }}>{befund.ursache}</td>
                    <td style={{ whiteSpace: 'normal' }}>{befund.auswirkung}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {bericht.befunde.length > gezeigt.length && (
            <div className="row">
              <button className="secondary" onClick={() => setAlle(true)}>
                Alle {bericht.befunde.length} Befunde zeigen
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
