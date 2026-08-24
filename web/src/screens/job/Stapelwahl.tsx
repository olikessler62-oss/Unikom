import { useEffect, useState } from 'react';

import { api } from '../../api/client.js';
import { messageOf } from '../../api/useResource.js';
import type { Abholung, Dateikennung, Dateiwahl, RemoteDirectoryResult, StageInput } from '../../api/types.js';
import {
  DurationField,
  Field,
  FieldButton,
  FolderIcon,
  Hint,
  Klappkarte,
  Modal,
  Notice,
  PlusIcon,
  titelBeiUeberlauf,
  TrashIcon,
} from '../../components/Pieces.js';
import { alsMuster, alsZeilen, dateiname, gefuellte, kuerze } from './dateizeilen.js';
import type { Feldstand } from './feldstand.js';
import { Verzeichnisfeld, Verzeichnisfenster } from '../../components/Verzeichniswahl.js';

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
  const eigenesVerzeichnis = eingang.from === 'DIRECTORY';

  /*
   * Was in der Auswahl steht. Ohne gespeicherte Zahl gilt weiterhin die Regel
   * der Domäne — so viele, wie es Plätze gibt —, und genau die wird gezeigt:
   * Eine Auswahl, die 2 anzeigt, während der Lauf mit 3 rechnet, wäre schlimmer
   * als gar keine Anzeige.
   */
  const anzahl = stapel?.anzahl ?? (stapel?.plaetze.length || 2);
  const abholverzeichnis = eigenesVerzeichnis ? eingang.directory : undefined;

  const aendern = (teile: Partial<Dateiwahl>): void => onChange({ ...wahl, ...teile });

  /*
   * Die Sekundär-Zeilen, leere eingeschlossen.
   *
   * Der Auftrag speichert nur die gefüllten — eine Zeile ohne Eingabe ist keine
   * Angabe. Für die Fläche reicht das nicht: Die zweite Zeile kann gefüllt sein
   * und die erste leer, und beim Kürzen fallen genau die leeren zuerst fort.
   * Aus einer Liste ohne Lücken ließe sich das nicht mehr ablesen.
   */
  const [reihen, setReihen] = useState<(Dateikennung | undefined)[]>(() =>
    stapel?.sekundaer?.length ? [...stapel.sekundaer] : [undefined]
  );

  /** Eine Rückfrage, die auf ein Ja wartet. */
  const [frage, setFrage] = useState<{ text: string; tun(): void }>();

  /** Ob das Fenster mit den vier Verzeichnissen offen steht. */
  const [orteOffen, setOrteOffen] = useState(false);

  /*
   * Das Namensmuster als Zeilen.
   *
   * Gespeichert bleibt eine Zeichenkette mit Kommas — das ist, was der Lauf
   * liest, und was die Vorschau daneben prüft. Die Zeilen sind nur die
   * bedienbare Form davon: Ein Feld, in das man `Filiale_*.csv, Umsatz_*.csv`
   * tippt, verlangt, dass man die Regel kennt; drei Zeilen zeigen sie.
   *
   * Bewusst **keine** zweite Angabe im Auftrag. Zwei Darstellungen derselben
   * Sache liefen früher oder später auseinander, und dann wäre nicht gesagt,
   * welche gilt.
   */
  const [musterzeilen, setMusterzeilen] = useState<(Dateikennung | undefined)[]>(() =>
    alsZeilen(wahl?.muster)
  );

  const setzeMuster = (naechste: (Dateikennung | undefined)[]): void => {
    setMusterzeilen(naechste);
    aendern({ muster: alsMuster(naechste) });
  };

  /*
   * Gefragt wird nur bei einer gefüllten Zeile — eine leere wegzuklicken ist
   * keine Entscheidung, über die jemand nachdenken will. Dieselbe Regel wie bei
   * den Sekundär-Dateien; es ist dieselbe Geste.
   */
  const entferneMuster = (stelle: number): void => {
    const weg = (): void => setzeMuster(musterzeilen.filter((_, i) => i !== stelle));
    const eintrag = musterzeilen[stelle];

    if (eintrag && eintrag.wert.trim() !== '') {
      setFrage({ text: `„${eintrag.wert}" nicht mehr verarbeiten?`, tun: weg });
      return;
    }

    weg();
  };

  /*
   * Was im Auswahlfeld steht — und nur das, was es anbietet.
   *
   * Früher stand hier ein Eingabefeld: Man durfte mehrere Typen ankreuzen und
   * eine eigene Endung tippen. Beides steht in gespeicherten Aufträgen noch
   * drin — `csv, xlsx` etwa, oder ein Vertipper.
   *
   * Ein solcher Wert kommt **nicht** mit in die Liste. Er ist keine Auswahl,
   * sondern ein Rest, und angeboten würde er nur, um ihn behalten zu können.
   */
  const gespeicherterTyp = (wahl?.endungen ?? []).join(', ');
  const gewaehlterTyp = LESBARE_TYPEN.includes(gespeicherterTyp) ? gespeicherterTyp : '';

  /*
   * Und er wird fallengelassen, statt im Verborgenen weiterzuwirken.
   *
   * Ein Auswahlfeld, das „Alle lesbaren" zeigt, während im Auftrag `dgdgd`
   * steht, wäre die schlimmere Hälfte: Der Lauf nähme keine einzige Datei, und
   * die Fläche sähe in Ordnung aus. Gelesen werden ohnehin nur die sechs
   * Formate — alles andere trifft nie etwas und ist damit nichts, was jemand
   * verlieren könnte.
   *
   * Einmal beim Öffnen und nicht beim Zeichnen: Ein Schreiben während des
   * Zeichnens ist keine Reaktion auf eine Eingabe, sondern eine Schleife, die
   * sich selbst auslöst.
   *
   * Und nur dort, wo das Feld auch steht: Übernimmt der Schritt, was der
   * vorige abgelegt hat, gibt es keinen Dateityp zu wählen — dann ist der
   * gespeicherte Wert nichts, was jemand sieht, und nichts, was der Lauf liest.
   * Aufgeräumt wird, was gezeigt wird.
   */
  useEffect(() => {
    if (eigenesVerzeichnis && gespeicherterTyp !== '' && gewaehlterTyp === '') {
      aendern({ endungen: undefined });
    }
  }, [eigenesVerzeichnis, gespeicherterTyp]);

  /** So viele Sekundär-Zeilen sind neben der Primär-Datei erlaubt. */
  const grenze = Math.max(1, anzahl - 1);

  const setzeReihen = (naechste: (Dateikennung | undefined)[], zahl = anzahl): void => {
    setReihen(naechste);

    if (stapel) {
      aendern({ stapel: { ...stapel, anzahl: zahl, sekundaer: gefuellte(naechste) } });
    }
  };

  /*
   * Die Zahl senken heißt unter Umständen, Eingetragenes zu verlieren. Gefragt
   * wird nur dann: Fallen bloß leere Zeilen fort, gibt es nichts zu bestätigen.
   */
  const setzeAnzahl = (zahl: number): void => {
    const ziel = Math.max(1, zahl - 1);
    const verlust = gefuellte(reihen).length - ziel;

    const uebernehmen = (): void => setzeReihen(kuerze(reihen, ziel), zahl);

    if (verlust > 0) {
      setFrage({
        text:
          `Bei ${zahl} Dateien insgesamt bleibt neben der Primär-Datei Platz für ${ziel} Sekundär-Datei` +
          `${ziel === 1 ? '' : 'en'}. ${verlust} Eintrag${verlust === 1 ? '' : 'e'} wird entfernt.`,
        tun: uebernehmen,
      });

      return;
    }

    uebernehmen();
  };

  /*
   * Eine Zeile fortnehmen. Gefragt wird nur bei einer gefüllten — eine leere
   * Zeile wegzuklicken ist keine Entscheidung, über die jemand nachdenken will.
   */
  const entferneReihe = (stelle: number): void => {
    const weg = (): void => setzeReihen(reihen.filter((_, i) => i !== stelle));
    const eintrag = reihen[stelle];

    if (eintrag && eintrag.wert.trim() !== '') {
      setFrage({ text: `„${eintrag.wert}" aus dem Stapel nehmen?`, tun: weg });
      return;
    }

    weg();
  };

  return (
    <Klappkarte titel={stapel ? 'Mehrere Dateien zusammenführen' : 'Welche Dateien'} stand={stand(wahl)}>
      {/*
        * Zwei Betriebsarten, zwei Flächen.
        *
        * Ohne Stapel sagt das Namensmuster, welche Dateien mitkommen. Mit
        * Stapel sagen es die Plätze — jeder mit seinem eigenen Muster und
        * seinem Namen. Beides nebeneinander zu zeigen hieße, zwei Antworten
        * auf dieselbe Frage anzubieten und offenzulassen, welche gilt.
        *
        * Der Schalter ist die Stapelbedingung selbst und kein zweites Merkmal
        * daneben: Zwei Schalter für eine Sache stünden früher oder später
        * gegeneinander, und dann wäre eine Einstellung in Kraft, die niemand
        * sieht. „Stapeldatei-Verarbeitung" in der Quelle setzt dieselbe.
        */}
      {stapel ? (
        <>
        {/*
          * Hier stand einmal ein zweiter Schalter: „Erst beginnen, wenn ein
          * vollständiger Stapel vorliegt". Er ist fort.
          *
          * Er konnte gar nicht ausgeschaltet sein — diese Fläche gibt es nur,
          * solange die Bedingung steht. Ein Kästchen, das immer angehakt ist,
          * sagt nichts; es fragt bloß ein zweites Mal, was oben schon
          * entschieden wurde. Was er erklärte, steht jetzt bei „Mehrere Dateien
          * zusammenführen" in der Quelle — dort, wo die Entscheidung fällt.
          */}
        {/*
          * Zwei Fragen, eine Zeile: wie viele, und wovon.
          *
          * Beide grenzen denselben Stapel ein, und beide werden mit einem Griff
          * beantwortet. Untereinander stünden sie da wie zwei Kapitel; die
          * Namenszeilen darunter brauchen die Höhe nötiger.
          */}
        <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field
          label="Erwartete Dateien"
          explain={
            <>
              <p>
                Wie viele Dateien einen vollständigen Stapel ergeben. Der Regelfall ist eine je Platz.
              </p>
              <p>
                Höher setzen, wenn ein Beteiligter mehrere liefern darf. Solange die Zahl nicht stimmt, beginnt der
                Durchgang nicht: Eine zweite Datei auf demselben Platz ist entweder eine Dublette oder eine
                Lieferung, die niemand erwartet hat.
              </p>
              <p>
                Weniger Dateien als Plätze kann nicht aufgehen — jeder Platz will besetzt sein. Der Punkt neben der
                Überschrift steht dann auf rot.
              </p>
            </>
          }
        >
          {/*
            * Eine Auswahl und kein Zahlenfeld.
            *
            * Zusammenführen beginnt bei zwei; eine Eins wäre keine
            * Zusammenführung, und die Null war im Zahlenfeld einen Tastendruck
            * entfernt. Nach oben ist bei fünf Schluss: Wer mehr braucht, sagt
            * es — dann ist das eine Entscheidung und keine Zahl, die jemand
            * versehentlich stehenlässt.
            *
            * Trägt ein gespeicherter Auftrag etwas anderes, steht es mit in der
            * Liste. Eine Auswahl, die den vorhandenen Wert nicht anbietet,
            * ändert ihn beim ersten Hinsehen still auf den ersten Eintrag.
            */}
          <select
            className="input--wahl"
            /*
             * Auf dem Maß des Auswahlfeldes der Primär-Datei und nicht mehr auf
             * dem der Zahlenfelder. Untereinander stehen in dieser Fläche jetzt
             * lauter Auswahlfelder — eine Zahl, ein Dateityp, drei Arten —, und
             * die lesen sich als eine Sorte Angabe, sobald sie eine Kante haben.
             */
            style={{ minWidth: ARTEN_BREITE }}
            value={anzahl}
            onChange={(event) => setzeAnzahl(Number(event.target.value))}
          >
            {(ANZAHLEN.includes(anzahl) ? ANZAHLEN : [...ANZAHLEN, anzahl].sort((a, b) => a - b)).map((zahl) => (
              <option key={zahl} value={zahl}>
                {zahl}
              </option>
            ))}
          </select>
        </Field>

        {eigenesVerzeichnis && (
          <Dateitypfeld
            wert={gewaehlterTyp}
            onWert={(typ) => aendern({ endungen: typ === '' ? undefined : [typ] })}
          />
        )}
        </div>

        <Field
          label="Primär-Datei"
          explain="Woran die Primär-Datei zu erkennen ist — am Dateinamen, an einem Teil davon, oder ausgesucht."
        >
          <Dateikennungszeile
            beispiel="Bestellung_*.csv"
            kennung={stapel.primaer}
            start={abholverzeichnis ?? ''}
            tenantId={tenantId}
            onKennung={(primaer) => aendern({ stapel: { ...stapel, primaer } })}
          />
        </Field>

        <Sekundaerdateien
          reihen={reihen}
          grenze={grenze}
          start={abholverzeichnis ?? ''}
          tenantId={tenantId}
          onReihe={(stelle, kennung) =>
            setzeReihen(reihen.map((eine, i) => (i === stelle ? kennung : eine)))
          }
          onEntfernen={entferneReihe}
          onHinzu={() => setzeReihen([...reihen, undefined])}
        />

        <Field
          label="Frist ab der ersten Datei"
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
          <DurationField
            seconds={stapel.fristSekunden ?? 0}
            onChange={(fristSekunden) =>
              aendern({ stapel: { ...stapel, fristSekunden: fristSekunden || undefined } })
            }
          />
        </Field>
        </>
      ) : (
        <>
        {/*
          * Die Dateitypen gibt es nur beim eigenen Abholverzeichnis.
          *
          * Wer übernimmt, was der Schritt davor abgelegt hat, bekommt eine Liste
          * und keine Momentaufnahme eines Verzeichnisses — dort ist längst
          * entschieden, was mitkommt, und ein zweiter Filter könnte nur noch
          * etwas wegnehmen, das der Lauf gerade selbst erzeugt hat.
          *
          * Eine einmal getroffene Auswahl bleibt beim Umschalten stehen. Sie ist
          * dann nicht tot, sondern ruht: Wer zurückschaltet, findet sie wieder,
          * und der Lauf liest sie in diesem Zweig gar nicht erst.
          */}
        {eigenesVerzeichnis && (
          <Dateitypfeld
            wert={gewaehlterTyp}
            onWert={(typ) => aendern({ endungen: typ === '' ? undefined : [typ] })}
          />
        )}

        {/*
          * Beschriftung und Zeilen in einer Hülle — wie bei Sekundär-Datei(en).
          *
          * `pille-zeile` hält Beschriftung, Plus und Info auf einer Höhe,
          * `stack` den Abstand **zwischen** den Zeilen, und `field` außen den
          * zum nächsten Feld. Beschriftung und Zeilen in zwei Hüllen hätten
          * einen Nachlauf zwischen sich, der die Überschrift von dem löst,
          * was sie überschreibt.
          */}
        <div className="field">
          <div className="pille-zeile">
            <label>Zu verarbeitende Datei(en)</label>

            <FieldButton title="Weitere Datei" onClick={() => setzeMuster([...musterzeilen, undefined])}>
              <PlusIcon />
            </FieldButton>

            <Hint title="Zu verarbeitende Datei(en)">
              Welche Dateien aus dem Abholverzeichnis mitkommen — am Namen, an einem Teil davon, oder ausgesucht.
              Das Plus fügt eine Zeile hinzu; es genügt, wenn eine davon trifft.
            </Hint>
          </div>

          <div className="stack">
            {musterzeilen.map((kennung, stelle) => (
              <div className="field__row" key={stelle}>
                <Dateikennungszeile
                  beispiel="Filiale_*.csv"
                  kennung={kennung}
                  start={abholverzeichnis ?? ''}
                  tenantId={tenantId}
                  onEntfernen={stelle === 0 ? undefined : () => entferneMuster(stelle)}
                  onKennung={(naechste) =>
                    setzeMuster(musterzeilen.map((eine, i) => (i === stelle ? naechste : eine)))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/*
          * Als Stunden, Minuten, Sekunden — wie das Mindestalter beim Übertragen.
          *
          * Eine Wartezeit in reinen Sekunden verlangt Kopfrechnen: „1800" liest
          * niemand als eine halbe Stunde. Dieselbe Sache soll in dieser Anwendung
          * überall gleich eingegeben werden.
          */}
        <Field
          label="Wartezeit, bis eine Datei als fertig für Verarbeitung gilt"
          explain={
            <>
              <p>
                Wer eine große Datei hineinkopiert, legt ihren endgültigen Namen sofort an — sichtbar ist sie da, aber
                noch nicht vollständig.
              </p>
              <p>
                Ohne Wartezeit könnte ein Durchgang ein abgeschnittenes Stück verarbeiten. Der Wert sollte über der
                Zeit liegen, die eine Lieferung zum Schreiben braucht; bei Kopien über das Netz ist eine Minute ein
                nüchterner Anfang.
              </p>
              <p>Null heißt: Eine Datei zählt, sobald ihr Name da ist.</p>
            </>
          }
        >
          <DurationField
            seconds={wahl?.reifeSekunden ?? 0}
            onChange={(reifeSekunden) => aendern({ reifeSekunden: reifeSekunden || undefined })}
          />
        </Field>

        </>
      )}

      {/*
        * Vier Verzeichnisse hinter einem Knopf.
        *
        * Sie standen untereinander in der Fläche und nahmen mehr Raum ein als
        * alles andere zusammen — dabei werden sie einmal eingerichtet und dann
        * nie wieder angefasst. Was täglich beantwortet wird, gehört nach vorn;
        * was einmal entschieden wird, hinter einen Knopf.
        *
        * Beide Betriebsarten teilen sie sich, deshalb steht der Knopf hier und
        * nicht in einem der beiden Zweige.
        *
        * Keine Beschriftung darüber: Der Knopf sagt selbst, was er tut, und eine
        * Pille „Verzeichnisse" über „Verzeichnisse festlegen" sähe aus wie ein
        * Feld, das keines ist. Die Hülle `field` bleibt — sie trägt den Abstand
        * zum nächsten Feld.
        */}
      <div className="field">
        <div className="field__row">
          <button type="button" className="secondary" onClick={() => setOrteOffen(true)}>
            Verzeichnisse festlegen
          </button>

          <Hint title="Verzeichnisse">
            Wohin die Eingangsdateien wandern: ins Archiv, ins Arbeitsverzeichnis, und nach dem Durchgang nach
            „Erledigt" oder „Gescheitert".
          </Hint>
        </div>
      </div>

      {orteOffen && (
        <Ablageorte
          wahl={wahl}
          tenantId={tenantId}
          onAendern={aendern}
          onClose={() => setOrteOffen(false)}
        />
      )}

      {/*
        * Die Vorschau nur ohne Stapel.
        *
        * Sie beantwortet „was liegt da und käme mit". Im Stapelbetrieb ist die
        * Frage eine andere — welcher Platz besetzt ist —, und die beantwortet
        * der Lauf mit Namen. Eine Liste daneben beantwortete etwas, das hier
        * niemand fragt.
        */}
      {!stapel && <Vorschau verzeichnis={abholverzeichnis} wahl={wahl} tenantId={tenantId} />}

      {/*
        * Eine Rückfrage für beide Fälle — Zeile fortnehmen, Zahl senken.
        *
        * Ein Fenster und nicht der Dialog des Browsers: „Ja" vor „Nein",
        * rechtsbündig, in der Schrift dieser Anwendung. Und eines statt zweier,
        * weil beide dasselbe fragen — nur der Satz darin ist ein anderer.
        */}
      {frage && (
        <Modal title="Bitte bestätigen" ownActions onClose={() => setFrage(undefined)}>
          <p>{frage.text}</p>

          <div className="row modal__actions">
            <button
              type="button"
              onClick={() => {
                frage.tun();
                setFrage(undefined);
              }}
            >
              Ja
            </button>
            <button type="button" className="secondary" autoFocus onClick={() => setFrage(undefined)}>
              Nein
            </button>
          </div>
        </Modal>
      )}
    </Klappkarte>
  );
}

/**
 * Der Zustand dieser Fläche — die vier Farben aus `belegt.ts`.
 *
 * Der interessante Fall ist **rot**: Tragen manche Plätze die Marke `{stapel}`
 * und andere nicht, ist bei deren Lieferungen nicht zu sagen, zu welchem Stapel
 * sie gehören. Der Lauf sagt das ins Protokoll — der Punkt sagt es beim
 * Einrichten, und das ist die Stelle, an der man es noch ändern will.
 */
function stand(wahl: Dateiwahl | undefined): Feldstand {
  if (!wahl) {
    return 'LEER';
  }

  if (wahl.stapel) {
    const plaetze = wahl.stapel.plaetze;

    // Eine eingeschaltete Bedingung ohne Plätze ist keine Bedingung.
    if (plaetze.length === 0 || plaetze.some((platz) => platz.muster.trim() === '')) {
      return 'UNVOLLSTAENDIG';
    }

    const mitMarke = plaetze.filter((platz) => platz.muster.includes('{stapel}')).length;

    if (mitMarke > 0 && mitMarke < plaetze.length) {
      return 'FEHLERHAFT';
    }

    /*
     * Weniger Dateien als Plätze geht nie auf: Vollständig heißt, dass jeder
     * Platz besetzt ist **und** die Zahl stimmt. Der Durchgang wartete dann bis
     * zur Frist und meldete jede Nacht einen unvollständigen Stapel, ohne dass
     * je eine Datei fehlte.
     */
    if (wahl.stapel.anzahl !== undefined && wahl.stapel.anzahl < plaetze.length) {
      return 'FEHLERHAFT';
    }

    return 'GUELTIG';
  }

  const eingetragen =
    steht(wahl.muster) || steht(wahl.abholung?.erledigt) || (wahl.endungen?.length ?? 0) > 0;

  return eingetragen ? 'GUELTIG' : 'LEER';
}

function steht(wert: string | undefined): boolean {
  return Boolean(wert && wert.trim());
}

/** Was die Auswahl „Dateien insgesamt" anbietet. */
const ANZAHLEN = [2, 3, 4, 5];

/** Woran eine Datei zu erkennen ist — die drei Arten in ihrer Reihenfolge. */
const ARTEN: { wert: Dateikennung['art']; text: string }[] = [
  { wert: 'NAME', text: 'Dateiname' },
  { wert: 'MERKMAL', text: 'Merkmal im Namen' },
  { wert: 'DATEI', text: 'Datei auswählen' },
];

/**
 * Die Mindestbreite des Auswahlfeldes — aus seinem längsten Eintrag gerechnet.
 *
 * Damit steht das Feld von Anfang an so breit da, wie es im weitesten Fall sein
 * muss, und springt beim Umschalten nicht. Seit `appearance: base-select` misst
 * sich ein geschlossenes Auswahlfeld am **gewählten** Eintrag; ohne diese Angabe
 * wäre es bei „Dateiname" schmal und bei „Merkmal im Namen" breit.
 *
 * `ch` ist die Breite der Null und für Kleinbuchstaben großzügig; die Zugabe
 * deckt Innenabstand, Lücke und Pfeil. Lieber ein paar Pixel zu viel als ein
 * abgeschnittenes Wort.
 */
const ARTEN_BREITE = `calc(${Math.max(...ARTEN.map((eine) => eine.text.length))}ch + 3.2rem)`;

/**
 * Welches Format ein Durchgang aus seinem Abholverzeichnis nimmt.
 *
 * ## Warum eine Auswahl und kein Eingabefeld
 *
 * Hier stand ein Feld, in das man `csv, xlsx` tippen konnte, mit einer Liste
 * zum Anhaken daneben. Gelesen werden aber ohnehin nur sechs Formate — alles,
 * was man sonst eintrug, filterte jede Datei fort und sah dabei aus wie eine
 * Einstellung. Eine Auswahl kann das nicht.
 *
 * ## Warum an zwei Stellen dasselbe Stück
 *
 * „Welche Dateien" und „Mehrere Dateien zusammenführen" sind zwei Flächen
 * derselben Frage und schreiben in dasselbe Feld des Auftrags. Zweimal
 * hingeschrieben wären sie beim nächsten Format uneins.
 */
function Dateitypfeld({ wert, onWert }: { wert: string; onWert(next: string): void }) {
  return (
    <Field
      label="Dateityp"
      explain={
        <>
          <p>Welches Format aus dem Abholverzeichnis mitkommt.</p>
          <p>
            Gelesen werden ohnehin nur <code>csv</code>, <code>txt</code>, <code>tsv</code>, <code>json</code>,{' '}
            <code>xml</code> und <code>xlsx</code>. „Alle lesbaren" nimmt jedes davon.
          </p>
        </>
      }
    >
      {/*
        * Dieselbe Breite wie das Auswahlfeld der Dateizeilen.
        *
        * Zwei Auswahlfelder übereinander, das eine schmal, das andere breit,
        * lesen sich als zwei verschiedene Arten von Angabe. Es ist beides eine
        * Wahl aus wenigen Wörtern, also steht beides gleich breit da — aus
        * derselben Rechnung, damit es das auch nach einer Übersetzung noch tut.
        */}
      <select
        className="input--wahl"
        style={{ minWidth: ARTEN_BREITE }}
        value={wert}
        onChange={(event) => onWert(event.target.value)}
      >
        <option value="">Alle lesbaren</option>

        {LESBARE_TYPEN.map((endung) => (
          <option key={endung} value={endung}>
            {endung}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Eine Zeile: woran eine Datei des Stapels zu erkennen ist.
 *
 * Hier stand eine Liste benannter Plätze — je Beteiligtem eine Zeile mit Namen
 * und Namensmuster. An ihre Stelle treten benannte Dateien: eine Primär-Datei
 * und beliebig viele Sekundär-Dateien.
 *
 * ## Die Wahl steht vor dem Feld
 *
 * „Dateiname", „Merkmal im Namen" und „Datei auswählen" sind drei Arten,
 * dieselbe Frage zu beantworten. Als drei Felder, von denen zwei leer bleiben,
 * ließen sich alle füllen — und dann wäre nicht gesagt, welches gilt. Ein
 * Auswahlfeld davor lässt nur eine Antwort zu und sagt zugleich, wie das
 * Eingetippte zu lesen ist.
 *
 * Die Länge richtet sich danach: Ein Merkmal ist kurz (zwanzig Zeichen), ein
 * Dateiname kann es nicht sein — `Teilnehmer_Berlin_*.csv` hat allein
 * dreiundzwanzig.
 *
 * ## Das Fenster geht im Abholverzeichnis auf
 *
 * Und nicht an der Wurzel: Die Dateien eines Stapels liegen dort, und wer sie
 * aussucht, hat sie sonst jedes Mal von oben zu suchen.
 *
 * **Was die Dateien für den Lauf bedeuten, ist noch nicht gesagt.** Er prüft
 * die Vollständigkeit weiterhin an `plaetze`, und die lassen sich hier nicht
 * mehr eintragen — der Punkt an der Überschrift steht deshalb auf gelb. Das ist
 * kein Versehen, sondern der Stand: Die Fläche ist im Umbau.
 */
function Dateikennungszeile({
  beispiel,
  kennung,
  start,
  tenantId,
  onEntfernen,
  onKennung,
}: {
  /** Der Platzhalter für die Art „Dateiname" — ein Beispiel, kein Vorgabewert. */
  beispiel: string;
  kennung: Dateikennung | undefined;
  /** Wo das Auswahlfenster aufgeht — das Abholverzeichnis. */
  start: string;
  tenantId?: string;
  /**
   * Wie die Zeile fortkommt — fehlt bei der ersten.
   *
   * Der Papierkorb hängt an der **Stelle** und nicht daran, ob etwas
   * eingetragen ist: Ein Knopf, der erscheint und wieder verschwindet, während
   * man tippt, verschiebt die Zeile unter der Hand. Ob es eine Rückfrage gibt,
   * entscheidet der Aufrufer — er weiß, was in der Zeile steht.
   */
  onEntfernen?(): void;
  onKennung(next: Dateikennung | undefined): void;
}) {
  /*
   * Die gewählte Art steht daneben und nicht nur im Auftrag.
   *
   * Gespeichert wird eine Kennung erst, wenn etwas eingetragen ist — eine Art
   * ohne Wert sagt nichts. Genau daran scheiterte die Wahl aber: Wer „Datei
   * auswählen" in ein leeres Feld wählte, schrieb eine Kennung ohne Wert, die
   * sofort wieder verworfen wurde. Das Auswahlfeld sprang zurück auf
   * „Dateiname", und der Knopf zum Aussuchen erschien nie.
   *
   * Die Wahl gehört deshalb hierher: Sie ist eine Sache des Hinsehens, solange
   * sie auf nichts zeigt. Sobald ein Wert dasteht, wandert sie mit ihm in den
   * Auftrag.
   */
  const [artWahl, setArtWahl] = useState<Dateikennung['art']>();

  const art = artWahl ?? kennung?.art ?? 'NAME';
  const wert = kennung?.wert ?? '';

  const [offen, setOffen] = useState(false);

  const setze = (teile: Partial<Dateikennung>): void => {
    const naechste: Dateikennung = { art, wert, ...teile };

    if (teile.art) {
      setArtWahl(teile.art);
    }

    // Ohne Eingabe keine Angabe: Eine gespeicherte Art ohne Wert sagt nichts.
    onKennung(naechste.wert.trim() === '' ? undefined : naechste);
  };

  return (
    <>
      <select
        className="input--wahl"
        // Am Element und nicht im Erscheinungsbild: Hier stehen die Einträge.
        style={{ minWidth: ARTEN_BREITE }}
        value={art}
        onChange={(event) => setze({ art: event.target.value as Dateikennung['art'] })}
      >
        {ARTEN.map((eine) => (
          <option key={eine.wert} value={eine.wert}>
            {eine.text}
          </option>
        ))}
      </select>

      <input
        className="input--mittel"
        maxLength={art === 'MERKMAL' ? 20 : 260}
        value={wert}
        placeholder={art === 'MERKMAL' ? 'MERKMAL' : beispiel}
        spellCheck={false}
        // Ein ausgesuchter Pfad ist regelmäßig breiter als das Feld.
        {...titelBeiUeberlauf()}
        onChange={(event) => setze({ wert: event.target.value })}
      />

      {/*
        * Der Auswahlknopf nur bei „Datei auswählen".
        *
        * Bei den beiden anderen Arten steht im Feld ein Muster und kein Pfad —
        * ein Knopf, der eine einzelne Datei einträgt, machte daraus etwas
        * anderes, als dort stehen soll.
        */}
      {art === 'DATEI' && (
        <FieldButton title="Datei aussuchen" disabled={!tenantId} onClick={() => setOffen(true)}>
          <FolderIcon />
        </FieldButton>
      )}

      {onEntfernen && (
        <FieldButton title="Diese Zeile entfernen" onClick={onEntfernen}>
          <TrashIcon />
        </FieldButton>
      )}

      {offen && (
        <Verzeichnisfenster
          titel="Datei auswählen"
          start={start}
          waehle="DATEI"
          lies={(pfad) => durchsehen(pfad, tenantId)}
          onWaehlen={(wahl) => {
            /*
             * Der Name und nicht der Pfad: Verglichen wird später gegen den
             * Dateinamen im Abholverzeichnis. Ein voller Pfad träfe dort nie —
             * und wer eine Datei aussucht, meint sie und nicht ihren Weg.
             */
            setze({ wert: dateiname(wahl.relativ) });
            setOffen(false);
          }}
          onClose={() => setOffen(false)}
        />
      )}
    </>
  );
}

/**
 * Die Sekundär-Dateien als Liste.
 *
 * ## Warum eine eigene Fläche und kein `Field`
 *
 * Das Plus gehört zur Liste als Ganzem und nicht zu einer ihrer Zeilen —
 * deshalb steht es neben der Pille. `Field` setzt neben die Pille nichts; es
 * kennt nur den Platz neben dem Feld. Die Pillenzeile ist hier von Hand
 * gebaut, mit denselben Klassen.
 *
 * ## Warum diese Fläche nichts entscheidet
 *
 * Sie zeigt nur. Die Zeilen selbst, ihre Obergrenze und die Rückfragen liegen
 * bei `Stapelwahl` — dort steht auch „Erwartete Dateien", und beides
 * hängt zusammen: Wer die Zahl senkt, verliert Zeilen. Zwei Stellen, die
 * dieselbe Liste kürzen, wären früher oder später uneins darüber, welche Zeile
 * die letzte ist.
 */
function Sekundaerdateien({
  reihen,
  grenze,
  start,
  tenantId,
  onReihe,
  onEntfernen,
  onHinzu,
}: {
  /** Die Zeilen, wie sie dastehen — leere eingeschlossen. */
  reihen: (Dateikennung | undefined)[];
  /** Wie viele Zeilen höchstens erlaubt sind. */
  grenze: number;
  start: string;
  tenantId?: string;
  onReihe(stelle: number, kennung: Dateikennung | undefined): void;
  onEntfernen(stelle: number): void;
  onHinzu(): void;
}) {
  const voll = reihen.length >= grenze;

  return (
    <div className="field">
      <div className="pille-zeile">
        <label>Sekundär-Datei(en)</label>

        {/*
          * Das Plus endet, wo die erwartete Gesamtzahl endet.
          *
          * Ein Stapel aus drei Dateien hat eine Primär- und zwei
          * Sekundär-Dateien. Eine dritte anzulegen hieße, eine Zeile
          * anzubieten, die der Lauf nie füllen kann — und der Punkt an der
          * Überschrift stünde auf gelb, ohne dass jemand sähe, warum.
          */}
        <FieldButton
          title={voll ? 'Erst „Erwartete Dateien" erhöhen' : 'Weitere Sekundär-Datei'}
          disabled={voll}
          onClick={onHinzu}
        >
          <PlusIcon />
        </FieldButton>

        <Hint title="Sekundär-Datei(en)">
          Die weiteren Dateien, die zum selben Stapel gehören. Das Plus fügt eine Zeile hinzu — so viele, wie neben
          der Primär-Datei erwartet werden.
        </Hint>
      </div>

      <div className="stack">
        {reihen.map((kennung, stelle) => (
          <div className="field__row" key={stelle}>
            <Dateikennungszeile
              beispiel="Lieferschein_*.csv"
              kennung={kennung}
              start={start}
              tenantId={tenantId}
              /*
               * Die erste Zeile trägt keinen Papierkorb: Ohne sie gäbe es keine
               * Sekundär-Datei mehr, und die Fläche stünde leer da. Rückt eine
               * andere Zeile auf den ersten Platz, verliert sie ihren Knopf
               * damit von selbst — er hängt an der Stelle, nicht an der Zeile.
               */
              onEntfernen={stelle === 0 ? undefined : () => onEntfernen(stelle)}
              onKennung={(naechste) => onReihe(stelle, naechste)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Die vier Orte, an denen die Eingangsdateien eines Durchgangs vorbeikommen.
 *
 * ## Warum in einem Fenster
 *
 * Sie werden einmal eingerichtet und danach nicht mehr angefasst — anders als
 * Dateityp, Namensmuster und Wartezeit, die zur Sache gehören, die der Workflow
 * täglich tut. Untereinander in der Fläche nahmen sie mehr Raum ein als alles
 * andere zusammen.
 *
 * ## Die Reihenfolge ist der Weg
 *
 * Von oben nach unten steht, was der Lauf der Reihe nach tut: Erst geht eine
 * verschlüsselte Kopie ins **Archiv**, dann wandern die Dateien ins
 * **Arbeitsverzeichnis**, und nach dem Durchgang nach **Erledigt** oder
 * **Gescheitert**. Wer das Fenster von oben liest, liest den Ablauf.
 *
 * ## Nur ein Knopf zum Schließen
 *
 * Es gibt nichts zu bestätigen und nichts zu verwerfen: Jede Eingabe wirkt
 * sofort auf den Auftrag, so wie in der Fläche darunter auch. Ein
 * „Übernehmen" verspäche eine Entscheidung, die hier nicht fällt — gespeichert
 * wird der Workflow als Ganzes.
 */
function Ablageorte({
  wahl,
  tenantId,
  onAendern,
  onClose,
}: {
  wahl: Dateiwahl | undefined;
  tenantId?: string;
  onAendern(teile: Partial<Dateiwahl>): void;
  onClose(): void;
}) {
  const setze = (teile: Partial<Abholung>): void =>
    onAendern({ abholung: { ...wahl?.abholung, ...teile } });

  return (
    <Modal title="Verzeichnisse" onClose={onClose}>
      <Verzeichnisfeld
        label="Archiv (Original)"
        titel="Archivverzeichnis wählen"
        wert={wahl?.abholung?.archiv ?? ''}
        explain={
          <>
            <p>
              Wohin eine verschlüsselte Kopie der Eingangsdateien geht, bevor überhaupt eine davon angefasst
              wird. Ein Durchgang legt dort <strong>einen</strong> Behälter ab: die Dateien als ZIP, das Ganze mit
              AES-256 eingeschlagen.
            </p>
            <p>
              Das Archiv ist mehr als eine Vorsichtsmaßnahme — es ist der Grund, aus dem das Arbeitsverzeichnis
              hinterher überhaupt geräumt werden darf. Was nicht archiviert ist, wird nicht gelöscht.
            </p>
          </>
        }
        disabled={!tenantId}
        lies={(pfad) => durchsehen(pfad, tenantId)}
        marke={<Schreibprobe verzeichnis={wahl?.abholung?.archiv} tenantId={tenantId} />}
        onChange={(pfad) => setze({ archiv: pfad || undefined })}
      />

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
        marke={<Schreibprobe verzeichnis={wahl?.abholung?.arbeit} tenantId={tenantId} />}
        onChange={(pfad) => setze({ arbeit: pfad || undefined })}
      />

      <Verzeichnisfeld
        label="Erledigt"
        titel="Verzeichnis für erledigte Dateien wählen"
        wert={wahl?.abholung?.erledigt ?? ''}
        explain="Wohin die Eingangsdateien nach einem gelungenen Durchgang wandern. Leer heißt: Sie bleiben liegen — und stehen beim nächsten Lauf wieder da."
        disabled={!tenantId}
        lies={(pfad) => durchsehen(pfad, tenantId)}
        marke={<Schreibprobe verzeichnis={wahl?.abholung?.erledigt} tenantId={tenantId} />}
        onChange={(pfad) => setze({ erledigt: pfad || undefined })}
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
        marke={<Schreibprobe verzeichnis={wahl?.abholung?.gescheitert} tenantId={tenantId} />}
        onChange={(pfad) => setze({ gescheitert: pfad || undefined })}
      />
    </Modal>
  );
}

/**
 * Ob in dieses Verzeichnis geschrieben werden kann.
 *
 * ## Warum das hier steht und nicht erst im Lauf
 *
 * Arbeits-, Erledigt- und Gescheitert-Verzeichnis werden gebraucht, wenn der
 * Durchgang schon läuft: beim Übernehmen des Stapels, nach dem Gelingen, nach
 * dem Misslingen. Fehlt dort das Schreibrecht, fällt es als Warnung im
 * Protokoll an — nachts, und die Dateien bleiben liegen. Hier fällt es beim
 * Einrichten auf, wo jemand zusieht.
 *
 * ## Warum sie von selbst läuft
 *
 * Ein Knopf „prüfen" wird gedrückt, solange man daran denkt. Diese Probe
 * kostet eine winzige Datei, die sofort wieder fort ist — sie darf von selbst
 * laufen. Die Wartezeit davor sammelt das Tippen ein: Wer einen Pfad eingibt,
 * soll nicht bei jedem Zeichen eine Antwort bekommen.
 *
 * ## Ein Zeichen und keine Zeile
 *
 * Hier stand die Antwort als Satz unter dem Feld. Sie erschien, sobald sie
 * eintraf, und schob alles darunter fort — mitten im Tippen, und dreimal
 * untereinander bei drei Verzeichnissen. Jetzt steht sie als Haken oder Kreuz
 * in der Zeile des Feldes, auf einem Platz, der von Anfang an freigehalten
 * wird; der Satz dazu hängt am Zeichen und kommt beim Überfahren.
 */
function Schreibprobe({ verzeichnis, tenantId }: { verzeichnis: string | undefined; tenantId?: string }) {
  const [stand, setStand] = useState<{ ok: boolean; message: string }>();

  useEffect(() => {
    const pfad = (verzeichnis ?? '').trim();

    if (pfad === '' || !tenantId) {
      setStand(undefined);
      return;
    }

    /*
     * Wer tippt, stellt mehrere Anfragen. Ohne diese Marke gewänne die zuletzt
     * **eingetroffene** und nicht die zuletzt gestellte — und unter dem Feld
     * stünde die Antwort auf einen Pfad, der dort nicht mehr steht.
     */
    let gilt = true;

    const uhr = setTimeout(() => {
      void api
        .post<{ ok: boolean; message: string }>('/api/jobs/check-local', { tenantId, directory: pfad })
        .then((antwort) => {
          if (gilt) {
            setStand(antwort);
          }
        })
        .catch((fehler) => {
          if (gilt) {
            setStand({ ok: false, message: messageOf(fehler, 'Die Schreibprobe ist fehlgeschlagen') });
          }
        });
    }, 600);

    return () => {
      gilt = false;
      clearTimeout(uhr);
    };
  }, [verzeichnis, tenantId]);

  /*
   * Auch ohne Antwort ein Platzhalter: Sonst rückte die Zeile beim ersten
   * Ergebnis um die Breite des Zeichens, und der Auswahlknopf wäre plötzlich
   * woanders — derselbe Sprung, nur waagerecht.
   */
  if (!stand) {
    return <span className="probe" aria-hidden="true" />;
  }

  return (
    <span
      className={stand.ok ? 'probe probe--gut' : 'probe probe--schlecht'}
      title={stand.message}
      role="img"
      aria-label={stand.message}
    >
      {stand.ok ? '✓' : '✗'}
    </span>
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

  /*
   * Ohne eigenes Abholverzeichnis gibt es nichts durchzusehen: Wer übernimmt,
   * was der Schritt davor ablegt, bekommt die Liste dieses Laufs, und die steht
   * erst zur Laufzeit fest. Dann steht hier nichts — ein Satz, der erklärt,
   * warum ein Knopf fehlt, ist eine Zeile, die man bei jedem Blick mitliest.
   */
  if (!verzeichnis) {
    return null;
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
const LESBARE_TYPEN = ['csv', 'txt', 'tsv', 'json', 'xml', 'xlsx'];

/**
 * Ob diese Datei mitkäme.
 *
 * Die Regel steht hier noch einmal, wie schon bei den Freigaben: Der Server
 * entscheidet, die Oberfläche zeigt. Ein gemeinsames Modul würde die beiden
 * Rollen vermischen.
 *
 * Sie bildet den Lauf Schritt für Schritt nach — lesbares Format, gewählter
 * Dateityp, Namensmuster. Eine Vorschau, die weniger prüft als der Lauf, sagt
 * an genau der Stelle etwas Falsches, an der man sie fragt.
 */
function nimmt(name: string, wahl: Dateiwahl | undefined): boolean {
  const klein = name.toLowerCase();

  if (!LESBARE_TYPEN.some((endung) => klein.endsWith('.' + endung))) {
    return false;
  }

  const gewaehlt = (wahl?.endungen ?? []).map(bloss).filter((eine) => eine !== '');

  if (gewaehlt.length > 0 && !gewaehlt.some((eine) => klein.endsWith('.' + eine))) {
    return false;
  }

  /*
   * Das Komma trennt — wie im Feld angekündigt und wie der Lauf es hält. Hier
   * stand vorher das ganze Feld als **ein** Muster: „Filiale_*.csv,
   * Umsatz_*.csv" traf damit nichts, und die Vorschau zeigte alles unter
   * „bleibt draußen", während der Lauf beides mitnahm.
   */
  const muster = (wahl?.muster ?? '')
    .split(',')
    .map((stueck) => stueck.trim())
    .filter((stueck) => stueck !== '');

  if (muster.length === 0) {
    return true;
  }

  return muster.some((eines) => {
    const maskiert = eines.replace(/[.+^${}()|[\]\\]/g, (zeichen) => '\\' + zeichen);

    return new RegExp('^' + maskiert.split('*').join('.*').split('?').join('.') + '$', 'i').test(name);
  });
}


/** Eine Endung ohne führenden Punkt und ohne Schreibweise — wie in der Domäne. */
function bloss(endung: string): string {
  return endung.trim().replace(/^\.+/, '').toLowerCase();
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
