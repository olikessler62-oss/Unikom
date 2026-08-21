import { useState } from 'react';

import { api } from '../../api/client.js';
import { messageOf } from '../../api/useResource.js';
import type { Dateiwahl, Platz, RemoteDirectoryResult, StageInput } from '../../api/types.js';
import { CheckField, Field, Klappkarte, Notice } from '../../components/Pieces.js';
import { Verzeichnisfeld } from '../../components/Verzeichniswahl.js';

/**
 * Welche Dateien ein Konsolidierungsdurchgang nimmt — und wann er beginnt.
 *
 * ## Warum es diese Fläche gibt
 *
 * Vorher stand hier ein einziges Textfeld für ein Namensmuster. Damit ließ sich
 * nicht sagen, welche Dateien zusammengehören, nicht mehrere Namen angeben und
 * nichts ausschließen. Vor allem konnte niemand verhindern, dass ein Durchgang
 * beginnt, während eine Lieferung noch fehlt: Das Ergebnis sah dann vollständig
 * aus, und der Fehler fiel beim Monatsabschluss auf.
 *
 * ## Das Abholverzeichnis ist ein Abholverzeichnis
 *
 * Was darin liegt, wartet auf Verarbeitung — und nichts sonst. Danach wandern
 * die Dateien fort, gelungen oder nicht. Wer etwas erneut verarbeiten will,
 * legt es wieder hinein. Das ist der Grund, warum „alles, was drin liegt" hier
 * eine zulässige Regel ist und im Zielverzeichnis eines anderen Schritts nicht.
 *
 * ## Der Schalter, den man setzen muss
 *
 * Ein Zusammenführen ohne Stapelbedingung kann nicht wissen, ob es vollständig
 * ist. Deshalb ist die Bedingung ausdrücklich einzuschalten und nicht
 * voreingestellt: Was man einschaltet, hat man bedacht.
 */
export function Stapelwahl({
  wahl,
  eingang,
  tenantId,
  onChange,
}: {
  wahl: Dateiwahl | undefined;
  /** Woher der Durchgang liest — für die Vorschau und den Hinweis darauf. */
  eingang: StageInput;
  tenantId?: string;
  onChange(next: Dateiwahl): void;
}) {
  const stapel = wahl?.stapel;
  const abholverzeichnis = eingang.from === 'DIRECTORY' ? eingang.directory : undefined;

  const aendern = (teile: Partial<Dateiwahl>): void => onChange({ ...wahl, ...teile });

  const plaetzeAendern = (plaetze: Platz[]): void =>
    aendern({ stapel: { ...(stapel ?? { plaetze: [] }), plaetze } });

  return (
    <Klappkarte titel="Welche Dateien" belegt={belegt(wahl)}>
      <Field
        label="Namensmuster"
        explain={
          <>
            <p>
              Der Filter für das Abholverzeichnis. <code>*</code> und <code>?</code> gelten wie im Explorer, alles
              andere wörtlich.
            </p>
            <p>
              <strong>Ein Muster, kein Muster-Verzeichnis.</strong> Mehrere Namen durch Komma zu trennen
              funktioniert nicht — das Komma wird wörtlich genommen, und es passt dann keine Datei. Mehrere
              Lieferanten trägt man unten als Plätze ein.
            </p>
            <p>Leer heißt: alles Lesbare im Abholverzeichnis — CSV, TXT, TSV, JSON, XML, XLSX.</p>
          </>
        }
      >
        <input
          value={wahl?.muster ?? ''}
          placeholder="Filiale_*.csv"
          onChange={(event) => aendern({ muster: event.target.value || undefined })}
        />
      </Field>

      <Field
        label="Wartezeit, bis eine Datei als fertig gilt (Sekunden)"
        explain={
          <>
            <p>
              Wer eine große Datei hineinkopiert, legt ihren endgültigen Namen sofort an — sichtbar ist sie da, aber
              noch nicht vollständig.
            </p>
            <p>
              Ohne Wartezeit könnte ein Durchgang ein abgeschnittenes Stück verarbeiten. Der Wert sollte über der
              Zeit liegen, die eine Lieferung zum Schreiben braucht; bei Kopien über das Netz sind 60 Sekunden ein
              nüchterner Anfang.
            </p>
          </>
        }
      >
        <input
          type="number"
          min={0}
          value={wahl?.reifeSekunden ?? ''}
          placeholder="60"
          onChange={(event) => aendern({ reifeSekunden: Number(event.target.value) || undefined })}
        />
      </Field>

      <CheckField
        label="Erst beginnen, wenn ein vollständiger Stapel vorliegt"
        explain={
          <>
            <p>
              Ohne diesen Schalter verarbeitet der Durchgang, was zufällig gerade da ist. Bei einer einzelnen Datei
              ist das richtig. Beim Zusammenführen mehrerer ist es der Fehler, der sich nicht ansehen lässt: Fehlt
              eine Lieferung, entsteht ein Ergebnis, dem sie fehlt — und das sieht vollständig aus.
            </p>
            <p>
              Eingeschaltet wartet der Durchgang, bis <strong>jeder Platz besetzt</strong> ist und die{' '}
              <strong>Anzahl stimmt</strong>. Die beiden Bedingungen fangen verschiedene Fehler: Plätze das Fehlen,
              die Anzahl das Zuviel.
            </p>
          </>
        }
        checked={Boolean(stapel)}
        onChange={(an) => aendern({ stapel: an ? { plaetze: [] } : undefined })}
      />

      {stapel && (
        <>
          <Plaetze plaetze={stapel.plaetze} onChange={plaetzeAendern} />

          <Field
            label="Dateien insgesamt"
            explain={
              <>
                <p>
                  Leer heißt: so viele, wie es Plätze gibt — der Regelfall, je Beteiligtem eine Datei.
                </p>
                <p>
                  Ausdrücklich setzen, wenn ein Beteiligter mehrere liefern darf. Solange die Zahl nicht stimmt,
                  beginnt der Durchgang nicht: Eine zweite Datei auf demselben Platz ist entweder eine Dublette oder
                  eine Lieferung, die niemand erwartet hat.
                </p>
              </>
            }
          >
            <input
              type="number"
              min={1}
              value={stapel.anzahl ?? ''}
              placeholder={String(stapel.plaetze.length || 1)}
              onChange={(event) =>
                aendern({ stapel: { ...stapel, anzahl: Number(event.target.value) || undefined } })
              }
            />
          </Field>

          <Field
            label="Feld, das zusammengehörige Dateien zusammenhält"
            explain={
              <>
                <p>
                  Ein Feldname — <code>lieferdatum</code>, <code>periode</code>, <code>stapelnummer</code>. Alle
                  Dateien mit demselben Wert bilden einen Stapel.
                </p>
                <p>
                  Gebraucht, sobald <strong>zwei Stapel gleichzeitig</strong> im Abholverzeichnis liegen können — die
                  verspätete Lieferung von gestern neben der heutigen. Ohne Schlüssel würden beide zu einem
                  verrührt: Die Plätze wären besetzt, und das Ergebnis enthielte zwei Tage.
                </p>
                <p>
                  Je Lauf wird <strong>ein</strong> Stapel verarbeitet, der älteste vollständige. Der nächste kommt
                  beim nächsten Durchgang — zwei in einem Lauf zu nehmen hieße, sie doch zusammenzulegen.
                </p>
                <p>
                  Zum Preis: Die Dateien werden dafür aufgemacht. Trägt das Feld in <em>einer</em> Datei mehrere
                  Werte, gehört sie zu keinem Stapel und es steht im Protokoll — dann ist der Schlüssel keine
                  Eigenschaft dieser Datei, und sie enthält womöglich zwei Stapel.
                </p>
              </>
            }
          >
            <input
              value={stapel.schluesselfeld ?? ''}
              placeholder="lieferdatum"
              onChange={(event) =>
                aendern({ stapel: { ...stapel, schluesselfeld: event.target.value || undefined } })
              }
            />
          </Field>

          <Field
            label="Frist ab der ersten Datei (Sekunden)"
            explain={
              <>
                <p>
                  <strong>Ohne Frist wird aus einer fehlenden Datei Stille:</strong> kein Ergebnis, kein Fehler,
                  niemand merkt es. Das ist die schlechtere Hälfte des Wartens.
                </p>
                <p>
                  Ab der ersten Datei und nicht ab einer Uhrzeit — wer um 22:00 liefert und wer um 03:00 liefert,
                  bekommt dieselbe Spanne. Ist sie um, wird der Stapel gemeldet und nach „Gescheitert" geräumt,
                  damit das Abholverzeichnis für den nächsten frei ist.
                </p>
              </>
            }
          >
            <input
              type="number"
              min={0}
              value={stapel.fristSekunden ?? ''}
              placeholder="1800"
              onChange={(event) =>
                aendern({ stapel: { ...stapel, fristSekunden: Number(event.target.value) || undefined } })
              }
            />
          </Field>
        </>
      )}

      <Verzeichnisfeld
        label="Arbeitsverzeichnis"
        titel="Arbeitsverzeichnis wählen"
        wert={wahl?.abholung?.arbeit ?? ''}
        explain={
          <>
            <p>
              <strong>Das Verschieben ist der Zugriff.</strong> Ist der Stapel vollständig, wandern genau diese
              Dateien hierher, bevor eine davon gelesen wird. Was danach im Abholverzeichnis ankommt, gehört zum
              nächsten Stapel und kann nicht halb mitkommen.
            </p>
            <p>
              Leer heißt: Es wird aus dem Abholverzeichnis gelesen. Das läuft, aber eine Datei, die mitten im Lauf
              ankommt, lässt sich dann nicht sicher ausschließen — und der Lauf sagt das jedes Mal ins Protokoll.
            </p>
          </>
        }
        disabled={!tenantId}
        lies={(pfad) => durchsehen(pfad, tenantId)}
        onChange={(pfad) => aendern({ abholung: { ...wahl?.abholung, arbeit: pfad || undefined } })}
      />

      <Verzeichnisfeld
        label="Erledigt"
        titel="Verzeichnis für erledigte Dateien wählen"
        wert={wahl?.abholung?.erledigt ?? ''}
        explain="Wohin die Eingangsdateien nach einem gelungenen Durchgang wandern. Leer heißt: Sie bleiben liegen — und stehen beim nächsten Lauf wieder da."
        disabled={!tenantId}
        lies={(pfad) => durchsehen(pfad, tenantId)}
        onChange={(pfad) => aendern({ abholung: { ...wahl?.abholung, erledigt: pfad || undefined } })}
      />

      <Verzeichnisfeld
        label="Gescheitert"
        titel="Verzeichnis für gescheiterte Dateien wählen"
        wert={wahl?.abholung?.gescheitert ?? ''}
        explain={
          <>
            <p>Wohin die Dateien eines gescheiterten oder verworfenen Stapels wandern.</p>
            <p>
              Getrennt von „Erledigt", weil nur so ein Stapel gezielt noch einmal eingespielt werden kann: Aus einem
              gemeinsamen Verzeichnis nähme man die gelungenen wieder mit.
            </p>
          </>
        }
        disabled={!tenantId}
        lies={(pfad) => durchsehen(pfad, tenantId)}
        onChange={(pfad) => aendern({ abholung: { ...wahl?.abholung, gescheitert: pfad || undefined } })}
      />

      <Vorschau verzeichnis={abholverzeichnis} wahl={wahl} tenantId={tenantId} />
    </Klappkarte>
  );
}

/** Ob in dieser Fläche etwas Vollständiges steht — siehe `belegt.ts`. */
function belegt(wahl: Dateiwahl | undefined): boolean {
  if (!wahl) {
    return false;
  }

  if (wahl.stapel) {
    // Eine eingeschaltete Bedingung ohne Plätze ist keine Bedingung.
    return wahl.stapel.plaetze.length > 0 && wahl.stapel.plaetze.every((platz) => platz.muster.trim() !== '');
  }

  return Boolean(wahl.muster?.trim()) || Boolean(wahl.abholung?.erledigt?.trim());
}

/**
 * Die erwarteten Beteiligten.
 *
 * Als Liste und nicht als ein Feld mit Trennzeichen: Ein Komma ist in
 * Dateinamen erlaubt, und dann wäre nicht mehr zu entscheiden, was gemeint ist.
 * Der Name daneben ist keine Zierde — er steht in jeder Meldung, und „es fehlt
 * ‚Filiale Süd'" ist die Auskunft, die man um sieben Uhr morgens braucht.
 */
function Plaetze({ plaetze, onChange }: { plaetze: Platz[]; onChange(next: Platz[]): void }) {
  const setze = (stelle: number, teile: Partial<Platz>): void =>
    onChange(plaetze.map((platz, i) => (i === stelle ? { ...platz, ...teile } : platz)));

  return (
    <Field
      label="Erwartete Lieferungen"
      explain={
        <>
          <p>
            Je Beteiligtem eine Zeile: ein Name, unter dem er in Meldungen erscheint, und das Muster, das seine
            Datei erkennt.
          </p>
          <p>
            Der Name entscheidet über die Brauchbarkeit der Meldung um sieben Uhr morgens. „Filiale Süd" sagt, wen
            man anrufen muss; „Platz 2" nicht.
          </p>
        </>
      }
    >
      <div className="stack">
        {plaetze.map((platz, stelle) => (
          <div className="row" key={stelle}>
            <input
              value={platz.name}
              placeholder="Filiale Nord"
              onChange={(event) => setze(stelle, { name: event.target.value })}
            />
            <input
              value={platz.muster}
              placeholder="Filiale_Nord_*.csv"
              onChange={(event) => setze(stelle, { muster: event.target.value })}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => onChange(plaetze.filter((_, i) => i !== stelle))}
            >
              Fort
            </button>
          </div>
        ))}

        <div className="row">
          <button type="button" className="secondary" onClick={() => onChange([...plaetze, { name: '', muster: '' }])}>
            Lieferung erwarten …
          </button>
        </div>
      </div>
    </Field>
  );
}

/**
 * Was der Filter im Abholverzeichnis gerade trifft.
 *
 * Die einzige Antwort auf „wie schließe ich aus, dass anderes mitläuft", die man
 * **vor** dem Speichern glauben kann. Alles andere ist Nachzählen im Ergebnis am
 * nächsten Morgen.
 */
function Vorschau({
  verzeichnis,
  wahl,
  tenantId,
}: {
  verzeichnis: string | undefined;
  wahl: Dateiwahl | undefined;
  tenantId?: string;
}) {
  const [stand, setStand] = useState<{ mit: string[]; ohne: string[] }>();
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string>();

  async function sieh(): Promise<void> {
    setBusy(true);
    setFehler(undefined);

    try {
      const gelesen = await durchsehen(verzeichnis ?? '', tenantId);
      const namen = (gelesen.files ?? []).map((datei) => datei.name);

      setStand({
        mit: namen.filter((name) => nimmt(name, wahl)),
        ohne: namen.filter((name) => !nimmt(name, wahl)),
      });
    } catch (error) {
      setFehler(messageOf(error, 'Das Verzeichnis ließ sich nicht durchsehen'));
    } finally {
      setBusy(false);
    }
  }

  if (!verzeichnis) {
    return (
      <p className="muted">
        Eine Vorschau gibt es nur für ein eigenes Abholverzeichnis. Wer übernimmt, was der Schritt davor ablegt,
        bekommt die Liste dieses Laufs — und die steht erst zur Laufzeit fest.
      </p>
    );
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}

      <div className="row">
        <button type="button" className="secondary" disabled={busy || !tenantId} onClick={() => void sieh()}>
          Was trifft das gerade?
        </button>
      </div>

      {stand && (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Kommt mit ({stand.mit.length})</th>
                <th>Bleibt draußen ({stand.ohne.length})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {stand.mit.length === 0 ? (
                    <em className="muted">nichts — der Filter trifft keine Datei</em>
                  ) : (
                    stand.mit.map((name) => <div key={name}>{name}</div>)
                  )}
                </td>
                <td className="muted">
                  {stand.ohne.length === 0 ? <em>nichts</em> : stand.ohne.map((name) => <div key={name}>{name}</div>)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Die lesbaren Formate — dieselbe Liste wie im Server (`Eingang.ts`). */
const LESBAR = ['.csv', '.txt', '.tsv', '.json', '.xml', '.xlsx'];

/**
 * Ob diese Datei mitkäme.
 *
 * Die Regel steht hier noch einmal, wie schon bei den Freigaben: Der Server
 * entscheidet, die Oberfläche zeigt. Ein gemeinsames Modul würde die beiden
 * Rollen vermischen.
 */
function nimmt(name: string, wahl: Dateiwahl | undefined): boolean {
  const klein = name.toLowerCase();

  if (!LESBAR.some((endung) => klein.endsWith(endung))) {
    return false;
  }

  const muster = wahl?.muster?.trim();

  if (!muster) {
    return true;
  }

  const maskiert = muster.replace(/[.+^${}()|[\]\\]/g, (zeichen) => '\\' + zeichen);

  return new RegExp('^' + maskiert.split('*').join('.*').split('?').join('.') + '$', 'i').test(name);
}

/** Örtlich durchsehen — die Konsolidierung liest auf diesem Rechner. */
function durchsehen(pfad: string, tenantId?: string): Promise<RemoteDirectoryResult> {
  return api.post<RemoteDirectoryResult>('/api/jobs/browse-local', {
    name: 'Konsolidierung',
    tenantId,
    directory: pfad,
    known: [],
    sourceType: 'LOCAL',
  });
}
