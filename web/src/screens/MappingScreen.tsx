import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Mappingliste, Mappingregel, Tenant } from '../api/types.js';
import { Empty, Field, formatMoment, Loading, Notice, RowButton, TrashIcon } from '../components/Pieces.js';

/**
 * Die Mapping-Verwaltung (SPEC-02, Abschnitt 19).
 *
 * „Das automatische Lernen muss für den Benutzer transparent und kontrollierbar
 * sein." Transparent heißt hier: Jede Zeile sagt, woher sie kommt, wie oft sie
 * bestätigt wurde und ob sie gerade wirkt. Kontrollierbar heißt: Sie lässt sich
 * zurücknehmen — und wieder in Kraft setzen.
 *
 * Zurückgenommenes wird nicht ausgeblendet. Wer wissen will, warum ein Lauf vom
 * März etwas zugeordnet hat, das heute niemand mehr zuordnet, findet die
 * Antwort sonst nirgends.
 */

const ART_LABELS: Record<string, string> = { WERT: 'Wert', FELD: 'Feld' };

const EBENE_LABELS: Record<string, string> = {
  ALLGEMEIN: 'Allgemein',
  PROFIL: 'Profil',
  MANDANT: 'Mandant',
};

const HERKUNFT_LABELS: Record<string, string> = {
  AUSGELIEFERT: 'ausgeliefert',
  BENUTZER: 'von Hand',
  GELERNT: 'gelernt',
};

/** Ein Pfeil — für „wird zu". */
function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h14M13 7l5 5-5 5" />
    </svg>
  );
}

function Zustand({ regel }: { regel: Mappingregel }) {
  if (regel.zurueckgenommen) {
    return <span className="badge badge--muted">zurückgenommen</span>;
  }

  if (regel.vorlaeufig) {
    return (
      <span className="badge badge--warn" title="Einmal beobachtet — wirkt noch nicht">
        vorgemerkt
      </span>
    );
  }

  if (!regel.wirkt) {
    return (
      <span className="badge badge--warn" title="Ein Feldmapping wirkt erst mit ausdrücklicher Bestätigung">
        wartet auf Bestätigung
      </span>
    );
  }

  return <span className="badge badge--good">wirkt</span>;
}

export function MappingScreen() {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [tenantId, setTenantId] = useState('');
  const [art, setArt] = useState('');
  const [suche, setSuche] = useState('');
  const [meldung, setMeldung] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  const mandant = tenantId || tenants.data?.[0]?.id;
  const abfrage = mandant
    ? `/api/mappings?tenantId=${encodeURIComponent(mandant)}` +
      (art ? `&art=${art}` : '') +
      (suche.trim() ? `&q=${encodeURIComponent(suche.trim())}` : '')
    : undefined;

  const liste = useResource<Mappingliste>(abfrage);

  if (tenants.error || liste.error) {
    return <Notice kind="error">{tenants.error ?? liste.error}</Notice>;
  }

  if (!tenants.data || !liste.data) {
    return <Loading />;
  }

  async function schalte(regel: Mappingregel): Promise<void> {
    setBusy(true);
    setMeldung(undefined);

    try {
      await api.post(`/api/mappings/${regel.id}/${regel.zurueckgenommen ? 'restore' : 'withdraw'}`);
      await liste.reload();
      setMeldung({
        kind: 'info',
        text: regel.zurueckgenommen
          ? `„${regel.von}" → „${regel.nach}" gilt wieder.`
          : `„${regel.von}" → „${regel.nach}" wirkt nicht mehr. Die Regel bleibt im Bestand, damit vergangene Läufe erklärbar bleiben.`,
      });
    } catch (fehler) {
      setMeldung({ kind: 'error', text: messageOf(fehler, 'Die Änderung war nicht möglich') });
    } finally {
      setBusy(false);
    }
  }

  const regeln = liste.data.regeln;

  return (
    <>
      {meldung && <Notice kind={meldung.kind}>{meldung.text}</Notice>}

      <section className="card">
        <h2>Was Unikom zuordnet</h2>

        <div className="prose">
          <p>
            <strong>Wertmappings</strong> ordnen einem Wert seinen fachlichen Wert zu — „FFm" wird „Frankfurt am
            Main". Unikom lernt sie selbst und wendet sie ohne Freigabe an; sie treffen einen Wert, den man im
            Datensatz sieht.
          </p>
          <p>
            <strong>Feldmappings</strong> ordnen eine Spalte einem internen Feld zu — „Kunden-Nr." wird
            „Kundennummer". Sie wirken <strong>erst mit Ihrer Bestätigung</strong>: Ein falsches Feldmapping leitet
            eine ganze Spalte still ins falsche Zielfeld, und das fällt auf, wenn die Daten längst woanders sind.
          </p>
        </div>

        <div className="filters">
          <div className="filters__field">
            <Field label="Mandant">
              <select value={mandant} onChange={(event) => setTenantId(event.target.value)}>
                {tenants.data.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="filters__field">
            <Field label="Art">
              <select value={art} onChange={(event) => setArt(event.target.value)}>
                <option value="">Alle</option>
                <option value="WERT">Wertmappings</option>
                <option value="FELD">Feldmappings</option>
              </select>
            </Field>
          </div>
          <div className="filters__field">
            <Field label="Suchen">
              <input value={suche} placeholder="FFm" onChange={(event) => setSuche(event.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      {regeln.length === 0 ? (
        <Empty>
          Für diesen Mandanten ist noch nichts zugeordnet. Wertmappings entstehen beim Verarbeiten von selbst;
          Feldmappings entstehen dort, wo Sie eine erkannte Zuordnung bestätigen.
        </Empty>
      ) : (
        <section className="card">
          <h2>
            {regeln.length} Regel(n) — {regeln.filter((regel) => regel.wirkt).length} davon in Kraft
          </h2>

          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Art</th>
                  <th>Zuordnung</th>
                  <th>Feld</th>
                  <th>Ebene</th>
                  <th>Herkunft</th>
                  <th className="numeric">Bestätigt</th>
                  <th>Zustand</th>
                  <th>Seit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {regeln.map((regel) => (
                  <tr key={regel.id}>
                    <td>{ART_LABELS[regel.art] ?? regel.art}</td>
                    <td>
                      {regel.von} <ArrowIcon /> <strong>{regel.nach}</strong>
                    </td>
                    <td>{regel.feld ?? <span className="muted">alle</span>}</td>
                    <td>{EBENE_LABELS[regel.ebene] ?? regel.ebene}</td>
                    <td>
                      {HERKUNFT_LABELS[regel.herkunft] ?? regel.herkunft}
                      {regel.erstelltVonName && <div className="cell__sub">{regel.erstelltVonName}</div>}
                    </td>
                    <td className="numeric">{regel.bestaetigungen}</td>
                    <td>
                      <Zustand regel={regel} />
                    </td>
                    <td className="muted">{formatMoment(regel.erstellt)}</td>
                    <td>
                      <div className="row-actions">
                        <RowButton
                          title={
                            regel.zurueckgenommen
                              ? 'Wieder in Kraft setzen'
                              : 'Zurücknehmen — die Regel bleibt im Bestand und wirkt nicht mehr'
                          }
                          tone={regel.zurueckgenommen ? undefined : 'bad'}
                          disabled={busy}
                          onClick={() => void schalte(regel)}
                        >
                          {regel.zurueckgenommen ? <ArrowIcon /> : <TrashIcon />}
                        </RowButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted">
            Zurückgenommene Regeln bleiben stehen und werden nicht gelöscht — sonst ließe sich später nicht mehr
            erklären, warum ein alter Lauf etwas zugeordnet hat.
          </p>
        </section>
      )}
    </>
  );
}
