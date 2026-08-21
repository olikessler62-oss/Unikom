import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Credential, Tenant } from '../api/types.js';
import { CheckField, Empty, Field, InfoButton, Loading, Modal, Notice } from '../components/Pieces.js';
import { LOCALES, previewOf, timeZones } from './regions.js';

interface Draft {
  id?: string;
  name: string;
  description: string;
  rootDirectory: string;
  /** Sprachkennung und Zeitzone dieses Mandanten. */
  locale: string;
  timeZone: string;
  enabled: boolean;
  /**
   * Wie lange Ausleitungen des Konfliktbestands liegen bleiben (SPEC-07 §5).
   *
   * Als Text, weil leer etwas anderes heißt als null: leer ist „keine eigene
   * Angabe", null ist „gar nicht forträumen".
   */
  ausleitungenTage: string;
  /** Wohin Meldungen gehen — leer heißt: nur ins Benachrichtigungscenter. */
  empfaenger: string;
  auchBeiErfolg: boolean;
  mailHost: string;
  mailPort: string;
  mailVerschluesselung: 'STARTTLS' | 'IMPLIZIT' | 'KEINE';
  mailAbsender: string;
  mailZugangId: string;
  /**
   * Die Konsolidierungseinstellungen — durchweg als Text.
   *
   * Ein Zahlenfeld, das während des Tippens schon eine Zahl sein muss, lässt
   * sich nicht leeren. Und leer ist hier die wichtigste Eingabe: Sie heißt
   * „hier gilt, was Unikom mitbringt".
   */
  jahrhundertGrenze: string;
  nullWerte: string;
  stichprobe: string;
  stichprobeGrenze: string;
  mindestKonfidenz: string;
}

const EMPTY: Draft = {
  name: '',
  description: '',
  rootDirectory: '',
  locale: 'de-DE',
  timeZone: 'Europe/Berlin',
  enabled: true,
  ausleitungenTage: '',
  empfaenger: '',
  auchBeiErfolg: false,
  mailHost: '',
  mailPort: '587',
  mailVerschluesselung: 'STARTTLS',
  mailAbsender: '',
  mailZugangId: '',
  jahrhundertGrenze: '',
  nullWerte: '',
  stichprobe: '',
  stichprobeGrenze: '',
  mindestKonfidenz: '',
};

interface Props {
  canManage: boolean;
}

export function TenantsScreen({ canManage }: Props) {
  const tenants = useResource<Tenant[]>('/api/tenants');
  /* Für den Postausgang: Das Kennwort steht in einem Zugang, nicht im Formular. */
  const credentials = useResource<Credential[]>('/api/credentials');
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** Die Erklärung zum Root-Verzeichnis, auf Wunsch statt dauerhaft. */
  const [explaining, setExplaining] = useState(false);

  async function save(): Promise<void> {
    if (!draft) {
      return;
    }

    setError(undefined);
    setSaving(true);

    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        rootDirectory: draft.rootDirectory,
        region: { locale: draft.locale, timeZone: draft.timeZone },
        enabled: draft.enabled,
        /*
         * Leer heißt „keine eigene Angabe" und wird nicht zur Null: Sonst
         * hieße nichts eingetragen ab dann abgeschaltet, und niemand sähe den
         * Unterschied.
         */
        ausleitungenTage: draft.ausleitungenTage.trim() === '' ? null : Number(draft.ausleitungenTage),
        benachrichtigung: {
          empfaenger: draft.empfaenger
            .split(',')
            .map((anschrift) => anschrift.trim())
            .filter((anschrift) => anschrift !== ''),
          auchBeiErfolg: draft.auchBeiErfolg,
          /*
           * Ohne Server keine Einstellung. Ein halb ausgefüllter Postausgang
           * sähe eingerichtet aus und scheiterte beim ersten kritischen
           * Ereignis — also genau dann, wenn er gebraucht wird.
           */
          postausgang: draft.mailHost.trim()
            ? {
                host: draft.mailHost.trim(),
                port: Number(draft.mailPort) || 587,
                verschluesselung: draft.mailVerschluesselung,
                absender: draft.mailAbsender.trim(),
                zugangId: draft.mailZugangId || undefined,
              }
            : undefined,
        },
        consolidation: {
          jahrhundertGrenze: draft.jahrhundertGrenze,
          nullWerte: draft.nullWerte.trim() === '' ? undefined : draft.nullWerte.split(',').map((wert) => wert.trim()),
          stichprobe: draft.stichprobe,
          stichprobeGrenze: draft.stichprobeGrenze,
          mindestKonfidenz: draft.mindestKonfidenz,
        },
      };

      if (draft.id) {
        await api.put(`/api/tenants/${draft.id}`, payload);
      } else {
        await api.post('/api/tenants', payload);
      }

      setDraft(undefined);
      await tenants.reload();
    } catch (failure) {
      // Overlapping directories and jobs left outside are reported by the
      // server with a message that names the problem.
      setError(messageOf(failure, 'Der Mandant konnte nicht gespeichert werden'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(tenant: Tenant): Promise<void> {
    if (!confirm(`Mandant "${tenant.name}" wirklich löschen?`)) {
      return;
    }

    try {
      await api.delete(`/api/tenants/${tenant.id}`);
      await tenants.reload();
    } catch (failure) {
      setError(messageOf(failure, 'Der Mandant konnte nicht gelöscht werden'));
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
      {explaining && (
        <Modal title="Root-Verzeichnis" onClose={() => setExplaining(false)}>
          <p>
            Jeder Job dieses Mandanten darf seine Dateien nur <strong>unterhalb dieses Ordners</strong> ablegen. Ein
            Zielverzeichnis außerhalb wird beim Speichern abgelehnt — so landen die Daten dieses Kunden auch bei einem
            Tippfehler nicht beim nächsten.
          </p>
          <p>
            Leer lassen, wenn Sie nur eigene Daten verarbeiten. Dann gibt es niemanden, mit dem etwas verwechselt werden
            könnte.
          </p>
        </Modal>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      {draft ? (
        <section className="card">
          <h2>{draft.id ? 'Mandant bearbeiten' : 'Neuer Mandant'}</h2>

          <Field label="Mandanten-Name">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
          </Field>

          <Field label="Mandanten-Beschreibung">
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>

          <Field label="Root-Verzeichnis">
            <div className="field__row">
              <input
                value={draft.rootDirectory}
                placeholder="D:\Daten\Kunde A"
                onChange={(event) => setDraft({ ...draft, rootDirectory: event.target.value })}
              />
              <InfoButton label="Wozu dient das Root-Verzeichnis?" onClick={() => setExplaining(true)} />
            </div>
          </Field>

          {/*
            * Die Region entscheidet, wie Datums- und Zeitangaben dieses
            * Mandanten gelesen werden. Sie steht hier und nicht in den
            * Einstellungen: Ein Dienstleister holt Daten für mehrere eigene
            * Kunden, und `04/03/2026` ist beim einen der 4. März und beim
            * anderen der 3. April — beide Lesarten gelingen, keine meldet einen
            * Fehler.
            */}
          <Field
            label="Region"
            explain={`So schreibt dieser Mandant den 3. April 2026: ${previewOf(draft.locale, draft.timeZone).sample} — ${previewOf(draft.locale, draft.timeZone).order}.`}
          >
            <select value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value })}>
              {/* Was am Mandanten steht, bleibt wählbar — auch wenn es nicht in der Liste steht. */}
              {!LOCALES.some((eintrag) => eintrag.value === draft.locale) && (
                <option value={draft.locale}>{draft.locale}</option>
              )}
              {LOCALES.map((eintrag) => (
                <option key={eintrag.value} value={eintrag.value}>
                  {eintrag.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Zeitzone" explain="Für Zeitangaben ohne eigene Zeitzone. Sommer- und Winterzeit stecken darin.">
            <select value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}>
              {!timeZones().includes(draft.timeZone) && <option value={draft.timeZone}>{draft.timeZone}</option>}
              {timeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <Konsolidierungseinstellungen
            draft={draft}
            voreinstellungen={tenants.data?.find((eintrag) => eintrag.id === draft.id)?.voreinstellungen}
            onChange={setDraft}
          />

          <Field
            label="Ausleitungen aufbewahren (Tage)"
            explain="Konflikt- und Konfliktzieldateien. Leer heißt 30 Tage; 0 heißt: nie forträumen. Fälle, Entscheidungen und Historie bleiben immer."
          >
            <input
              type="number"
              min={0}
              value={draft.ausleitungenTage}
              placeholder="30"
              onChange={(event) => setDraft({ ...draft, ausleitungenTage: event.target.value })}
            />
          </Field>

          <Meldewege draft={draft} credentials={credentials.data ?? []} onChange={setDraft} />

          <CheckField
            label="Mandant ist aktiv"
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />

          <div className="row">
            <button disabled={saving || !draft.name} onClick={() => void save()}>
              {saving ? 'Wird gespeichert …' : 'Speichern'}
            </button>
            <button className="secondary" onClick={() => setDraft(undefined)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        canManage && (
          <div className="row">
            <button onClick={() => setDraft(EMPTY)}>Neuer Mandant</button>
          </div>
        )
      )}

      {tenants.data.length === 0 ? (
        <Empty>Es ist kein Mandant angelegt.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mandant</th>
                <th>Root-Verzeichnis</th>
                <th className="numeric">Jobs</th>
                <th>Status</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {tenants.data.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                    {tenant.description && <div className="muted">{tenant.description}</div>}
                  </td>
                  <td className="muted">
                    {tenant.rootDirectory ?? <span className="badge badge--muted">nicht eingegrenzt</span>}
                  </td>
                  <td className="numeric">{tenant.jobCount ?? 0}</td>
                  <td>
                    {tenant.enabled ? (
                      <span className="badge badge--good">Aktiv</span>
                    ) : (
                      <span className="badge badge--muted">Ruht</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="secondary"
                          onClick={() =>
                            setDraft({
                              id: tenant.id,
                              name: tenant.name,
                              description: tenant.description ?? '',
                              rootDirectory: tenant.rootDirectory ?? '',
                              // Der Server schickt auch die Voreinstellung mit:
                              // Was gilt, soll dastehen und nicht erschlossen
                              // werden müssen.
                              locale: tenant.region?.locale ?? EMPTY.locale,
                              timeZone: tenant.region?.timeZone ?? EMPTY.timeZone,
                              enabled: tenant.enabled,
                              ausleitungenTage:
                                tenant.ausleitungenTage === undefined ? '' : String(tenant.ausleitungenTage),
                              ...meldewegeAus(tenant),
                              ...einstellungenAus(tenant),
                            })
                          }
                        >
                          Bearbeiten
                        </button>
                        <button className="secondary" onClick={() => void remove(tenant)}>
                          Löschen
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Wohin die Meldungen dieses Mandanten gehen (SPEC-01, Abschnitt 20).
 *
 * Am Mandanten und nicht an der Installation: Empfänger sind je Kunde
 * verschieden, und bei einem Dienstleister ist es auch der Server — der eine
 * will über seinen eigenen versenden, weil sein Spamfilter nur den kennt.
 *
 * Leer ist ein gültiger Zustand. Dann steht jede Meldung im
 * Benachrichtigungscenter und geht nirgends hin, und das ist der Normalfall.
 */
function Meldewege({
  draft,
  credentials,
  onChange,
}: {
  draft: Draft;
  credentials: Credential[];
  onChange(next: Draft): void;
}) {
  return (
    <>
      <h3>Benachrichtigung per E-Mail</h3>

      <Field
        label="Empfänger"
        explain="Durch Komma getrennt. Leer heißt: Meldungen stehen nur im Benachrichtigungscenter."
      >
        <input
          value={draft.empfaenger}
          placeholder="betrieb@kunde.de, leitung@kunde.de"
          onChange={(event) => onChange({ ...draft, empfaenger: event.target.value })}
        />
      </Field>

      {draft.empfaenger.trim() !== '' && (
        <>
          <CheckField
            label="Auch bei erfolgreichem Lauf schreiben"
            explain="Ohne Häkchen kommt nur Post, wenn etwas ansteht oder schiefging — für einen Lauf, den niemand beobachtet, lohnt sich das Häkchen."
            checked={draft.auchBeiErfolg}
            onChange={(auchBeiErfolg) => onChange({ ...draft, auchBeiErfolg })}
          />

          <Field label="Postausgangsserver" explain="Der SMTP-Server, über den versandt wird.">
            <input
              value={draft.mailHost}
              placeholder="mail.kunde.de"
              onChange={(event) => onChange({ ...draft, mailHost: event.target.value })}
            />
          </Field>

          <Field label="Port">
            <input
              value={draft.mailPort}
              placeholder="587"
              onChange={(event) => onChange({ ...draft, mailPort: event.target.value })}
            />
          </Field>

          <Field
            label="Verschlüsselung"
            explain="STARTTLS ist der Regelfall (Port 587). Implizit heißt: verschlüsselt ab dem ersten Byte (Port 465)."
          >
            <select
              value={draft.mailVerschluesselung}
              onChange={(event) =>
                onChange({ ...draft, mailVerschluesselung: event.target.value as Draft['mailVerschluesselung'] })
              }
            >
              <option value="STARTTLS">STARTTLS (Port 587)</option>
              <option value="IMPLIZIT">Implizit (Port 465)</option>
              <option value="KEINE">Keine — nur im eigenen Netz</option>
            </select>
          </Field>

          <Field label="Absender" explain="Was im Absenderfeld der Nachricht steht.">
            <input
              value={draft.mailAbsender}
              placeholder="Unikom <unikom@kunde.de>"
              onChange={(event) => onChange({ ...draft, mailAbsender: event.target.value })}
            />
          </Field>

          <Field
            label="Zugang"
            explain="Benutzer und Kennwort stehen in den Zugängen, nicht hier. Ohne Zugang wird ohne Anmeldung versandt — das geht nur im eigenen Netz."
          >
            <select
              value={draft.mailZugangId}
              onChange={(event) => onChange({ ...draft, mailZugangId: event.target.value })}
            >
              <option value="">Ohne Anmeldung</option>
              {credentials.map((zugang) => (
                <option key={zugang.id} value={zugang.id}>
                  {zugang.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}

/**
 * Die gespeicherten Meldewege als Formularfelder.
 *
 * Der Port steht als Text im Entwurf und als Zahl im Bestand. Ein Zahlenfeld,
 * das während des Tippens schon eine Zahl sein muss, lässt sich nicht leeren —
 * und wer „587" durch „465" ersetzen will, kommt an der ersten gelöschten
 * Ziffer nicht vorbei.
 */
function meldewegeAus(tenant: Tenant): Pick<
  Draft,
  'empfaenger' | 'auchBeiErfolg' | 'mailHost' | 'mailPort' | 'mailVerschluesselung' | 'mailAbsender' | 'mailZugangId'
> {
  const meldung = tenant.benachrichtigung;
  const ausgang = meldung?.postausgang;

  return {
    empfaenger: (meldung?.empfaenger ?? []).join(', '),
    auchBeiErfolg: meldung?.auchBeiErfolg === true,
    mailHost: ausgang?.host ?? '',
    mailPort: ausgang ? String(ausgang.port) : EMPTY.mailPort,
    mailVerschluesselung: ausgang?.verschluesselung ?? EMPTY.mailVerschluesselung,
    mailAbsender: ausgang?.absender ?? '',
    mailZugangId: ausgang?.zugangId ?? '',
  };
}

/** Die gespeicherten Konsolidierungseinstellungen als Formularfelder. */
function einstellungenAus(tenant: Tenant): Pick<
  Draft,
  'jahrhundertGrenze' | 'nullWerte' | 'stichprobe' | 'stichprobeGrenze' | 'mindestKonfidenz'
> {
  const werte = tenant.consolidation;
  const text = (zahl?: number): string => (zahl === undefined ? '' : String(zahl));

  return {
    jahrhundertGrenze: text(werte?.jahrhundertGrenze),
    nullWerte: (werte?.nullWerte ?? []).join(', '),
    stichprobe: text(werte?.stichprobe),
    stichprobeGrenze: text(werte?.stichprobeGrenze),
    mindestKonfidenz: text(werte?.mindestKonfidenz),
  };
}

/**
 * Was dieser Kunde anders liest als alle anderen (SPEC-02, Abschnitt 40).
 *
 * ```text
 * ALLGEMEIN  ──▶  PROFIL  ──▶  MANDANT   ← gewinnt
 * ```
 *
 * Diese Ebene gewinnt in der Hierarchie — und war bis hierher die einzige, die
 * niemand setzen konnte. Neun Stellen im Erzeugnis fragten danach, und es stand
 * immer nichts darin.
 *
 * **Leer ist die häufigste und beste Eingabe.** Sie heißt: Hier gilt, was
 * Unikom mitbringt. Der Vorschlag im Feld zeigt, was das ist — er kommt vom
 * Server, damit er nicht eines Tages etwas anderes zeigt, als der Lauf tut.
 */
function Konsolidierungseinstellungen({
  draft,
  voreinstellungen,
  onChange,
}: {
  draft: Draft;
  voreinstellungen?: Tenant['voreinstellungen'];
  onChange(next: Draft): void;
}) {
  return (
    <>
      <h3>Wie die Daten dieses Mandanten gelesen werden</h3>

      <Field
        label="Werte, die als „nichts“ gelten"
        explain="Durch Komma getrennt. Was hier steht, zählt beim Einlesen als leeres Feld — und nicht als Inhalt, der die Vollständigkeitsprüfung bestehen lässt."
      >
        <input
          value={draft.nullWerte}
          placeholder={(voreinstellungen?.nullWerte ?? []).filter((wert) => wert !== '').join(', ')}
          onChange={(event) => onChange({ ...draft, nullWerte: event.target.value })}
        />
      </Field>

      <Field
        label="Jahrhundertgrenze"
        explain="Ab welcher zweistelligen Jahreszahl das vorige Jahrhundert gemeint ist. Bei 50 wird 49 zu 2049 und 50 zu 1950."
      >
        <input
          value={draft.jahrhundertGrenze}
          placeholder={String(voreinstellungen?.jahrhundertGrenze ?? '')}
          onChange={(event) => onChange({ ...draft, jahrhundertGrenze: event.target.value })}
        />
      </Field>

      <Field
        label="Stichprobe je Feld"
        explain="Wie viele Werte geprüft werden, um den Typ eines Feldes zu bestimmen."
      >
        <input
          value={draft.stichprobe}
          placeholder={String(voreinstellungen?.stichprobe ?? '')}
          onChange={(event) => onChange({ ...draft, stichprobe: event.target.value })}
        />
      </Field>

      <Field
        label="Obergrenze der Stichprobe"
        explain="Worauf erweitert wird, wenn die Stichprobe für ein sicheres Urteil nicht reicht."
      >
        <input
          value={draft.stichprobeGrenze}
          placeholder={String(voreinstellungen?.stichprobeGrenze ?? '')}
          onChange={(event) => onChange({ ...draft, stichprobeGrenze: event.target.value })}
        />
      </Field>

      <Field
        label="Mindestkonfidenz"
        explain="Ab welchem Anteil passender Werte ein Feldtyp als sicher gilt. Sie lockert nur die Typerkennung — ob Unikom einen Wertekonflikt selbst entscheiden darf, bleibt bei 0,97, gleich was hier steht."
      >
        <input
          value={draft.mindestKonfidenz}
          placeholder={String(voreinstellungen?.mindestKonfidenz ?? '')}
          onChange={(event) => onChange({ ...draft, mindestKonfidenz: event.target.value })}
        />
      </Field>
    </>
  );
}
