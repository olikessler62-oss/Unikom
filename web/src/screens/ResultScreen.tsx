import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type {
  Ergebnisstand,
  Pruefart,
  Pruefbefund,
  Schwere,
  Tenant,
  Verarbeitungsstatus,
} from '../api/types.js';
import { Empty, Field, Loading, Notice } from '../components/Pieces.js';
import { Auswahlfeld } from '../components/Auswahlfeld.js';

/**
 * Ergebnisse und ihre Freigabe (SPEC-08, Abschnitt 10 bis 13).
 *
 * Der Bildschirm beantwortet eine einzige Frage in großen Buchstaben: **Darf
 * das hinaus?** Alles andere ist Begründung dazu.
 *
 * Ein Ergebnis, das noch auf eine Freigabe wartet, ist kein Ergebnis — es darf
 * von Modul 3 nicht übernommen werden. Deshalb steht der Status nicht als
 * kleines Etikett am Rand, sondern als Satz obendrüber.
 */
const STATUS_LABELS: Record<Verarbeitungsstatus, string> = {
  COMPLETED: 'abgeschlossen',
  COMPLETED_WITH_WARNINGS: 'abgeschlossen, mit Anmerkungen',
  COMPLETED_WITH_CONFLICTS: 'abgeschlossen, mit Konflikten',
  WAITING_FOR_RELEASE: 'wartet auf Freigabe',
  FAILED: 'gescheitert',
};

const PRUEFART_LABELS: Record<Pruefart, string> = {
  VOLLSTAENDIGKEIT: 'Vollständigkeit',
  ANZAHL: 'Datensatzzahl',
  DUPLIKATE: 'Duplikate',
  PFLICHTWERTE: 'Pflichtwerte',
  DATENTYPEN: 'Datentypen',
  ZIELSTRUKTUR: 'Zielstruktur',
  REFERENZEN: 'Referenzen',
  ABHAENGIGKEITEN: 'Abhängigkeiten',
  ABWEICHUNG: 'Abweichung zum Eingang',
};

const SCHWERE_TON: Record<Schwere, 'info' | 'warn' | 'error'> = {
  INFO: 'info',
  WARNUNG: 'warn',
  KONFLIKT: 'error',
  FEHLER: 'error',
};

export function ResultScreen() {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [tenantId, setTenantId] = useState<string>();
  const [staende, setStaende] = useState<Ergebnisstand[]>();
  const [gewaehlt, setGewaehlt] = useState<Ergebnisstand>();
  const [begruendung, setBegruendung] = useState('');
  const [meldung, setMeldung] = useState<string>();
  const [fehler, setFehler] = useState<string>();
  const [busy, setBusy] = useState(false);

  const mandant = tenantId ?? tenants.data?.[0]?.id;

  async function laden(): Promise<void> {
    if (!mandant) {
      return;
    }

    try {
      setStaende(await api.get<Ergebnisstand[]>(`/api/results?tenantId=${encodeURIComponent(mandant)}`));
    } catch (error) {
      setFehler(messageOf(error, 'Die Ergebnisstände konnten nicht geladen werden'));
    }
  }

  useEffect(() => {
    void laden();
  }, [mandant]);

  async function oeffnen(id: string): Promise<void> {
    setMeldung(undefined);
    setBegruendung('');

    try {
      setGewaehlt(await api.get<Ergebnisstand>(`/api/results/${id}`));
    } catch (error) {
      setFehler(messageOf(error, 'Der Ergebnisstand konnte nicht geladen werden'));
    }
  }

  async function freigeben(): Promise<void> {
    if (!gewaehlt) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      await api.post(`/api/results/${gewaehlt.id}/release`, { reason: begruendung.trim() || undefined });
      setMeldung('Das Ergebnis ist freigegeben.');
      await oeffnen(gewaehlt.id);
      await laden();
    } catch (error) {
      setFehler(messageOf(error, 'Die Freigabe ist nicht möglich'));
    } finally {
      setBusy(false);
    }
  }

  async function wiederherstellen(): Promise<void> {
    if (!gewaehlt) {
      return;
    }

    setBusy(true);
    setFehler(undefined);

    try {
      const neu = await api.post<Ergebnisstand>(`/api/results/${gewaehlt.id}/restore`, {
        newRunId: new Date().toISOString(),
      });

      setMeldung(
        `Der Stand ist als neuer Ergebnisstand angelegt und wartet auf eine Freigabe. ` +
          `Der alte bleibt, wie er war - auch der, der dazwischen verworfen wurde.`
      );
      await laden();
      await oeffnen(neu.id);
    } catch (error) {
      setFehler(messageOf(error, 'Der Stand ließ sich nicht wiederherstellen'));
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

      <section className="card">
        <h2>Ergebnisstände</h2>
        <p className="muted">
          Jeder Lauf legt einen eigenen an. Keiner wird verändert und keiner gelöscht - auch der nicht, den jemand
          verworfen hat.
        </p>

        <Field label="Mandant">
          <Auswahlfeld value={mandant} onChange={(event) => setTenantId(event.target.value)}>
            {tenants.data.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Auswahlfeld>
        </Field>

        {!staende ? (
          <Loading />
        ) : staende.length === 0 ? (
          <Empty>Für diesen Mandanten gibt es noch keinen Ergebnisstand.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Lauf</th>
                  <th>Datensätze</th>
                  <th>Befunde</th>
                  <th>Status</th>
                  <th>Freigabe</th>
                  <th>Entstanden</th>
                </tr>
              </thead>
              <tbody>
                {staende.map((stand) => (
                  <tr
                    key={stand.id}
                    className={stand.id === gewaehlt?.id ? 'row--selected' : undefined}
                    onClick={() => void oeffnen(stand.id)}
                  >
                    <td>
                      {stand.laufId}
                      {stand.wiederhergestelltAus && <div className="muted">wiederhergestellt</div>}
                    </td>
                    <td>{stand.datensaetze ?? stand.zeilen?.length ?? 0}</td>
                    <td>{stand.pruefung.befunde.length === 0 ? <span className="muted">keine</span> : stand.pruefung.befunde.length}</td>
                    <td>{STATUS_LABELS[stand.status]}</td>
                    <td className="muted">
                      {stand.freigabe
                        ? stand.freigabe.art === 'AUTOMATISCH'
                          ? 'automatisch'
                          : (stand.freigabe.benutzerName ?? stand.freigabe.benutzer)
                        : '-'}
                    </td>
                    <td className="muted">{stand.entstanden}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gewaehlt && (
        <Stand
          stand={gewaehlt}
          begruendung={begruendung}
          busy={busy}
          onBegruendung={setBegruendung}
          onFreigeben={() => void freigeben()}
          onWiederherstellen={() => void wiederherstellen()}
        />
      )}
    </>
  );
}

function Stand({
  stand,
  begruendung,
  busy,
  onBegruendung,
  onFreigeben,
  onWiederherstellen,
}: {
  stand: Ergebnisstand;
  begruendung: string;
  busy: boolean;
  onBegruendung(wert: string): void;
  onFreigeben(): void;
  onWiederherstellen(): void;
}) {
  const wartet = stand.status === 'WAITING_FOR_RELEASE';
  const zahlen = stand.pruefung.zahlen;

  return (
    <>
      <section className="card">
        <h2>Lauf {stand.laufId}</h2>

        {wartet ? (
          <Notice kind="warn">
            Dieses Ergebnis ist <strong>nicht freigegeben</strong> und damit kein gültiges Ergebnis. Es darf nicht
            übernommen werden, solange niemand entschieden hat.
          </Notice>
        ) : (
          <Notice kind="info">
            {STATUS_LABELS[stand.status]} ·{' '}
            {stand.freigabe?.art === 'AUTOMATISCH'
              ? 'Unikom hat selbst freigegeben, weil nichts dagegen sprach.'
              : `Freigegeben von ${stand.freigabe?.benutzerName ?? stand.freigabe?.benutzer}.`}
          </Notice>
        )}

        <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
          <Kennzahl name="Eingang" wert={zahlen.eingang} />
          <Kennzahl name="Ergebnis" wert={zahlen.ergebnis} />
          <Kennzahl name="Felder" wert={zahlen.felder} />
          <Kennzahl name="Zurückgetreten" wert={zahlen.zurueckgestellt} />
          <Kennzahl name="Nicht verarbeitet" wert={zahlen.nichtVerarbeitet} schlecht={zahlen.nichtVerarbeitet > 0} />
          <Kennzahl name="Fehler" wert={stand.pruefung.zusammenfassung.FEHLER} schlecht={stand.pruefung.blockiert} />
          <Kennzahl name="Konflikte" wert={stand.pruefung.zusammenfassung.KONFLIKT} />
          <Kennzahl name="Warnungen" wert={stand.pruefung.zusammenfassung.WARNUNG} />
        </div>

        {stand.ausLauf && (
          <p className="muted">
            Setzt auf Lauf {stand.ausLauf} auf
            {stand.wiederhergestelltAus && ' und ist die Wiederherstellung eines früheren Standes'}.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Prüfung des Ergebnisses</h2>

        {stand.pruefung.sauber ? (
          <Notice kind="info">
            Die Prüfung hat nichts gefunden: Vollständigkeit, Anzahl, Duplikate, Pflichtwerte, Datentypen, Zielstruktur,
            Referenzen, Abhängigkeiten und der Vergleich mit dem Eingang. Für ein sauberes Ergebnis genügt diese Zeile.
          </Notice>
        ) : (
          stand.pruefung.befunde.map((befund, stelle) => <Befund key={stelle} befund={befund} />)
        )}
      </section>

      {stand.freigabe && (
        <section className="card">
          <h2>Freigabevermerk</h2>
          <p className="muted">
            {stand.freigabe.zeitpunkt} ·{' '}
            {stand.freigabe.art === 'AUTOMATISCH'
              ? 'automatisch, ohne Benutzer'
              : `von ${stand.freigabe.benutzerName ?? stand.freigabe.benutzer}`}
          </p>

          {stand.freigabe.begruendung && (
            <Notice kind="warn">Über offene Punkte hinweg freigegeben: {stand.freigabe.begruendung}</Notice>
          )}

          <table className="table table--compact">
            <thead>
              <tr>
                <th>Bedingung</th>
                <th>Erfüllt</th>
                <th>Befund</th>
              </tr>
            </thead>
            <tbody>
              {stand.freigabe.bedingungen.map((bedingung) => (
                <tr key={bedingung.name}>
                  <td>{bedingung.name}</td>
                  <td>{bedingung.erfuellt ? 'ja' : 'nein'}</td>
                  <td className="muted">{bedingung.aussage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Was jetzt?</h2>

        {wartet ? (
          <>
            <p className="muted">
              {stand.pruefung.blockiert
                ? 'Die Prüfung hat einen blockierenden Fehler gefunden. Dieses Ergebnis lässt sich nicht freigeben - ' +
                  'nicht einmal mit einer Begründung, weil niemand sagen könnte, was genau freigegeben würde.'
                : 'Wer über die offenen Punkte hinweggeht, sagt warum. Der Satz steht danach im Vermerk.'}
            </p>

            {!stand.pruefung.blockiert && (
              <Field label="Begründung" explain="Nötig, wenn etwas gegen die Freigabe spricht.">
                <input
                  value={begruendung}
                  placeholder="Mit dem Kunden geklärt"
                  onChange={(event) => onBegruendung(event.target.value)}
                />
              </Field>
            )}

            <button disabled={busy || stand.pruefung.blockiert} onClick={onFreigeben}>
              Ergebnis freigeben
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Dieses Ergebnis gilt. Es lässt sich als Ausgangspunkt wiederherstellen - dabei entsteht ein neuer Stand,
              und der jetzige bleibt unverändert stehen.
            </p>
            <button className="secondary" disabled={busy} onClick={onWiederherstellen}>
              Diesen Stand wiederherstellen
            </button>
          </>
        )}
      </section>

      {stand.zeilen && stand.zeilen.length > 0 && (
        <section className="card">
          <h2>Ergebnis</h2>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  {stand.felder.map((feld) => (
                    <th key={feld}>{feld}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stand.zeilen.slice(0, 50).map((zeile, stelle) => (
                  <tr key={stelle}>
                    {zeile.map((wert, spalte) => (
                      <td key={spalte}>{wert === '' ? <span className="muted">-</span> : wert}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stand.zeilen.length > 50 && (
            <p className="muted">Die ersten 50 von {stand.zeilen.length} Datensätzen.</p>
          )}
        </section>
      )}
    </>
  );
}

function Befund({ befund }: { befund: Pruefbefund }) {
  return (
    <div className="card card--inner">
      <div className="row row--between">
        <strong>
          {PRUEFART_LABELS[befund.art]}
          {befund.feld && ` · ${befund.feld}`}
        </strong>
        <span className="muted">{befund.schwere.toLowerCase()}</span>
      </div>

      <Notice kind={SCHWERE_TON[befund.schwere]}>
        {befund.ursache} - {befund.auswirkung}
      </Notice>

      {befund.beispiele && befund.beispiele.length > 0 && (
        <p className="muted">Beispiele: {befund.beispiele.join(', ')}</p>
      )}
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
