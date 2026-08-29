import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf } from '../api/useResource.js';
import type {
  Betriebsart,
  Dublettenauswahl,
  Entscheidungsgrund,
  Konsolidierungsart,
  Konsolidierungsbericht,
  Mehrfachtreffer,
  OhneHauptsatz,
} from '../api/types.js';
import { Empty, Field, Notice, RowButton, TrashIcon } from '../components/Pieces.js';
import { Auswahlfeld } from '../components/Auswahlfeld.js';

/**
 * Der Prüflauf über mehrere Quellen (SPEC-06, Abschnitt 11).
 *
 * Er verändert nichts. Was hier zu sehen ist, ist dieselbe Rechnung, die im
 * Lauf stattfindet — deshalb steht darin auch alles, was dort entschieden
 * würde: die Zusammenführungen, die Dubletten, die Konflikte und die
 * Datensätze, die so nicht durchgehen.
 */
const BETRIEBSART_LABELS: Record<Betriebsart, string> = {
  ANREICHERN: 'Anreichern - eine Datei führt',
  SAMMELN: 'Sammeln - alle Quellen sind gleichwertig',
};

const BETRIEBSART_HINTS: Record<Betriebsart, string> = {
  ANREICHERN:
    'Die Hauptdatei liefert die Datensätze, die übrigen ergänzen sie. Ein Datensatz einer Zusatzdatei ohne Bezug zur Hauptdatei wird zum Konflikt.',
  SAMMELN:
    'Kundenlisten zweier Filialen etwa. Ein fehlender Bezug ist hier kein Konflikt - es gibt keine Datei, auf die er sich beziehen müsste.',
};

const ART_LABELS: Record<Konsolidierungsart, string> = {
  APPEND: 'Aneinanderhängen',
  MERGE: 'Zusammenführen',
};

const ART_HINTS: Record<Konsolidierungsart, string> = {
  APPEND: 'Die Datensätze kommen nebeneinander in einen Bestand. Ein Schlüssel dient dann nur dazu, Dubletten zu finden.',
  MERGE: 'Datensätze mit demselben Schlüssel werden feldweise zu einem vereinigt. Ohne Schlüssel geht das nicht.',
};

const AUSWAHL_LABELS: Record<Dublettenauswahl, string> = {
  ZUSAMMENFUEHREN: 'feldweise vereinigen',
  ERSTER: 'den ersten behalten',
  LETZTER: 'den letzten behalten',
  PRIORITAET: 'den aus der wichtigsten Quelle behalten',
  ALLE_BEHALTEN: 'alle stehen lassen',
  ENTSCHEIDEN: 'einem Menschen vorlegen',
};

const MEHRFACH_LABELS: Record<Mehrfachtreffer, string> = {
  KONFLIKT: 'genau einer erwartet - sonst Konflikt',
  ALLE: 'alle übernehmen (der Hauptdatensatz vervielfacht sich)',
  FELD: 'ein Feld entscheidet',
};

const OHNE_HAUPTSATZ_LABELS: Record<OhneHauptsatz, string> = {
  KONFLIKT: 'als Konflikt vorlegen',
  UEBERNEHMEN: 'trotzdem übernehmen',
  UEBERSPRINGEN: 'übergehen',
};

const GRUND_LABELS: Record<Entscheidungsgrund, string> = {
  KONFLIKTBEARBEITUNG: 'von Hand entschieden',
  EINIG: 'alle einig',
  EINZIGER_WERT: 'nur eine Quelle hatte einen Wert',
  BENUTZERREGEL: 'ausdrückliche Regel',
  FELDPRIORITAET: 'Priorität für dieses Feld',
  QUELLENPRIORITAET: 'Quellenpriorität',
  AKTUALITAET: 'jüngster Datenstand',
  MEHRHEIT: 'Mehrheit über der Schwelle',
};

interface Quelleneingabe {
  id: string;
  name: string;
  text: string;
}

const BEISPIEL: Quelleneingabe[] = [
  {
    id: 'kunden',
    name: 'Kunden.csv',
    text: 'kdnr;name;ort\n4711;Müller GmbH;Bonn\n4712;Meier KG;\n',
  },
  {
    id: 'crm',
    name: 'CRM-Export.csv',
    text: 'kdnr;telefon;ort\n4711;069 123456;Bonn\n4712;0221 99887;Köln\n4713;0211 4711;Düsseldorf\n',
  },
];

/**
 * Der Mandant kommt von außen und wird nicht mehr hier gewählt — siehe
 * `TenantsScreen`. Er entscheidet hier mehr als anderswo: wie Zahlen und
 * Datumsangaben gelesen werden und ab welcher Sicherheit Unikom selbst
 * entscheiden darf.
 */
export function MergeScreen({ mandant }: { mandant: string }) {
  const [quellen, setQuellen] = useState<Quelleneingabe[]>([
    { id: 'quelle1', name: '', text: '' },
    { id: 'quelle2', name: '', text: '' },
  ]);
  const [betriebsart, setBetriebsart] = useState<Betriebsart>('SAMMELN');
  const [art, setArt] = useState<Konsolidierungsart>('MERGE');
  const [fuehrend, setFuehrend] = useState('');
  const [schluessel, setSchluessel] = useState('');
  const [prioritaet, setPrioritaet] = useState(true);
  const [auswahl, setAuswahl] = useState<Dublettenauswahl>('ZUSAMMENFUEHREN');
  const [mehrfach, setMehrfach] = useState<Mehrfachtreffer>('KONFLIKT');
  const [mehrfachFeld, setMehrfachFeld] = useState('');
  const [ohneHauptsatz, setOhneHauptsatz] = useState<OhneHauptsatz>('KONFLIKT');
  const [suchen, setSuchen] = useState(false);
  const [aehnlichFelder, setAehnlichFelder] = useState('');
  const [schwelle, setSchwelle] = useState('0,85');
  const [bericht, setBericht] = useState<Konsolidierungsbericht>();
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);

  const gefuellt = quellen.filter((quelle) => quelle.text.trim() !== '');

  function aendere(stelle: number, teil: Partial<Quelleneingabe>): void {
    setQuellen(quellen.map((quelle, index) => (index === stelle ? { ...quelle, ...teil } : quelle)));
  }

  async function pruefen(): Promise<void> {
    setBusy(true);
    setFehler(undefined);
    setBericht(undefined);

    try {
      setBericht(
        await api.post<Konsolidierungsbericht>('/api/consolidation/preview', {
          tenantId: mandant,
          mode: betriebsart,
          type: art,
          leading: betriebsart === 'ANREICHERN' ? fuehrend : undefined,
          key: schluessel.trim() === '' ? undefined : { fields: felderAus(schluessel) },
          /*
           * Die Reihenfolge der Quellen ist die Priorität — sie steht auf dem
           * Bildschirm und muss nicht zweimal eingegeben werden. Wer sie nicht
           * gelten lassen will, schaltet sie ab; dann entscheidet keine
           * Rangfolge, sondern es entsteht ein Konflikt.
           */
          priority: prioritaet ? { sources: gefuellt.map((quelle) => quelle.id) } : undefined,
          duplicates: { choose: auswahl },
          multipleMatches:
            mehrfach === 'FELD'
              ? { rule: 'FELD', field: mehrfachFeld, take: 'GROESSTER' }
              : { rule: mehrfach },
          withoutLeading: ohneHauptsatz,
          similarity:
            suchen && felderAus(aehnlichFelder).length > 0
              ? { fields: felderAus(aehnlichFelder), threshold: schwelleAus(schwelle) }
              : undefined,
          sources: gefuellt.map((quelle) => ({
            id: quelle.id,
            name: quelle.name.trim() === '' ? quelle.id : quelle.name,
            text: quelle.text,
          })),
        })
      );
    } catch (error) {
      setFehler(messageOf(error, 'Der Prüflauf ist misslungen'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}

      <section className="card">
        <h2>Quellen</h2>
        <p className="muted">
          Jede Quelle bekommt einen Namen und ihren Inhalt. Trennzeichen, Kodierung und Kopfzeile erkennt der Server -
          im Browser wird nichts zerlegt.
        </p>

        {quellen.map((quelle, stelle) => (
          <div key={quelle.id} className="card card--inner">
            <div className="row row--between">
              <strong>
                {stelle + 1}. Quelle{prioritaet && stelle === 0 ? ' - die wichtigste' : ''}
              </strong>
              {quellen.length > 2 && (
                <RowButton
                  title="Diese Quelle entfernen"
                  tone="bad"
                  onClick={() => setQuellen(quellen.filter((unbenutzt, index) => index !== stelle))}
                >
                  <TrashIcon />
                </RowButton>
              )}
            </div>

            <Field label="Name" explain="So heißt sie in jedem Konflikt und in jeder Herkunftsangabe.">
              <input
                value={quelle.name}
                placeholder={`Quelle ${stelle + 1}.csv`}
                onChange={(event) => aendere(stelle, { name: event.target.value })}
              />
            </Field>

            <Field label="Inhalt">
              <textarea
                rows={6}
                value={quelle.text}
                placeholder={'kdnr;name;ort\n4711;Müller GmbH;Bonn'}
                onChange={(event) => aendere(stelle, { text: event.target.value })}
              />
            </Field>
          </div>
        ))}

        <div className="row">
          <button
            className="secondary"
            onClick={() =>
              setQuellen([...quellen, { id: `quelle${quellen.length + 1}`, name: '', text: '' }])
            }
          >
            Weitere Quelle
          </button>
          {gefuellt.length === 0 && (
            <button className="secondary" onClick={() => setQuellen(BEISPIEL)}>
              Beispiel einsetzen
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Wie zusammengeführt wird</h2>

        <Field label="Betriebsart" explain={BETRIEBSART_HINTS[betriebsart]}>
          <Auswahlfeld value={betriebsart} onChange={(event) => setBetriebsart(event.target.value as Betriebsart)}>
            {Object.entries(BETRIEBSART_LABELS).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahlfeld>
        </Field>

        {betriebsart === 'ANREICHERN' && (
          <>
            <Field label="Hauptdatei" explain="Sie wird nicht erraten. Ohne diese Angabe läuft nichts.">
              <Auswahlfeld value={fuehrend} onChange={(event) => setFuehrend(event.target.value)}>
                <option value="">- bitte wählen -</option>
                {gefuellt.map((quelle) => (
                  <option key={quelle.id} value={quelle.id}>
                    {quelle.name.trim() === '' ? quelle.id : quelle.name}
                  </option>
                ))}
              </Auswahlfeld>
            </Field>

            <Field
              label="Datensatz ohne Hauptdatensatz"
              explain="Standardmäßig ein Konflikt: Aus einer Zusatzdatei einen neuen Hauptdatensatz zu erzeugen, wäre eine Entscheidung über den Bestand."
            >
              <Auswahlfeld value={ohneHauptsatz} onChange={(event) => setOhneHauptsatz(event.target.value as OhneHauptsatz)}>
                {Object.entries(OHNE_HAUPTSATZ_LABELS).map(([wert, label]) => (
                  <option key={wert} value={wert}>
                    {label}
                  </option>
                ))}
              </Auswahlfeld>
            </Field>

            <Field label="Mehrere Treffer je Hauptdatensatz" explain={mehrfach === 'FELD' ? undefined : MEHRFACH_LABELS[mehrfach]}>
              <Auswahlfeld value={mehrfach} onChange={(event) => setMehrfach(event.target.value as Mehrfachtreffer)}>
                {Object.entries(MEHRFACH_LABELS).map(([wert, label]) => (
                  <option key={wert} value={wert}>
                    {label}
                  </option>
                ))}
              </Auswahlfeld>
            </Field>

            {mehrfach === 'FELD' && (
              <Field label="Dieses Feld entscheidet" explain="Der größte Wert gewinnt - ein Änderungsdatum, eine Versionsnummer, ein Rang.">
                <input
                  value={mehrfachFeld}
                  placeholder="stand"
                  onChange={(event) => setMehrfachFeld(event.target.value)}
                />
              </Field>
            )}
          </>
        )}

        <Field label="Art" explain={ART_HINTS[art]}>
          <Auswahlfeld value={art} onChange={(event) => setArt(event.target.value as Konsolidierungsart)}>
            {Object.entries(ART_LABELS).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahlfeld>
        </Field>

        <Field
          label="Schlüsselfelder"
          explain="Woran zwei Datensätze als derselbe erkannt werden - ein Feld oder mehrere, mit Komma getrennt. Unikom bestimmt ihn nicht selbst."
        >
          <input
            value={schluessel}
            placeholder="kdnr  oder  nachname, vorname, geburtsdatum"
            onChange={(event) => setSchluessel(event.target.value)}
          />
        </Field>

        <Field label="Bei doppelten Datensätzen">
          <Auswahlfeld value={auswahl} onChange={(event) => setAuswahl(event.target.value as Dublettenauswahl)}>
            {Object.entries(AUSWAHL_LABELS).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahlfeld>
        </Field>

        <label className="check">
          <input type="checkbox" checked={prioritaet} onChange={(event) => setPrioritaet(event.target.checked)} />
          <span>
            Die Reihenfolge der Quellen gilt als Priorität - die erste hat Vorrang. Ohne sie wird jeder Widerspruch ein
            Konflikt.
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={suchen} onChange={(event) => setSuchen(event.target.checked)} />
          <span>
            Zusätzlich nach <strong>ähnlichen</strong> Datensätzen suchen, die der Schlüssel nicht zusammengebracht hat.
            Sie werden nie zusammengeführt - es entsteht eine Frage.
          </span>
        </label>

        {suchen && (
          <>
            <Field
              label="Ähnlichkeit messen an"
              explain="Ein Feld oder mehrere, mit Komma getrennt. Es zählt das schwächste - zwei gleiche Namen mit verschiedenem Geburtsdatum sind zwei Personen."
            >
              <input
                value={aehnlichFelder}
                placeholder="nachname, vorname"
                onChange={(event) => setAehnlichFelder(event.target.value)}
              />
            </Field>

            <Field
              label="Ab welcher Ähnlichkeit gefragt wird"
              explain={hinweisZurSchwelle(schwelleAus(schwelle))}
            >
              <input value={schwelle} onChange={(event) => setSchwelle(event.target.value)} />
            </Field>
          </>
        )}

        <div className="row">
          <button disabled={busy || gefuellt.length === 0} onClick={() => void pruefen()}>
            {busy ? 'Prüflauf läuft …' : 'Prüflauf'}
          </button>
        </div>
      </section>

      {bericht && <Bericht bericht={bericht} />}
    </>
  );
}

/**
 * Die Schwelle, wie ein deutscher Anwender sie schreibt.
 *
 * „0,85" mit Komma — `Number('0,85')` wäre `NaN`, und daraus würde still eine
 * Suche ohne Schwelle. Was sich nicht lesen lässt, fällt auf die
 * Voreinstellung zurück; der Hinweis unter dem Feld sagt, was gerade gilt.
 */
function schwelleAus(eingabe: string): number {
  const zahl = Number(eingabe.trim().replace(',', '.'));

  return Number.isFinite(zahl) && zahl > 0 && zahl <= 1 ? zahl : 0.85;
}

/**
 * Was die eingestellte Schwelle praktisch bedeutet.
 *
 * Eine Zahl zwischen 0 und 1 sagt niemandem etwas. Wie viele Tippfehler sie in
 * einem Namen durchgehen lässt, schon — und bei kurzen Kennungen ist die
 * Antwort „keinen", was man wissen muss, bevor man sich wundert.
 */
function hinweisZurSchwelle(wert: number): string {
  const beiZehn = Math.floor((1 - wert) * 10 + 1e-9);
  const beiFuenf = Math.floor((1 - wert) * 5 + 1e-9);

  return (
    `${(wert * 100).toFixed(0)} %: In einem zehnstelligen Namen sind das ${beiZehn} Abweichung(en), ` +
    `in einer fünfstelligen Kennung ${beiFuenf}. ` +
    (beiFuenf === 0 ? 'Für kurze Werte muss die Schwelle tiefer stehen.' : '')
  );
}

function felderAus(eingabe: string): string[] {
  return eingabe
    .split(',')
    .map((feld) => feld.trim())
    .filter((feld) => feld !== '');
}

function Bericht({ bericht }: { bericht: Konsolidierungsbericht }) {
  const zahlen = bericht.zusammenfassung;

  return (
    <>
      <section className="card">
        <h2>Prüflauf</h2>
        <p className="muted">Nichts davon wurde geschrieben. Der Lauf rechnet genauso.</p>

        <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
          <Kennzahl name="Quellen" wert={String(zahlen.quellen)} />
          <Kennzahl name="Gelesen" wert={String(zahlen.gelesen)} />
          <Kennzahl name="Ergebnis" wert={String(zahlen.ergebnis)} />
          <Kennzahl name="Zusammengeführt" wert={String(zahlen.zusammengefuehrt)} />
          <Kennzahl name="Dubletten" wert={String(zahlen.dubletten)} />
          <Kennzahl name="Konflikte" wert={String(zahlen.konflikte)} />
          <Kennzahl name="Ergänzt" wert={String(zahlen.ergaenzt)} />
          <Kennzahl name="Verdacht" wert={String(zahlen.verdacht)} />
        </div>

        {bericht.hinweise.map((hinweis) => (
          <Notice key={hinweis} kind="info">
            {hinweis}
          </Notice>
        ))}
      </section>

      <section className="card">
        <h2>Ergebnis</h2>

        {bericht.zeilen.length === 0 ? (
          <Empty>Keine Zeile hat es durch die Regeln geschafft. Was dagegen sprach, steht unter „Konflikte".</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  {bericht.felder.map((feld) => (
                    <th key={feld}>{feld}</th>
                  ))}
                  <th>Herkunft</th>
                </tr>
              </thead>
              <tbody>
                {bericht.zeilen.map((zeile, stelle) => (
                  <tr key={stelle}>
                    {zeile.werte.map((wert, spalte) => (
                      <td key={spalte}>{wert === '' ? <span className="muted">-</span> : wert}</td>
                    ))}
                    <td className="muted">
                      {zeile.herkunft.map((herkunft) => `${herkunft.quelle}:${herkunft.zeile}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bericht.zeilen.some((zeile) => zeile.entscheidungen.length > 0) && (
        <section className="card">
          <h2>Entschiedene Felder</h2>
          <p className="muted">
            Wo mehrere Quellen etwas zu sagen hatten. Eine Entscheidung ohne festgehaltene Begründung wäre keine
            zulässige Entscheidung.
          </p>

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Schlüssel</th>
                <th>Feld</th>
                <th>Genommen</th>
                <th>Regel</th>
                <th>Begründung</th>
              </tr>
            </thead>
            <tbody>
              {bericht.zeilen.flatMap((zeile) =>
                zeile.entscheidungen.map((feld) => (
                  <tr key={`${zeile.schluessel}-${feld.feld}`}>
                    <td>{zeile.schluessel}</td>
                    <td>{feld.feld}</td>
                    <td>
                      {feld.wert} <span className="muted">aus {feld.quelle}</span>
                    </td>
                    <td>{GRUND_LABELS[feld.grund]}</td>
                    <td>
                      {feld.begruendung}
                      {feld.uebergangen.length > 0 && (
                        <div className="muted">
                          übergangen: {feld.uebergangen.map((angebot) => `${angebot.quelle} „${angebot.wert}"`).join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {bericht.konflikte.length > 0 && (
        <section className="card">
          <h2>Konflikte</h2>

          {bericht.konflikte.map((konflikt, stelle) => (
            <div key={stelle} className="card card--inner">
              <div className="row row--between">
                <strong>
                  {konflikt.quelle ?? 'Der Lauf'}
                  {konflikt.blatt ? `, Blatt „${konflikt.blatt}"` : ''}
                  {konflikt.zeile ? `, Zeile ${konflikt.zeile}` : ''}
                  {konflikt.feld ? ` - Feld „${konflikt.feld}"` : ''}
                </strong>
                {konflikt.schluessel && <span className="muted">Schlüssel {konflikt.schluessel}</span>}
              </div>

              <dl className="details">
                <dt>Erwartet</dt>
                <dd>{konflikt.erwartet}</dd>
                <dt>Vorgefunden</dt>
                <dd>{konflikt.vorgefunden}</dd>
                <dt>Ursache</dt>
                <dd>{konflikt.ursache}</dd>
                <dt>Nächste Schritte</dt>
                <dd>{konflikt.naechsteSchritte}</dd>
              </dl>
            </div>
          ))}
        </section>
      )}

      {bericht.dubletten.length > 0 && (
        <section className="card">
          <h2>Dubletten</h2>
          <p className="muted">Sie werden niemals ungefragt gelöscht. Was zurücktritt, steht hier.</p>

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Schlüssel</th>
                <th>Anzahl</th>
                <th>Art</th>
                <th>Quellen</th>
                <th>Behandlung</th>
              </tr>
            </thead>
            <tbody>
              {bericht.dubletten.map((dublette) => (
                <tr key={dublette.schluessel}>
                  <td>{dublette.schluessel}</td>
                  <td>{dublette.anzahl}</td>
                  <td>
                    {dublette.art === 'INNERHALB'
                      ? 'in einer Quelle'
                      : dublette.art === 'UEBERGREIFEND'
                        ? 'zwischen Quellen'
                        : 'beides'}
                    {dublette.exakt ? ' · wörtlich gleich' : ''}
                  </td>
                  <td>{dublette.quellen.join(', ')}</td>
                  <td>{dublette.behandlung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bericht.zurueckgestellt.length > 0 && (
        <section className="card">
          <h2>Zurückgetreten</h2>

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Quelle</th>
                <th>Zeile</th>
                <th>Verbleib</th>
                <th>Grund</th>
              </tr>
            </thead>
            <tbody>
              {bericht.zurueckgestellt.map((eintrag, stelle) => (
                <tr key={stelle}>
                  <td>{eintrag.quelle}</td>
                  <td>{eintrag.zeile}</td>
                  <td>
                    {eintrag.verbleib === 'VERWERFEN'
                      ? 'verworfen'
                      : eintrag.verbleib === 'SEPARAT'
                        ? 'separat'
                        : 'im Bericht'}
                  </td>
                  <td>{eintrag.grund}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bericht.verdacht.length > 0 && (
        <section className="card">
          <h2>Verdacht auf Dublette</h2>
          <p className="muted">
            Der Schlüssel hat sie nicht zusammengebracht, die Ähnlichkeitssuche hält sie für möglicherweise identisch.
            Zusammengeführt wurde nichts - beide Datensätze stehen oben im Ergebnis.
          </p>

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Ähnlichkeit</th>
                <th>Der eine</th>
                <th>Der andere</th>
                <th>Was verglichen wurde</th>
              </tr>
            </thead>
            <tbody>
              {bericht.verdacht.map((fall, stelle) => (
                <tr key={stelle}>
                  <td>{Math.round(fall.wert * 100)} %</td>
                  <td>
                    {fall.links.quelle}, Zeile {fall.links.zeile}
                  </td>
                  <td>
                    {fall.rechts.quelle}, Zeile {fall.rechts.zeile}
                  </td>
                  <td>
                    {fall.felder.map((feld) => (
                      <div key={feld.feld}>
                        <span className="muted">{feld.feld}:</span> „{feld.links}" gegen „{feld.rechts}"{' '}
                        <span className="muted">({Math.round(feld.wert * 100)} %)</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(bericht.ergaenzungen.length > 0 || bericht.ergaenzungsluecken.length > 0) && (
        <section className="card">
          <h2>Ergänzte Werte</h2>

          <ul>
            {bericht.ergaenzungen.map((ergaenzung, stelle) => (
              <li key={`e${stelle}`}>
                {ergaenzung.quelle}, Zeile {ergaenzung.zeile}: „{ergaenzung.feld}" = „{ergaenzung.wert}" -{' '}
                {ergaenzung.begruendung}
              </li>
            ))}
            {bericht.ergaenzungsluecken.map((luecke, stelle) => (
              <li key={`l${stelle}`} className="muted">
                {luecke.quelle}, Zeile {luecke.zeile}: {luecke.begruendung}
              </li>
            ))}
          </ul>
        </section>
      )}

      {bericht.referenzen.length > 0 && (
        <section className="card">
          <h2>Referenzabgleich</h2>

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Bestand</th>
                <th>Stand</th>
                <th>Treffer</th>
                <th>ohne Treffer</th>
                <th>mehrdeutig</th>
                <th>übernommen</th>
              </tr>
            </thead>
            <tbody>
              {bericht.referenzen.map((referenz) => (
                <tr key={referenz.bestand}>
                  <td>{referenz.bestand}</td>
                  <td>{referenz.version ?? <span className="muted">unbekannt</span>}</td>
                  <td>{referenz.treffer}</td>
                  <td>{referenz.ohneTreffer}</td>
                  <td>{referenz.mehrdeutig}</td>
                  <td>{referenz.uebernahmen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
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
