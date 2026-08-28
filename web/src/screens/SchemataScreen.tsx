import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type {
  Eingangsprofil,
  Feldtyp,
  Pruefung,
  Qualitaetsregel,
  Schluessel,
  Schwere,
  Spaltenvorgabe,
  Strukturvorgabe,
  Tenant,
  Verbindlichkeit,
} from '../api/types.js';
import {
  Empty,
  Field,
  FieldButton,
  Hint,
  Loading,
  Modal,
  Notice,
  PlusIcon,
  Reiter,
  RowButton,
  TrashIcon,
  formatMoment,
} from '../components/Pieces.js';
import { LOCALES } from './regions.js';

/**
 * Schemata eines Mandanten — die Eingangsprofile mit einer Oberfläche.
 *
 * ## Warum es diesen Bildschirm gibt
 *
 * Hier stand einmal eine **JSON-Schema-Datei**: Wer festlegen wollte, welche
 * Werte gültig sind, sollte `{"type":"object","required":[…]}` von Hand
 * schreiben und den Pfad dazu in den Workflow eintragen. Das macht niemand —
 * und wer es täte, bekäme für die Hälfte der Schlüsselwörter nur die Meldung,
 * dass Unikom sie nicht prüft.
 *
 * Alles, was dafür nötig ist, gab es längst: Eingangsprofile am Mandanten,
 * versioniert und unveränderlich, und eine Regelmaschine, die mehr kann als ein
 * JSON Schema — vier Schweregrade statt zwei, Ursache und Auswirkung in Worten,
 * und Bedingungen über mehrere Felder. Beides war gebaut, getestet und
 * **unerreichbar**. Das ist die Stelle, an der man hinkommt.
 *
 * ## Ein Schema entsteht aus Beispieldaten
 *
 * Angelegt wird ein Profil weiterhin dort, wo Beispieldaten gelesen und ihre
 * Struktur erkannt wird: unter **Daten konsolidieren › Daten finden**. Ein Profil
 * entsteht daraus, dass ein Mensch eine erkannte Struktur **bestätigt**, und
 * nicht daraus, dass er sie tippt. Hier wird nachgearbeitet: benennen,
 * einschränken, Regeln geben.
 *
 * Der Weg dorthin stand hier lange nicht dabei — und „aus einer Beispieldatei"
 * schickte jemanden eine Dateiauswahl suchen, die es nicht gab. Beides ist
 * behoben: Der Ort steht jetzt da, und die Datei gibt es.
 *
 * ## Fünf Reiter und nicht fünf Klappflächen
 *
 * Man arbeitet immer an genau einer Gruppe. Untereinander läge der Reiter
 * „Spalten" unter dreißig Zeilen anderer Einstellungen.
 */
type Blatt = 'allgemein' | 'aufbau' | 'spalten' | 'werte' | 'schluessel';

const BLAETTER: readonly { id: Blatt; text: string }[] = [
  { id: 'allgemein', text: 'Allgemein' },
  { id: 'aufbau', text: 'Aufbau' },
  { id: 'spalten', text: 'Spalten' },
  { id: 'werte', text: 'Werte' },
  { id: 'schluessel', text: 'Schlüssel' },
];

const VERBINDLICHKEITEN: readonly { wert: Verbindlichkeit; text: string; erklaerung: string }[] = [
  { wert: 'HINWEIS', text: 'Hinweis', erklaerung: 'Die Daten dürfen widersprechen, wenn sie eindeutig sind.' },
  {
    wert: 'EINSCHRAENKUNG',
    text: 'Einschränkung',
    erklaerung: 'Was dagegen verstößt, ist kein gültiger Datenblock.',
  },
  { wert: 'VORGABE', text: 'Vorgabe', erklaerung: 'Es gilt, was hier steht; eine Abweichung ist ein Konflikt.' },
];

const TYPEN: readonly Feldtyp[] = ['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'TIME'];

const SCHWEREGRADE: readonly { wert: Schwere; text: string }[] = [
  { wert: 'INFO', text: 'Info — fällt auf, ändert nichts' },
  { wert: 'WARNUNG', text: 'Warnung — ungewöhnlich, aber möglich' },
  { wert: 'KONFLIKT', text: 'Konflikt — dieser Datensatz geht an einen Menschen' },
  { wert: 'FEHLER', text: 'Fehler — hier ist nichts sicher zu verarbeiten' },
];

const PRUEFARTEN: readonly { wert: Pruefung['art']; text: string }[] = [
  { wert: 'PFLICHT', text: 'Darf nicht leer sein' },
  { wert: 'FORMAT', text: 'Muss einem Muster entsprechen' },
  { wert: 'BEREICH', text: 'Muss in einem Zahlenbereich liegen' },
  { wert: 'AUS_LISTE', text: 'Muss aus einer Liste stammen' },
  { wert: 'NICHT_ZUKUNFT', text: 'Darf nicht in der Zukunft liegen' },
];

/** Die vier Faltungen des Vergleichs — mehr gibt es nicht. */
const FALTUNGEN: readonly { name: keyof NonNullable<Schluessel['vergleich']>; text: string }[] = [
  { name: 'grossKleinEgal', text: '„Müller" und „müller" sind derselbe Wert' },
  { name: 'leerzeichenEgal', text: 'Leerzeichen am Rand und mehrfache im Inneren zählen nicht' },
  { name: 'umlauteEgal', text: '„Müller" und „Mueller" sind derselbe Wert' },
  { name: 'satzzeichenEgal', text: 'Punkt, Komma und Bindestrich fallen fort' },
];

export function SchemataScreen() {
  const tenants = useResource<Tenant[]>('/api/tenants');
  const [tenantId, setTenantId] = useState<string>();
  const mandant = tenantId ?? tenants.data?.[0]?.id;

  const profile = useResource<Eingangsprofil[]>(
    mandant ? `/api/profiles?tenantId=${encodeURIComponent(mandant)}` : undefined
  );

  const [offen, setOffen] = useState<string>();
  const [fehler, setFehler] = useState<string>();
  const [meldung, setMeldung] = useState<string>();
  const [frage, setFrage] = useState<{ text: string; tun(): void }>();

  const gewaehlt = profile.data?.find((eines) => eines.id === offen);

  async function entfernen(profil: Eingangsprofil): Promise<void> {
    setFehler(undefined);

    try {
      await api.delete(`/api/profiles/${profil.id}`);
      setOffen(undefined);
      setMeldung(`„${profil.name}" ist entfernt.`);
      profile.reload();
    } catch (error) {
      setFehler(messageOf(error, 'Das Schema ließ sich nicht entfernen'));
    }
  }

  if (tenants.error) {
    return <Notice kind="error">{tenants.error}</Notice>;
  }

  if (!tenants.data || !mandant) {
    return <Loading />;
  }

  return (
    <>
      {fehler && <Notice kind="error">{fehler}</Notice>}
      {meldung && <Notice kind="info">{meldung}</Notice>}

      <section className="card">
        <h2>Schemata</h2>

        <p className="muted">
          Was Unikom über eine Eingangsquelle schon weiß: welche Spalten kommen, wie sie zu lesen sind, was ein
          gültiger Wert ist und woran ein Datensatz zu erkennen ist. Ein Schema gehört zum{' '}
          <strong>Mandanten</strong> und nicht zu einem einzelnen Workflow — dieselbe Quelle liefert für mehrere.
        </p>

        <p className="muted">
          Angelegt wird ein Schema aus <strong>Beispieldaten</strong> — eingefügt oder aus einer Datei auf dem
          Server. Unikom erkennt Aufbau und Typen, ein Mensch bestätigt sie. Das geschieht unter{' '}
          <strong>Daten konsolidieren › Daten finden</strong>; hier wird nachgearbeitet.
        </p>

        <div className="row">
          <Field label="Mandant">
            <select
              value={mandant}
              onChange={(event) => {
                setTenantId(event.target.value);
                setOffen(undefined);
              }}
            >
              {tenants.data.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {profile.error && <Notice kind="warn">{profile.error}</Notice>}

        {profile.data && profile.data.length === 0 && (
          <Empty>
            Für diesen Mandanten gibt es noch kein Schema. Eines entsteht unter{' '}
            <strong>Daten konsolidieren › Daten finden</strong>: Beispieldaten einfügen oder eine Datei auf dem
            Server aussuchen, erkennen lassen, bestätigen.
          </Empty>
        )}

        {profile.data && profile.data.length > 0 && (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Spalten</th>
                  <th>Regeln</th>
                  <th>Version</th>
                  <th>Zuletzt geändert</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profile.data.map((profil) => (
                  <tr key={profil.id}>
                    <td>
                      <div>{profil.name}</div>
                      {profil.description && <div className="muted">{profil.description}</div>}
                    </td>
                    <td className="muted">{profil.vorgabe?.spalten?.length ?? 0}</td>
                    <td className="muted">{profil.regeln?.length ?? 0}</td>
                    <td className="muted">{profil.version}</td>
                    <td className="muted">{formatMoment(profil.updatedAt)}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setOffen(profil.id === offen ? undefined : profil.id)}
                        >
                          {profil.id === offen ? 'Schließen' : 'Bearbeiten'}
                        </button>

                        <RowButton
                          title={`„${profil.name}" entfernen`}
                          onClick={() =>
                            setFrage({
                              text: `„${profil.name}" mit allen Versionen entfernen?`,
                              tun: () => void entfernen(profil),
                            })
                          }
                        >
                          <TrashIcon />
                        </RowButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gewaehlt && (
        <Schemaeditor
          key={`${gewaehlt.id}-${gewaehlt.version}`}
          profil={gewaehlt}
          onFehler={setFehler}
          onGespeichert={(text) => {
            setMeldung(text);
            profile.reload();
          }}
        />
      )}

      {frage && (
        <Modal title="Nachfrage" tone="warn" ownActions onClose={() => setFrage(undefined)}>
          <p>{frage.text}</p>

          <div className="row modal__actions">
            <button
              onClick={() => {
                frage.tun();
                setFrage(undefined);
              }}
            >
              Ja
            </button>
            <button className="secondary" autoFocus onClick={() => setFrage(undefined)}>
              Nein
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Was am Schema bearbeitet wird — der Entwurf, bis jemand speichert. */
interface Entwurf {
  name: string;
  description: string;
  vorgabe: Strukturvorgabe;
  regeln: Qualitaetsregel[];
  schluessel?: Schluessel;
  einstellungen: Record<string, unknown>;
  notiz: string;
}

function Schemaeditor({
  profil,
  onFehler,
  onGespeichert,
}: {
  profil: Eingangsprofil;
  onFehler(text: string | undefined): void;
  onGespeichert(text: string): void;
}) {
  const [blatt, setBlatt] = useState<Blatt>('allgemein');
  const [busy, setBusy] = useState(false);

  /*
   * Der Entwurf steht über den Reitern und nicht in ihnen.
   *
   * Wer im Reiter „Spalten" etwas ändert, im Reiter „Werte" nachsieht und
   * zurückkommt, findet seine Änderung vor. Läge der Zustand in den Reitern,
   * wäre jeder Wechsel ein stilles Verwerfen.
   */
  const [entwurf, setEntwurf] = useState<Entwurf>(() => ({
    name: profil.name,
    description: profil.description ?? '',
    vorgabe: profil.vorgabe ?? { verbindlichkeit: 'HINWEIS' },
    regeln: profil.regeln ? [...profil.regeln] : [],
    schluessel: profil.schluessel,
    einstellungen: { ...profil.einstellungen },
    notiz: '',
  }));

  const setze = (teile: Partial<Entwurf>): void => setEntwurf((stand) => ({ ...stand, ...teile }));
  const setzeVorgabe = (teile: Partial<Strukturvorgabe>): void =>
    setEntwurf((stand) => ({ ...stand, vorgabe: { ...stand.vorgabe, ...teile } }));

  async function speichern(): Promise<void> {
    setBusy(true);
    onFehler(undefined);

    try {
      const antwort = await api.put<Eingangsprofil & { neueVersion: boolean }>(`/api/profiles/${profil.id}`, {
        name: entwurf.name,
        description: entwurf.description || undefined,
        vorgabe: entwurf.vorgabe,
        regeln: entwurf.regeln,
        schluessel: entwurf.schluessel,
        einstellungen: entwurf.einstellungen,
        notiz: entwurf.notiz || undefined,
      });

      /*
       * Ob eine Version entstanden ist, sagt der Server — nicht wir. Eine
       * Fortschreibung ohne Änderung erzeugt keine, und das zu verschweigen
       * hieße, eine Versionsnummer zu behaupten, die es nicht gibt.
       */
      onGespeichert(
        antwort.neueVersion
          ? `„${antwort.name}" ist als Version ${antwort.version} gespeichert.`
          : `„${antwort.name}" ist gespeichert. Am Inhalt hat sich nichts geändert, deshalb gibt es keine neue Version.`
      );
    } catch (error) {
      onFehler(messageOf(error, 'Das Schema ließ sich nicht speichern'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>{profil.name}</h3>

      <Reiter<Blatt> reiter={BLAETTER} offen={blatt} onOeffnen={setBlatt} />

      {blatt === 'allgemein' && <Allgemein entwurf={entwurf} onSetze={setze} profil={profil} />}
      {blatt === 'aufbau' && <Aufbau vorgabe={entwurf.vorgabe} onSetze={setzeVorgabe} />}
      {blatt === 'spalten' && (
        <Spalten
          vorgabe={entwurf.vorgabe}
          regeln={entwurf.regeln}
          onVorgabe={setzeVorgabe}
          onRegeln={(regeln) => setze({ regeln })}
        />
      )}
      {blatt === 'werte' && (
        <Werte einstellungen={entwurf.einstellungen} onSetze={(einstellungen) => setze({ einstellungen })} />
      )}
      {blatt === 'schluessel' && (
        <Schluesselblatt
          schluessel={entwurf.schluessel}
          spalten={entwurf.vorgabe.spalten ?? []}
          onSetze={(schluessel) => setze({ schluessel })}
        />
      )}

      <Field
        label="Notiz zu dieser Änderung"
        explain="Der Satz, den man später sucht: warum es diese Version gibt. Er steht in der Versionsliste."
      >
        <input
          value={entwurf.notiz}
          placeholder="Lieferant schreibt seit Mai eine Spalte mehr"
          onChange={(event) => setze({ notiz: event.target.value })}
        />
      </Field>

      <div className="row">
        <button disabled={busy} onClick={() => void speichern()}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
      </div>
    </section>
  );
}

/* ---------- Reiter 1: Allgemein ---------- */

function Allgemein({
  entwurf,
  onSetze,
  profil,
}: {
  entwurf: Entwurf;
  onSetze(teile: Partial<Entwurf>): void;
  profil: Eingangsprofil;
}) {
  return (
    <>
      <Field label="Name" explain={'Wie der Mensch die Quelle nennt: „Bestellung Müller GmbH".'}>
        <input value={entwurf.name} onChange={(event) => onSetze({ name: event.target.value })} />
      </Field>

      <Field label="Beschreibung">
        <input
          value={entwurf.description}
          placeholder="Wöchentliche Lieferung, kommt per SFTP"
          onChange={(event) => onSetze({ description: event.target.value })}
        />
      </Field>

      <Field
        label="Verbindlichkeit"
        explain={
          <>
            <p>Was geschieht, wenn eine Lieferung von dem abweicht, was hier steht.</p>
            {VERBINDLICHKEITEN.map((eine) => (
              <p key={eine.wert}>
                <strong>{eine.text}:</strong> {eine.erklaerung}
              </p>
            ))}
            <p>
              Eine hinterlegte Struktur ersetzt die Erkennung nicht, sie tritt neben sie. Wo beide dasselbe sagen,
              ist die Sache sicher; wo sie sich widersprechen, wird der Widerspruch gezeigt.
            </p>
          </>
        }
      >
        <select
          className="input--wahl"
          value={entwurf.vorgabe.verbindlichkeit}
          onChange={(event) =>
            onSetze({
              vorgabe: { ...entwurf.vorgabe, verbindlichkeit: event.target.value as Verbindlichkeit },
            })
          }
        >
          {VERBINDLICHKEITEN.map((eine) => (
            <option key={eine.wert} value={eine.wert}>
              {eine.text}
            </option>
          ))}
        </select>
      </Field>

      {/*
        * Die Versionskette, nicht nur die aktuelle Fassung.
        *
        * Wer wissen will, warum ein Lauf vom März anders gelesen hat als einer
        * vom Mai, findet die Antwort hier — und nicht in einem Protokoll, das
        * längst gelöscht ist. Alte Versionen sind eingefroren; sie stehen da,
        * weil Läufe auf sie zeigen.
        */}
      <div className="field">
        <label>Versionen</label>

        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Version</th>
                <th>Entstanden</th>
                <th>Von</th>
                <th>Notiz</th>
                <th>Spalten</th>
              </tr>
            </thead>
            <tbody>
              {[...profil.versionen].reverse().map((version) => (
                <tr key={version.version}>
                  <td>{version.version}</td>
                  <td className="muted">{formatMoment(version.erstellt)}</td>
                  <td className="muted">{version.erstelltVonName ?? '—'}</td>
                  <td className="muted">{version.notiz ?? '—'}</td>
                  <td className="muted">{version.spalten}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------- Reiter 2: Aufbau ---------- */

function Aufbau({
  vorgabe,
  onSetze,
}: {
  vorgabe: Strukturvorgabe;
  onSetze(teile: Partial<Strukturvorgabe>): void;
}) {
  return (
    <>
      <Field
        label="Erwartete Spaltenzahl"
        explain="Leer heißt: so viele, wie die Erkennung findet. Eine Zahl hier ist eine Aussage über die Quelle — weicht eine Lieferung ab, fällt es auf."
      >
        <input
          type="number"
          min={1}
          value={vorgabe.columns ?? ''}
          onChange={(event) => onSetze({ columns: zahlOderNichts(event.target.value) })}
        />
      </Field>

      <Field
        label="Mindestspaltenzahl"
        explain="Für den Fall, dass hinten Spalten dazukommen dürfen, vorne aber nichts fehlen darf."
      >
        <input
          type="number"
          min={1}
          value={vorgabe.minColumns ?? ''}
          onChange={(event) => onSetze({ minColumns: zahlOderNichts(event.target.value) })}
        />
      </Field>

      <Field
        label="Der Datenblock beginnt nach"
        explain={
          <>
            <p>
              Eine Zeile, die diesen Text enthält, ist die letzte vor den Daten — die Kopfzeile also. Alles davor
              ist Vorspann und kommt nicht mit.
            </p>
            <p>
              Gebraucht, wo über den Daten ein Briefkopf steht, eine Leerzeile und zwei Sätze Erläuterung. Die
              Erkennung findet den Block meist von selbst; hier steht die Antwort für den Fall, dass sie es nicht
              tut.
            </p>
          </>
        }
      >
        <input
          className="input--mittel"
          value={vorgabe.beginntNach ?? ''}
          placeholder="Artikelnummer"
          onChange={(event) => onSetze({ beginntNach: event.target.value || undefined })}
        />
      </Field>
    </>
  );
}

/* ---------- Reiter 3: Spalten ---------- */

function Spalten({
  vorgabe,
  regeln,
  onVorgabe,
  onRegeln,
}: {
  vorgabe: Strukturvorgabe;
  regeln: Qualitaetsregel[];
  onVorgabe(teile: Partial<Strukturvorgabe>): void;
  onRegeln(regeln: Qualitaetsregel[]): void;
}) {
  const spalten = vorgabe.spalten ?? [];
  const [neueRegel, setNeueRegel] = useState<{ feld: string }>();

  const setzeSpalte = (stelle: number, teile: Partial<Spaltenvorgabe>): void =>
    onVorgabe({ spalten: spalten.map((eine, i) => (i === stelle ? { ...eine, ...teile } : eine)) });

  return (
    <>
      <p className="muted">
        Was in dieser Quelle steht — und was ein gültiger Wert ist. Die Regeln hängen am{' '}
        <strong>Spaltennamen</strong>: So bleiben Struktur und Werte zwei Fragen, und eine umbenannte Spalte nimmt
        ihre Regeln nicht versehentlich mit.
      </p>

      {/*
        * Der Fall, den eine Lieferung ohne Kopfzeile erzeugt.
        *
        * Die Erkennung nimmt Spaltennamen aus der Zeile über den Daten. Gibt es
        * keine, sind alle Spalten namenlos — und dann steht hier eine Tabelle mit
        * fünf leeren Namensfeldern und fünf abgeblendeten Knopfen, ohne dass zu
        * sehen wäre, warum. Der Satz sagt es, und er sagt es nur dort, wo es
        * zutrifft.
        *
        * Er ist auch die Anleitung für den Lauf: Was hier eingetragen wird, legt
        * Unikom später über jede Lieferung, die selbst keine Kopfzeile mitbringt.
        * Ohne diese Namen prüft eine Regel für „kdnr" stillschweigend nichts.
        */}
      {spalten.length > 0 && spalten.some((spalte) => !spalte.name) && (
        <p className="muted">
          Einige Spalten haben <strong>keinen Namen</strong>: Die Beispieldaten trugen keine Kopfzeile, und geraten
          wird sie nicht. Tragen Sie die Namen hier ein — erst dann lassen sich Regeln daran hängen, und der Lauf
          legt sie über jede Lieferung, die selbst keine Kopfzeile mitbringt.
        </p>
      )}

      {spalten.length === 0 && (
        <Empty>
          Dieses Schema kennt noch keine Spalten. Sie entstehen bei der Erkennung unter{' '}
          <strong>Daten konsolidieren › Daten finden</strong>.
        </Empty>
      )}

      {spalten.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Stelle</th>
                <th>Name</th>
                <th>Typ</th>
                <th>Regeln</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spalten.map((spalte, stelle) => {
                const dazu = regeln.filter((regel) => regel.feld === spalte.name);

                return (
                  <tr key={spalte.position}>
                    <td className="muted">{spalte.position}</td>
                    <td>
                      <input
                        className="input--mittel"
                        value={spalte.name ?? ''}
                        placeholder="ohne Namen"
                        onChange={(event) => setzeSpalte(stelle, { name: event.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <select
                        className="input--wahl"
                        value={spalte.type ?? ''}
                        onChange={(event) =>
                          setzeSpalte(stelle, { type: (event.target.value || undefined) as Feldtyp | undefined })
                        }
                      >
                        <option value="">nicht festgelegt</option>
                        {TYPEN.map((typ) => (
                          <option key={typ} value={typ}>
                            {typ}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {dazu.length === 0 && <span className="muted">keine</span>}

                      {dazu.map((regel) => (
                        <div key={regel.id} className="row">
                          <span>{regel.name}</span>
                          <RowButton
                            title={`Regel „${regel.name}" entfernen`}
                            onClick={() => onRegeln(regeln.filter((eine) => eine.id !== regel.id))}
                          >
                            <TrashIcon />
                          </RowButton>
                        </div>
                      ))}
                    </td>
                    <td>
                      <FieldButton
                        title="Regel für diese Spalte"
                        disabled={!spalte.name}
                        onClick={() => setNeueRegel({ feld: spalte.name as string })}
                      >
                        <PlusIcon />
                      </FieldButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {neueRegel && (
        <Regelfenster
          feld={neueRegel.feld}
          vorhanden={regeln}
          onFertig={(regel) => {
            onRegeln([...regeln, regel]);
            setNeueRegel(undefined);
          }}
          onClose={() => setNeueRegel(undefined)}
        />
      )}
    </>
  );
}

/**
 * Eine Regel anlegen.
 *
 * Sie ersetzt, was in einer JSON-Schema-Datei `required`, `pattern`, `minimum`
 * und `enum` hieß — und kann zwei Dinge mehr, an denen ein JSON Schema
 * scheitert: einen **Schweregrad**, der nicht alles gleich anhält, und eine
 * **Bedingung** über ein anderes Feld.
 */
function Regelfenster({
  feld,
  vorhanden,
  onFertig,
  onClose,
}: {
  feld: string;
  vorhanden: readonly Qualitaetsregel[];
  onFertig(regel: Qualitaetsregel): void;
  onClose(): void;
}) {
  const [art, setArt] = useState<Pruefung['art']>('PFLICHT');
  const [name, setName] = useState(`${feld} darf nicht leer sein`);
  const [schwere, setSchwere] = useState<Schwere>('KONFLIKT');
  const [muster, setMuster] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [werte, setWerte] = useState('');
  const [wennFeld, setWennFeld] = useState('');
  const [wennIst, setWennIst] = useState('');

  /*
   * Der Name folgt der Prüfart, solange niemand ihn angefasst hat. Ein leeres
   * Namensfeld über einem Formular, das den Namen schon kennt, ist eine Frage,
   * die sich selbst beantworten könnte.
   */
  const [selbstBenannt, setSelbstBenannt] = useState(false);

  useEffect(() => {
    if (!selbstBenannt) {
      setName(`${feld}: ${PRUEFARTEN.find((eine) => eine.wert === art)?.text.toLowerCase()}`);
    }
  }, [art, feld, selbstBenannt]);

  function anlegen(): void {
    onFertig({
      id: kennung(feld, art, vorhanden),
      name,
      feld,
      schwere,
      pruefung: pruefungAus(art, { muster, beschreibung, min, max, werte }),
      wenn: wennFeld && wennIst ? { feld: wennFeld, ist: wennIst } : undefined,
    });
  }

  const vollstaendig =
    name.trim() !== '' &&
    (art !== 'FORMAT' || (muster.trim() !== '' && beschreibung.trim() !== '')) &&
    (art !== 'BEREICH' || min.trim() !== '' || max.trim() !== '') &&
    (art !== 'AUS_LISTE' || werte.trim() !== '');

  return (
    <Modal title={`Regel für „${feld}"`} ownActions onClose={onClose}>
      <Field label="Was geprüft wird">
        <select className="input--wahl" value={art} onChange={(event) => setArt(event.target.value as Pruefung['art'])}>
          {PRUEFARTEN.map((eine) => (
            <option key={eine.wert} value={eine.wert}>
              {eine.text}
            </option>
          ))}
        </select>
      </Field>

      {art === 'FORMAT' && (
        <>
          <Field label="Muster" explain="Ein regulärer Ausdruck. Er wird sofort geprüft — ein unlesbares Muster wird hier abgewiesen und nicht erst im Nachtlauf.">
            <input
              value={muster}
              placeholder="^[0-9]{5}$"
              spellCheck={false}
              onChange={(event) => setMuster(event.target.value)}
            />
          </Field>

          <Field
            label="Beschreibung des Musters"
            explain="Was der Benutzer im Befund liest. Ohne sie stünde dort ein regulärer Ausdruck."
          >
            <input
              value={beschreibung}
              placeholder="fünf Ziffern, ohne Leerzeichen"
              onChange={(event) => setBeschreibung(event.target.value)}
            />
          </Field>
        </>
      )}

      {art === 'BEREICH' && (
        <div className="row">
          <Field label="Kleinstwert">
            <input type="number" value={min} onChange={(event) => setMin(event.target.value)} />
          </Field>

          <Field label="Größtwert">
            <input type="number" value={max} onChange={(event) => setMax(event.target.value)} />
          </Field>
        </div>
      )}

      {art === 'AUS_LISTE' && (
        <Field label="Erlaubte Werte" explain="Durch Komma getrennt.">
          <input value={werte} placeholder="EUR, CHF, USD" onChange={(event) => setWerte(event.target.value)} />
        </Field>
      )}

      <Field
        label="Schweregrad"
        explain="Nicht jede Auffälligkeit hält eine Verarbeitung auf. Blockiert werden darf nur, wo eine sichere Verarbeitung nicht möglich ist."
      >
        <select className="input--wahl" value={schwere} onChange={(event) => setSchwere(event.target.value as Schwere)}>
          {SCHWEREGRADE.map((eine) => (
            <option key={eine.wert} value={eine.wert}>
              {eine.text}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Name der Regel"
        explain="Der Satz, den ein Mensch im Befund liest. Er folgt der Prüfart, bis Sie ihn ändern."
      >
        <input
          value={name}
          onChange={(event) => {
            setSelbstBenannt(true);
            setName(event.target.value);
          }}
        />
      </Field>

      {/*
        * Die Bedingung, an der ein JSON Schema scheitert.
        *
        * `WENN Zahlungsart = Lastschrift DANN IBAN` braucht dort `if/then` —
        * und genau das hat Unikoms JSON-Prüfung nie geprüft, sondern nur
        * gemeldet, dass sie es nicht kann.
        */}
      <div className="row">
        <Field label="Nur wenn Feld" explain="Leer heißt: die Regel gilt immer.">
          <input
            className="input--mittel"
            value={wennFeld}
            placeholder="Zahlungsart"
            onChange={(event) => setWennFeld(event.target.value)}
          />
        </Field>

        <Field label="diesen Wert hat">
          <input
            className="input--mittel"
            value={wennIst}
            placeholder="Lastschrift"
            onChange={(event) => setWennIst(event.target.value)}
          />
        </Field>
      </div>

      <div className="row modal__actions">
        <button disabled={!vollstaendig} onClick={anlegen}>
          Übernehmen
        </button>
        <button className="secondary" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Reiter 4: Werte ---------- */

function Werte({
  einstellungen,
  onSetze,
}: {
  einstellungen: Record<string, unknown>;
  onSetze(einstellungen: Record<string, unknown>): void;
}) {
  const setze = (name: string, wert: unknown): void => {
    const naechste = { ...einstellungen };

    if (wert === undefined || wert === '') {
      delete naechste[name];
    } else {
      naechste[name] = wert;
    }

    onSetze(naechste);
  };

  return (
    <>
      <p className="muted">
        Wie die Werte dieser Quelle zu lesen sind. <strong>Leer heißt: was vom Mandanten kommt.</strong> Ein Profil
        ist eine Sammlung von Einstellungen und keine übergeordnete Ebene — wer am Mandanten etwas festlegt, hat für
        diesen Kunden entschieden, und ein Schema darf das nicht aufheben.
      </p>

      <Field
        label="Sprache und Land"
        explain={'Entscheidet, wie Zahlen und Datumsangaben gelesen werden. „1.000,50" und „1,000.50" sind dieselbe Zahl in zwei Ländern.'}
      >
        <select
          className="input--wahl"
          value={(einstellungen.locale as string) ?? ''}
          onChange={(event) => setze('locale', event.target.value || undefined)}
        >
          <option value="">wie beim Mandanten</option>
          {LOCALES.map((eine) => (
            <option key={eine.value} value={eine.value}>
              {eine.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Jahrhundertgrenze"
        explain="Ab welcher zweistelligen Jahreszahl das vorige Jahrhundert gemeint ist. 50 heißt: 49 wird 2049, 50 wird 1950."
      >
        <input
          type="number"
          min={0}
          max={99}
          value={(einstellungen.jahrhundertGrenze as number) ?? ''}
          onChange={(event) => setze('jahrhundertGrenze', zahlOderNichts(event.target.value))}
        />
      </Field>

      <Field
        label={'Werte, die als „nichts" gelten'}
        explain={'Durch Komma getrennt. Leer heißt: was der Mandant vorgibt — üblicherweise ein leeres Feld, ein Strich, „N/A" und „NULL".'}
      >
        <input
          className="input--mittel"
          value={((einstellungen.nullWerte as string[]) ?? []).join(', ')}
          placeholder="-, N/A, NULL"
          onChange={(event) => {
            const liste = event.target.value
              .split(',')
              .map((eintrag) => eintrag.trim())
              .filter((eintrag) => eintrag !== '');

            setze('nullWerte', liste.length > 0 ? liste : undefined);
          }}
        />
      </Field>

      <div className="row">
        <Field
          label="Stichprobe"
          explain="Wie viele Werte je Spalte geprüft werden, um ihren Typ zu bestimmen."
        >
          <input
            type="number"
            min={1}
            value={(einstellungen.stichprobe as number) ?? ''}
            onChange={(event) => setze('stichprobe', zahlOderNichts(event.target.value))}
          />
        </Field>

        <Field label="Stichprobe, erweitert" explain="Worauf erweitert wird, wenn die erste nicht für eine sichere Aussage reicht.">
          <input
            type="number"
            min={1}
            value={(einstellungen.stichprobeGrenze as number) ?? ''}
            onChange={(event) => setze('stichprobeGrenze', zahlOderNichts(event.target.value))}
          />
        </Field>
      </div>
    </>
  );
}

/* ---------- Reiter 5: Schlüssel ---------- */

function Schluesselblatt({
  schluessel,
  spalten,
  onSetze,
}: {
  schluessel: Schluessel | undefined;
  spalten: readonly Spaltenvorgabe[];
  onSetze(schluessel: Schluessel | undefined): void;
}) {
  const felder = schluessel?.felder ?? [];
  const benannt = spalten.map((spalte) => spalte.name).filter((name): name is string => Boolean(name));

  const umschalten = (name: string): void => {
    const naechste = felder.includes(name) ? felder.filter((eines) => eines !== name) : [...felder, name];

    onSetze(naechste.length > 0 ? { ...schluessel, felder: naechste } : undefined);
  };

  return (
    <>
      <p className="muted">
        Woran ein Datensatz zu erkennen ist — die Frage, an der alles Weitere hängt:{' '}
        <strong>Sind das zwei Datensätze oder zweimal derselbe?</strong> Ohne Schlüssel gibt es keine
        Zusammenführung.
      </p>

      {benannt.length === 0 && <Empty>Erst brauchen die Spalten Namen — im Reiter „Spalten".</Empty>}

      {benannt.length > 0 && (
        <div className="field">
          <label>Diese Felder bilden den Schlüssel</label>

          <ul className="browse pick">
            {benannt.map((name) => {
              const gewaehlt = felder.includes(name);

              return (
                <li key={name}>
                  <button
                    type="button"
                    className={gewaehlt ? 'pick__row pick__row--an' : 'pick__row'}
                    aria-pressed={gewaehlt}
                    onClick={() => umschalten(name)}
                  >
                    <span className="pick__mark">{gewaehlt ? '✓' : ''}</span>
                    <span className="pick__ext">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {felder.length > 1 && (
            <div className="field__hint">
              Zusammengesetzt aus: {felder.join(' + ')}. Die Reihenfolge zählt — sie ist die, in der Sie angehakt
              haben.
            </div>
          )}
        </div>
      )}

      {/*
        * Der Vergleichswert verlässt die Domäne nie.
        *
        * Für den Vergleich wird eine gefaltete Form gebildet — „mueller gmbh".
        * Sie ist ein Hilfsmittel und niemals ein Datenwert: Wer sie in den
        * Bestand schriebe, hätte aus einem Firmennamen Kleinbuchstaben gemacht
        * und könnte das nicht rückgängig machen.
        */}
      <div className="field">
        <div className="pille-zeile">
          <label>Wie verglichen wird</label>

          <Hint title="Wie verglichen wird">
            Fachliche Dubletten heißen „Müller GmbH", „Mueller GmbH" und „MÜLLER GMBH". Was hier angehakt ist, wird
            beim Vergleich gefaltet — die Daten selbst bleiben unangetastet.
          </Hint>
        </div>

        <div className="stack">
          {FALTUNGEN.map((faltung) => (
            <label key={faltung.name} className="check">
              <input
                type="checkbox"
                disabled={felder.length === 0}
                checked={Boolean(schluessel?.vergleich?.[faltung.name])}
                onChange={(event) =>
                  onSetze(
                    schluessel
                      ? {
                          ...schluessel,
                          vergleich: { ...schluessel.vergleich, [faltung.name]: event.target.checked },
                        }
                      : undefined
                  )
                }
              />
              <span>{faltung.text}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Kleinigkeiten ---------- */

/** Ein leeres Zahlenfeld ist keine Null, sondern keine Angabe. */
function zahlOderNichts(wert: string): number | undefined {
  const zahl = Number.parseInt(wert, 10);

  return wert.trim() === '' || Number.isNaN(zahl) ? undefined : zahl;
}

function pruefungAus(
  art: Pruefung['art'],
  eingaben: { muster: string; beschreibung: string; min: string; max: string; werte: string }
): Pruefung {
  switch (art) {
    case 'FORMAT':
      return { art, muster: eingaben.muster, beschreibung: eingaben.beschreibung };

    case 'BEREICH':
      return {
        art,
        min: zahlOderNichts(eingaben.min),
        max: zahlOderNichts(eingaben.max),
      };

    case 'AUS_LISTE':
      return {
        art,
        werte: eingaben.werte
          .split(',')
          .map((eintrag) => eintrag.trim())
          .filter((eintrag) => eintrag !== ''),
      };

    default:
      return { art };
  }
}

/**
 * Eine Kennung, die es noch nicht gibt.
 *
 * Zwei Regeln mit derselben Kennung wären später nicht auseinanderzuhalten —
 * nicht im Befund, nicht in dieser Liste, nicht beim Entfernen. Der Server
 * weist sie ab; hier entstehen sie deshalb gar nicht erst.
 */
function kennung(feld: string, art: Pruefung['art'], vorhanden: readonly Qualitaetsregel[]): string {
  const stamm = `${feld.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${art.toLowerCase()}`;
  const genommen = new Set(vorhanden.map((regel) => regel.id));

  if (!genommen.has(stamm)) {
    return stamm;
  }

  for (let nummer = 2; ; nummer += 1) {
    if (!genommen.has(`${stamm}-${nummer}`)) {
      return `${stamm}-${nummer}`;
    }
  }
}
