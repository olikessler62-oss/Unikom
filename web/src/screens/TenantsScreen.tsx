import { Fragment, useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Auslieferungsart, Credential, Tenant, Vorlageart } from '../api/types.js';
import { alsEineZeile } from '../components/Einzeiler.js';
import {
  CheckField,
  Empty,
  Field,
  HakenIcon,
  InfoButton,
  KreuzIcon,
  Loading,
  Memofeld,
  Modal,
  Notice,
  titelBeiUeberlaufWahl,
} from '../components/Pieces.js';
import { ArchivScreen } from './ArchivScreen.js';
import { DiscoveryScreen } from './DiscoveryScreen.js';
import { MappingScreen } from './MappingScreen.js';
import { MergeScreen } from './MergeScreen.js';
import { ReferenceScreen } from './ReferenceScreen.js';
import { SchemataScreen } from './SchemataScreen.js';
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
  archivTage: string;
  /**
   * Wie sich ein offener Konflikt meldet, bis er entschieden ist.
   *
   * Die Frist als Text und nicht als Zahl — aus demselben Grund wie unten:
   * Ein Feld, das während des Tippens schon eine Zahl sein muss, lässt sich
   * nicht leeren, und leer heißt hier „es gilt die Voreinstellung".
   */
  konfliktVorlage: Vorlageart;
  wiedervorlageStunden: string;
  akzeptierenErlaubt: boolean;
  auslieferung: Auslieferungsart;
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
  archivTage: '',
  konfliktVorlage: 'WIEDERVORLAGE',
  wiedervorlageStunden: '',
  akzeptierenErlaubt: true,
  auslieferung: 'NUR_VOLLSTAENDIG',
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

/**
 * So breit, dass auch der längste Eintrag hineinpasst.
 *
 * Gezählt statt gemessen, und zwar hier, wo die Einträge stehen: Ein
 * geschlossenes Auswahlfeld misst sich am **gewählten** Eintrag, nicht am
 * längsten. „Europe/Berlin" ergäbe ein schmales Feld, in das
 * „America/Argentina/Rio_Gallegos" nicht hineinpasst — und dann steht dort
 * abgeschnittener Text, ohne dass jemand die Ursache sieht.
 *
 * Die Zugabe deckt Innenabstand, Rahmen und den Pfeil rechts. Sie ist
 * großzügig gerundet: `ch` ist die Breite der Ziffer Null, und ein Feld, das
 * ein paar Pixel übersteht, fällt niemandem auf — eines, das ein Zeichen zu
 * schmal ist, schon.
 *
 * ## Für die Region wird nicht gerechnet
 *
 * Sie hat 281 Einträge, und der längste heißt „Südgeorgien und die Südlichen
 * Sandwichinseln (en-GS)". Ein Feld dieser Breite steht über den Rand der
 * Fläche hinaus, und der Info-Knopf der Zeitzone daneben stünde nicht mehr in
 * einer Flucht mit den übrigen. Sie nimmt deshalb, was die Zeile übrig lässt;
 * ihre **Liste** richtet sich nach ihrem Inhalt — siehe `input--wahl-lang`.
 */
const ZONEN_BREITE = `calc(${Math.max(...timeZones().map((zone) => zone.length))}ch + 3.2rem)`;

/**
 * Die Blätter eines Mandanten - und damit sein Untermenü.
 *
 * ```text
 * wer er ist        Grunddaten, Einstellungen, Benachrichtigung
 * was er liefert    Eingangsquellen, Beispiel einlesen, Zuordnungen,
 *                   Referenzen, Probe, Archiv
 * ```
 *
 * ## Warum sie unter den Mandanten gehören
 *
 * Die letzten sechs standen als eigene Punkte im Hauptmenü - unter „Schemata",
 * „Archiv" und den Unterpunkten von „Daten konsolidieren". Jeder von ihnen
 * fragte als Erstes „für welchen Kunden?", und genau darin lag der Fehler: Was
 * zuerst nach einem Kunden fragt, gehört zu ihm und nicht neben ihn.
 *
 * Das Menü war nach den **Modulen** gegliedert - danach, was auf der Rechnung
 * steht. Ein Modul ist aber eine Position im Preisverzeichnis und kein Ort im
 * Haus. Gegliedert wird jetzt danach, wonach man sucht: erst der Kunde, dann
 * das, was ihn betrifft.
 *
 * ## Warum nicht alles auf eine Fläche
 *
 * Weil es nicht daraufpasst - auch heute nicht. Drei Karten untereinander sind
 * auf einem gewöhnlichen Bildschirm schon anderthalb Seiten; mit sechs weiteren
 * Bündeln wäre es ein Dutzend. Ein Blatt zeigt eine Sache ganz, statt neun
 * halb.
 *
 * ## Warum im Menü und nicht als Reiterstreifen
 *
 * Sie waren zuerst ein Streifen aus neun Reitern über dem Formular. Das war
 * eine zweite Navigation neben der ersten: Links das Menü, oben die Reiter, und
 * beide sagten, wo man ist. Wer neun Namen an zwei Orten führt, führt sie
 * irgendwann verschieden.
 *
 * Die Liste steht deshalb nur noch hier, und die Seitenleiste liest sie. `App`
 * baut daraus die Unterpunkte - dieselbe Reihenfolge, derselbe Strich zwischen
 * den beiden Gruppen, dieselbe Regel, dass die letzten sechs erst erscheinen,
 * wenn es den Mandanten gibt.
 */
export type Blatt =
  | 'grunddaten'
  | 'einstellungen'
  | 'benachrichtigung'
  | 'quellen'
  | 'einlesen'
  | 'zuordnungen'
  | 'referenzen'
  | 'probe'
  | 'archiv';

/**
 * Ein Blatt in der Liste: seine Kennung, sein Name, und ob eine Linie davor
 * steht. Dieselbe Form für beide Gruppen - so lassen sie sich aneinanderhängen,
 * ohne dass unterwegs zwei Formen entstehen.
 */
export interface Blattpunkt {
  id: Blatt;
  text: string;
  trennerDavor?: boolean;
}

/** Was am Mandanten selbst steht — auch bei einem, den es noch nicht gibt. */
export const STAMMBLAETTER: readonly Blattpunkt[] = [
  { id: 'grunddaten', text: 'Grunddaten' },
  { id: 'einstellungen', text: 'Einstellungen' },
  { id: 'benachrichtigung', text: 'Benachrichtigung' },
];

/**
 * Was an seinen Daten hängt — erst, wenn es ihn gibt.
 *
 * Eine Eingangsquelle gehört einem Mandanten, und einem Mandanten ohne Kennung
 * kann nichts gehören. Diese Blätter beim Anlegen zu zeigen hieße, eine Liste
 * anzubieten, die beim ersten Klick ins Leere greift.
 */
export const DATENBLAETTER: readonly Blattpunkt[] = [
  { id: 'quellen', text: 'Eingangsquellen', trennerDavor: true },
  { id: 'einlesen', text: 'Beispiel einlesen' },
  { id: 'zuordnungen', text: 'Zuordnungen' },
  { id: 'referenzen', text: 'Referenzen' },
  { id: 'probe', text: 'Probe' },
  { id: 'archiv', text: 'Archiv' },
];

/**
 * Die Kennung für „ein Mandant, den es noch nicht gibt".
 *
 * Sie steht hier und wird nach außen gereicht, weil das Menü sie mitspricht:
 * Wer „Neuer Mandant" wählt, wählt einen Zustand, den auch die Seitenleiste
 * kennen muss - sonst stünde dort kein Unterpunkt, während rechts ein Formular
 * offen ist.
 */
export const NEUER_MANDANT = 'neu';

/**
 * Aus einem gespeicherten Mandanten wird die Eingabe, die man ändern kann.
 *
 * Das stand einmal im Klick auf „Bearbeiten". Dort war es nicht erreichbar für
 * den zweiten Weg, der jetzt dazugekommen ist: die Wahl aus dem Menü. Zwei
 * Umrechnungen für dieselbe Sache wären zwei Gelegenheiten, ein Feld zu
 * vergessen - und vergessen hieße hier: still leer statt still falsch.
 */
/**
 * Die Region eines Mandanten als eine Zeile.
 *
 * Sprache und Zeitzone stehen nebeneinander, getrennt durch einen Punkt: Es ist
 * eine Angabe aus zwei Teilen und nicht zwei Angaben. Zwei Spalten dafür wären
 * in einer Liste, die auf einen Blick gelesen werden soll, eine zu viel.
 */
function regionVon(tenant: Tenant): string {
  const sprache = tenant.region?.locale ?? EMPTY.locale;
  const zone = tenant.region?.timeZone ?? EMPTY.timeZone;

  return `${sprache} · ${zone}`;
}

function entwurfAus(tenant: Tenant): Draft {
  return {
    id: tenant.id,
    name: tenant.name,
    description: tenant.description ?? '',
    rootDirectory: tenant.rootDirectory ?? '',
    // Der Server schickt auch die Voreinstellung mit: Was gilt, soll dastehen
    // und nicht erschlossen werden müssen.
    locale: tenant.region?.locale ?? EMPTY.locale,
    timeZone: tenant.region?.timeZone ?? EMPTY.timeZone,
    enabled: tenant.enabled,
    ausleitungenTage: tenant.ausleitungenTage === undefined ? '' : String(tenant.ausleitungenTage),
    archivTage: tenant.archivTage === undefined ? '' : String(tenant.archivTage),
    ...konflikteAus(tenant),
    ...meldewegeAus(tenant),
    ...einstellungenAus(tenant),
  };
}

/**
 * Welches der beiden Fenster offen steht - oder keines.
 *
 * Nie beide. Zwei Fenster übereinander legen zwei abgedunkelte Flächen
 * übereinander, und die zweite macht aus dem Grund dahinter Schwarz. Wer einen
 * Mandanten aufschlägt, schließt damit die Liste; wer ihn zuklappt, bekommt sie
 * zurück.
 */
export type Mandantenfenster = { art: 'liste' } | { art: 'mandant'; id: string };

interface Props {
  canManage: boolean;
  /**
   * Welches Fenster offen ist.
   *
   * Die Wahl steht über diesem Bildschirm und nicht in ihm: Aufgeschlagen wird
   * aus dem Hauptmenü heraus, und das Menü steht eine Ebene höher.
   */
  fenster: Mandantenfenster;
  /** Welches Blatt des Mandanten offen steht - aus demselben Grund von außen. */
  blatt: Blatt;
  onFenster(fenster: Mandantenfenster | undefined): void;
  onBlatt(blatt: Blatt): void;
}

export function TenantsScreen({ canManage, fenster, blatt, onFenster, onBlatt }: Props) {
  const tenants = useResource<Tenant[]>('/api/tenants');
  /* Für den Postausgang: Das Kennwort steht in einem Zugang, nicht im Formular. */
  const credentials = useResource<Credential[]>('/api/credentials');
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** Die Erklärung zum Root-Verzeichnis, auf Wunsch statt dauerhaft. */
  const [explaining, setExplaining] = useState(false);
  /**
   * Welche Wahl schon in einen Entwurf umgesetzt ist.
   *
   * Ohne diese Merkstelle liefe der Effekt darunter auch dann noch einmal, wenn
   * nur die Liste neu geladen wurde - und baute den Entwurf neu auf, während
   * jemand darin tippt. Die Wahl ändert sich, wenn jemand etwas anderes
   * anklickt; die Liste ändert sich, wenn der Server antwortet. Nur das Erste
   * ist ein Grund, von vorn zu beginnen.
   */
  const umgesetzt = useRef<string>(undefined);
  /**
   * Welche Zeile der Liste hervorgehoben ist.
   *
   * Sie bleibt hier und geht nicht nach oben: Ausgesucht ist noch nicht
   * aufgeschlagen. Wer die Liste mit „Abbrechen" verlässt, hat nichts getan -
   * und eine Wahl, die das überdauerte, wäre eine Entscheidung, die niemand
   * getroffen hat.
   */
  const [gewaehlt, setGewaehlt] = useState<string>();

  /** Welcher Mandant aufgeschlagen ist - `undefined`, solange die Liste steht. */
  const mandant = fenster.art === 'mandant' ? fenster.id : undefined;

  function oeffne(id: string): void {
    onBlatt('grunddaten');
    onFenster({ art: 'mandant', id });
  }

  function zurueckZurListe(): void {
    onBlatt('grunddaten');
    onFenster({ art: 'liste' });
  }

  /*
   * Aus der Wahl wird ein Entwurf.
   *
   * Der Entwurf bleibt hier: Er ist die halbfertige Eingabe eines Menschen und
   * hat in der Navigation nichts zu suchen. Von außen kommt nur, *wer* gemeint
   * ist.
   */
  useEffect(() => {
    if (umgesetzt.current === mandant) {
      return;
    }

    if (mandant === undefined) {
      umgesetzt.current = undefined;
      setDraft(undefined);
      return;
    }

    if (mandant === NEUER_MANDANT) {
      umgesetzt.current = mandant;
      setDraft(EMPTY);
      return;
    }

    const gewaehlt = tenants.data?.find((eintrag) => eintrag.id === mandant);

    // Die Liste ist noch unterwegs: beim nächsten Durchlauf steht sie da.
    if (gewaehlt) {
      umgesetzt.current = mandant;
      setDraft(entwurfAus(gewaehlt));
    }
  }, [mandant, tenants.data]);

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
        archivTage: draft.archivTage.trim() === '' ? null : Number(draft.archivTage),
        konflikte: {
          vorlage: draft.konfliktVorlage,
          wiedervorlageStunden:
            draft.wiedervorlageStunden.trim() === '' ? undefined : Number(draft.wiedervorlageStunden),
          akzeptierenErlaubt: draft.akzeptierenErlaubt,
          auslieferung: draft.auslieferung,
        },
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

      zurueckZurListe();
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

  return (
    <>
      {/*
        * Die Liste: wer da ist, und wer davon läuft.
        *
        * Sie steht in einem Fenster und nicht auf einer Seite. Ein Mandant ist
        * nichts, was man ansieht - er ist etwas, das man aufschlägt: Man sucht
        * einen heraus, arbeitet an ihm und legt ihn wieder weg. Genau das tut
        * ein Fenster mit OK und Abbrechen.
        */}
      {fenster.art === 'liste' && (
        <Modal
          title="Mandanten"
          // Das Fenster bringt OK und Abbrechen mit; ein „Schließen" daneben
          // wäre ein dritter Knopf für das, was der zweite schon tut.
          ownActions
          // Kopf und Knopfleiste stehen fest, nur die Liste rollt.
          geteilt
          onClose={() => onFenster(undefined)}
        >
          {error && <Notice kind="error">{error}</Notice>}

          {/*
            * Laden und Scheitern stehen im Fenster und nicht davor.
            *
            * Vorher gab dieser Bildschirm bei beidem eine Zeile aus und sonst
            * nichts. Als Fenster ginge das nicht mehr auf: Wer „Mandanten"
            * anklickt, bekäme nichts - keinen Rahmen, keinen Titel, keinen
            * Ausgang, und keine Auskunft darüber, dass überhaupt etwas läuft.
            */}
          <div className="fenster__mitte">
            {tenants.error ? (
              <Notice kind="error">{tenants.error}</Notice>
            ) : !tenants.data ? (
              <Loading />
            ) : tenants.data.length === 0 ? (
              <Empty>Es ist kein Mandant angelegt.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="mandantenliste">
                  <thead>
                    <tr>
                      {/*
                        * Die Spalte des Zeichens trägt keine Überschrift.
                        *
                        * „Status" darüber wäre ein Wort für etwas, das man
                        * ohnehin auf einen Blick sieht - und es wäre breiter als
                        * die Spalte selbst.
                        */}
                      <th className="mandantenliste__zeichen" aria-label="Läuft" />
                      <th>Mandant</th>
                      <th>Region</th>
                      {canManage && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.data.map((tenant) => (
                      <tr
                        key={tenant.id}
                        className={
                          tenant.id === gewaehlt ? 'mandantenliste__zeile mandantenliste__zeile--an' : 'mandantenliste__zeile'
                        }
                        onClick={() => setGewaehlt(tenant.id)}
                        /*
                         * Ein Doppelklick öffnet gleich. Das ist kein zweiter
                         * Weg neben OK, sondern derselbe: Wer eine Zeile zweimal
                         * anklickt, hat sich entschieden, und ihn danach noch
                         * einmal nach unten rechts zu schicken wäre ein Schritt
                         * ohne Frage.
                         */
                        onDoubleClick={() => oeffne(tenant.id)}
                      >
                        <td className="mandantenliste__zeichen">
                          {tenant.enabled ? (
                            <span className="laeuft laeuft--an" title="Aktiv">
                              <HakenIcon />
                            </span>
                          ) : (
                            <span className="laeuft laeuft--aus" title="Ruht">
                              <KreuzIcon />
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                          {/*
                            * Auch hier nur die erste Zeile: In HTML wird aus
                            * einem Umbruch ein Leerzeichen, und aus drei Zeilen
                            * wird eine, in der „Handels AG Ansprechpartner: Frau
                            * Ohlsen" hintereinander steht. Der ganze Text hängt
                            * als Merkzettel daran.
                            */}
                          {tenant.description && (
                            <div className="muted" title={tenant.description}>
                              {alsEineZeile(tenant.description)}
                            </div>
                          )}
                        </td>
                        <td className="muted">{regionVon(tenant)}</td>
                        {canManage && (
                          <td>
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <button
                                className="secondary"
                                onClick={(event) => {
                                  // Sonst wählte der Klick die Zeile gleich mit
                                  // aus - und die Rückfrage stünde über einer
                                  // Zeile, die sich gerade hervorgehoben hat.
                                  event.stopPropagation();
                                  void remove(tenant);
                                }}
                              >
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
          </div>

          {/*
            * Links das Anlegen, rechts die Entscheidung über das Fenster.
            *
            * „Neuer Mandant" ist keine Antwort auf die Frage des Fensters - es
            * ist eine Handlung an der Liste. Rechts neben OK stünde es wie eine
            * dritte Möglichkeit, das Fenster zu verlassen.
            */}
          <div className="row modal__actions modal__actions--verteilt">
            {canManage ? (
              <button className="secondary" onClick={() => oeffne(NEUER_MANDANT)}>
                Neuer Mandant
              </button>
            ) : (
              <span />
            )}

            <div className="row">
              <button disabled={!gewaehlt} onClick={() => gewaehlt && oeffne(gewaehlt)}>
                OK
              </button>
              <button className="secondary" onClick={() => onFenster(undefined)}>
                Abbrechen
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/*
        * Der aufgeschlagene Mandant.
        *
        * Ein eigenes Fenster und nicht dieselbe Fläche: Was hier steht, sind
        * neun Blätter mit Tabellen darin. Links stehen sie zur Wahl, rechts
        * steht das offene - dieselbe Anordnung wie Menü und Inhalt eine Ebene
        * höher, nur innerhalb des Fensters.
        */}
      {fenster.art === 'mandant' && draft && (
        <Modal
          title={draft.id ? draft.name.trim() || 'Mandant ohne Namen' : 'Neuer Mandant'}
          ownActions
          geteilt
          breit
          onClose={zurueckZurListe}
        >
          {error && <Notice kind="error">{error}</Notice>}

          <div className="fenster__mitte">
            <div className="mandant">
              {/*
                * Die Blätter zur Wahl.
                *
                * Sie standen zuletzt als Unterpunkte in der Seitenleiste. Dort
                * war es eine Ebene zu hoch: Sie gehören zu *einem* Mandanten,
                * und die Seitenleiste gilt für die ganze Anwendung. Wer sie dort
                * sah, sah eine Navigation, die sich änderte, je nachdem was er
                * zuletzt aufgeschlagen hatte.
                */}
              <nav className="blattwahl">
                {(draft.id ? [...STAMMBLAETTER, ...DATENBLAETTER] : STAMMBLAETTER).map((eintrag) => (
                  <Fragment key={eintrag.id}>
                    {eintrag.trennerDavor && <div className="blattwahl__trenner" aria-hidden="true" />}
                    <button
                      className={
                        blatt === eintrag.id ? 'blattwahl__punkt blattwahl__punkt--an' : 'blattwahl__punkt'
                      }
                      onClick={() => onBlatt(eintrag.id)}
                    >
                      {eintrag.text}
                    </button>
                  </Fragment>
                ))}
              </nav>

              <div className="mandant__blatt">

          {/*
            * Drei Blätter für den Mandanten selbst — sie beantworten drei Fragen:
            *
            * ```text
            * Grunddaten         wer er ist, und ob er läuft
            * Einstellungen      wie er rechnet und wie lange er aufbewahrt
            * Benachrichtigung   wer davon erfährt
            * ```
            *
            * Name, Beschreibung und Region trägt jeder Mandant, und sie sind
            * beim Anlegen in einer Minute ausgefüllt. Der Haken „ist aktiv"
            * gehört dazu: Ob dieser Mandant überhaupt läuft, ist eine Aussage
            * über ihn und keine Einstellung.
            *
            * Alles im zweiten Blatt hat eine Voreinstellung und wird selten
            * geändert. Das Root-Verzeichnis steht dort an erster Stelle: Es
            * beschreibt nicht den Kunden, sondern begrenzt ihn — und ist die
            * folgenreichste Angabe des ganzen Blattes.
            */}
          {blatt === 'grunddaten' && (
            <section className="card">
              <h2>Grunddaten</h2>

              <div className="field-paar field-paar--namen">
                <Field label="Mandanten-Name">
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
                </Field>

                {/*
                  * Die Beschreibung darf mehr sein als eine Zeile.
                  *
                  * Sie ist die einzige Stelle am Mandanten, an der etwas stehen
                  * darf, das Unikom nicht auswertet: der Ansprechpartner, die
                  * Abrechnungsart, warum dieser Kunde eine eigene Region hat. Ein
                  * Feld, das eine Zeile fasst, hätte all das auf eine Zeile
                  * gezwungen — und wer es trotzdem hineinschriebe, verlöre den
                  * Rest beim nächsten Anfassen.
                  *
                  * In der Zeile steht deshalb nur ihr Anfang; geschrieben wird im
                  * Fenster hinter dem Stift.
                  */}
                <Memofeld
                  label="Mandanten-Beschreibung"
                  value={draft.description}
                  onChange={(description) => setDraft((jetzt) => (jetzt ? { ...jetzt, description } : jetzt))}
                />
              </div>

              {/*
                * Die Region entscheidet, wie Datums- und Zeitangaben dieses
                * Mandanten gelesen werden. Sie steht hier und nicht in den
                * Einstellungen: Ein Dienstleister holt Daten für mehrere eigene
                * Kunden, und `04/03/2026` ist beim einen der 4. März und beim
                * anderen der 3. April — beide Lesarten gelingen, keine meldet einen
                * Fehler.
                *
                * Die Zeitzone steht daneben, weil sie dieselbe Frage
                * weiterbeantwortet: Beide zusammen sagen, wie ein Zeitpunkt aus
                * diesem Haus zu lesen ist.
                */}
              <div className="field-paar field-paar--rechts-fest">
                <Field
                  label="Region"
                  explain={`So schreibt dieser Mandant den 3. April 2026: ${previewOf(draft.locale, draft.timeZone).sample} - ${previewOf(draft.locale, draft.timeZone).order}.`}
                >
                  <select
                    className="input--wahl-lang"
                    value={draft.locale}
                    {...titelBeiUeberlaufWahl()}
                    onChange={(event) => setDraft({ ...draft, locale: event.target.value })}
                  >
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
                  <select
                    className="input--wahl"
                    style={{ minWidth: ZONEN_BREITE }}
                    value={draft.timeZone}
                    onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                  >
                    {!timeZones().includes(draft.timeZone) && <option value={draft.timeZone}>{draft.timeZone}</option>}
                    {timeZones().map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/*
                * Ob dieser Mandant überhaupt läuft, gehört zu ihm und nicht zu
                * seinen Einstellungen. Er stand am Ende der zweiten Fläche,
                * hinter Fristen, Konfliktumgang und Meldewegen — die
                * folgenreichste Angabe des Mandanten an der Stelle, die man
                * zuletzt liest.
                */}
              <CheckField
                label="Mandant ist aktiv"
                checked={draft.enabled}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </section>
          )}

          {blatt === 'einstellungen' && (
            <section className="card">
              <h2>Einstellungen</h2>

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

              <Konsolidierungseinstellungen
                draft={draft}
                voreinstellungen={tenants.data?.find((eintrag) => eintrag.id === draft.id)?.voreinstellungen}
                onChange={setDraft}
              />

              {/*
                * Zwei Fristen nebeneinander, weil sie zusammen gelesen werden: Wer
                * die eine einstellt, will die andere daneben sehen. Und weil beide
                * dieselbe Null bedeuten — abgeschaltet —, wäre es die schlechteste
                * Stelle, sie auseinanderzuziehen.
                */}
              <div className="field-paar">
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

                <Field
                  label="Archiv aufbewahren (Tage)"
                  explain={
                    <>
                      <p>
                        Die Eingangsdateien im Original, verschlüsselt - das, was der Lieferant geschickt hat. Leer
                        heißt 90 Tage; <strong>0 heißt: nie forträumen</strong>, dieselbe Bedeutung wie nebenan.
                      </p>
                      <p>
                        Länger voreingestellt als die Ausleitungen, weil es etwas anderes ist: Eine Ausleitung ist
                        eine Abschrift zum Bearbeiten, das Archiv ist das Original.
                      </p>
                      <p className="muted">
                        Beides bedenken: Ein Archiv hält Kundendaten, und je länger es das tut, desto größer ist
                        der Schaden, wenn jemand hineinkommt. Zu kurz gesetzt fehlt die Antwort auf „was kam damals
                        eigentlich herein".
                      </p>
                    </>
                  }
                >
                  <input
                    type="number"
                    min={0}
                    value={draft.archivTage}
                    placeholder="90"
                    onChange={(event) => setDraft({ ...draft, archivTage: event.target.value })}
                  />
                </Field>
              </div>

              <Konfliktumgang
                draft={draft}
                voreinstellung={tenants.data?.find((eintrag) => eintrag.id === draft.id)?.konflikteVoreinstellung}
                onChange={setDraft}
              />
            </section>
          )}

          {/*
            * Ein eigenes Blatt für die Meldungen.
            *
            * Sie beantworten eine Frage, die mit den übrigen Einstellungen
            * nichts zu tun hat: **wer erfährt davon.** Zwischen
            * Aufbewahrungsfristen und Konfliktumgang standen sie da wie ein
            * Nachtrag — dabei sind sie das Einzige daran, das nach draußen wirkt.
            */}
          {blatt === 'benachrichtigung' && (
            <section className="card">
              <h2>Benachrichtigung</h2>

              <Meldewege draft={draft} credentials={credentials.data ?? []} onChange={setDraft} />
            </section>
          )}

          {/*
            * Was dieser Kunde liefert — sechs Blätter, die vorher als eigene
            * Punkte im Hauptmenü standen.
            *
            * Sie brauchen alle dasselbe: die Kennung des Mandanten. Vorher holte
            * sich jeder von ihnen die Mandantenliste und eine eigene Auswahl
            * darüber — sechsmal dieselbe Frage, sechsmal einzeln zu beantworten.
            * Jetzt steht die Antwort einmal oben.
            *
            * `draft.id` wird geprüft, statt behauptet zu werden.
            *
            * Hier stand `draft.id as string` mit dem Hinweis, das Menü biete
            * diese Blätter nur bei einem gespeicherten Mandanten an. Das stimmte,
            * solange die Reiter danebenstanden und beim Öffnen zurückgesetzt
            * wurden. Seit die Wahl in der Seitenleiste liegt, überdauert sie den
            * Wechsel: Wer auf „Archiv" steht und dann „Neuer Mandant" wählt,
            * käme mit `blatt === 'archiv'` an - und die Zusicherung wäre eine
            * Behauptung über etwas, das inzwischen woanders entschieden wird.
            *
            * Mit `draft.id &&` prüft der Übersetzer mit, und die Zusicherung
            * fällt fort. Eine Prüfung, die nichts kostet, ist besser als ein
            * Kommentar, der eine Garantie beschreibt, die drei Dateien weiter
            * gegeben wird.
            */}
          {draft.id && blatt === 'quellen' && <SchemataScreen mandant={draft.id} />}
          {draft.id && blatt === 'einlesen' && <DiscoveryScreen mandant={draft.id} />}
          {draft.id && blatt === 'zuordnungen' && <MappingScreen mandant={draft.id} />}
          {draft.id && blatt === 'referenzen' && <ReferenceScreen mandant={draft.id} />}
          {draft.id && blatt === 'probe' && <MergeScreen mandant={draft.id} />}
          {draft.id && blatt === 'archiv' && <ArchivScreen mandant={draft.id} />}

              </div>
            </div>
          </div>

          {/*
            * Die Knöpfe stehen unter allen Blättern und in keinem: Sie speichern
            * den **Mandanten** - Name, Einstellungen, Meldewege. Was auf den
            * übrigen Blättern steht, sind eigene Bestände mit eigenen Knöpfen;
            * eine Eingangsquelle ist gespeichert, sobald man sie speichert.
            *
            * Sie bleiben trotzdem auf jedem Blatt stehen. Ein Fuß, der beim
            * Blattwechsel verschwände, warf die Frage auf, was aus dem wird, was
            * man oben getippt hat - der Entwurf überlebt den Wechsel, und der
            * Fuß sagt genau das.
            *
            * „Speichern" und nicht „OK": Der Knopf schreibt etwas fort. OK
            * beantwortet eine Frage, und die Frage dieses Fensters ist nicht,
            * ob man es gesehen hat.
            */}
          <div className="row modal__actions">
            <button disabled={saving || !draft.name} onClick={() => void save()}>
              {saving ? 'Wird gespeichert …' : 'Speichern'}
            </button>
            <button className="secondary" onClick={zurueckZurListe}>
              Abbrechen
            </button>
          </div>
        </Modal>
      )}

      {/*
        * Die Erklärung steht zuletzt, und das ist keine Willkür.
        *
        * Sie öffnet sich aus dem Mandantenfenster heraus und muss deshalb über
        * ihm liegen. Beide tragen denselben z-Wert; bei gleichem Wert gewinnt,
        * was später im Dokument steht. Stünde sie oben - wo sie war, solange
        * der Mandant noch eine Seite war -, klappte der Info-Knopf etwas auf,
        * das hinter dem Fenster verschwindet.
        */}
      {explaining && (
        <Modal title="Root-Verzeichnis" onClose={() => setExplaining(false)}>
          <p>
            Jeder Job dieses Mandanten darf seine Dateien nur <strong>unterhalb dieses Ordners</strong> ablegen. Ein
            Zielverzeichnis außerhalb wird beim Speichern abgelehnt - so landen die Daten dieses Kunden auch bei einem
            Tippfehler nicht beim nächsten.
          </p>
          <p>
            Leer lassen, wenn Sie nur eigene Daten verarbeiten. Dann gibt es niemanden, mit dem etwas verwechselt werden
            könnte.
          </p>
        </Modal>
      )}
    </>
  );
}

/**
 * Wie dieser Mandant mit offenen Konflikten umgeht.
 *
 * Am Mandanten und nicht an der Installation, aus demselben Grund wie die
 * Meldewege darunter: Der eine Kunde will am Morgen über jeden offenen Fall
 * stolpern, bis er ihn entschieden hat; der nächste arbeitet eine Liste ab und
 * will dabei nicht alle zehn Minuten ein Fenster wegklicken.
 *
 * Die Frist steht **neben** der Vorlage und nur dort, wo sie gilt.
 *
 * Untereinander wäre das Verschwinden eine Zumutung: Alles darunter rückte bei
 * jedem Umschalten eine Zeile hoch und wieder herunter. In derselben Zeile
 * rückt nichts — die rechte Hälfte wird leer, mehr geschieht nicht.
 *
 * Und abgeblendet stehen zu bleiben war die schlechtere Wahl: Ein Feld, das
 * bei zwei von drei Einstellungen nichts bewirkt, ist zwei von drei Malen eine
 * Frage, die niemand beantworten soll. Der eingetippte Wert bleibt trotzdem
 * erhalten — wer zurückschaltet, findet ihn wieder.
 */
function Konfliktumgang({
  draft,
  voreinstellung,
  onChange,
}: {
  draft: Draft;
  voreinstellung?: { wiedervorlageStunden: number };
  onChange(next: Draft): void;
}) {
  return (
    <>
      <h3>Offene Konflikte</h3>

      <div className="field-paar">
        <Field
          label="Vorlage"
          explain={
            <>
              <p>
                Ein Konflikt entsteht um zwei Uhr nachts, und niemand sitzt davor. Was dann geschieht, steht hier.
              </p>
              <p>
                <strong>Einmal</strong> zeigt ihn einmal; danach steht er nur noch in der Glocke.{' '}
                <strong>Wiedervorlage</strong> zeigt ihn nach Ablauf der Frist erneut.{' '}
                <strong>Bei jedem Öffnen</strong> zeigt ihn bei jedem Wechsel der Ansicht, bis er entschieden ist.
              </p>
              <p>
                Ein Fenster, das immer kommt, wird nach der dritten Woche weggeklickt, ohne gelesen zu werden.
                Deshalb ist die Wiedervorlage voreingestellt - und nicht das lauteste.
              </p>
            </>
          }
        >
          <select
            className="input--wahl"
            value={draft.konfliktVorlage}
            onChange={(event) => onChange({ ...draft, konfliktVorlage: event.target.value as Vorlageart })}
          >
            <option value="EINMAL">Einmal zeigen</option>
            <option value="WIEDERVORLAGE">Wiedervorlage nach Frist</option>
            <option value="BEI_JEDEM_OEFFNEN">Bei jedem Öffnen zeigen</option>
          </select>
        </Field>

        {/* Nur, wo sie etwas bewirkt — die Zeile bleibt, die Hälfte wird leer. */}
        {draft.konfliktVorlage === 'WIEDERVORLAGE' && (
          <Field
            label="Wiedervorlage nach (Stunden)"
            explain="Wie lange Ruhe ist, nachdem ein Fall jemandem gezeigt wurde. Leer heißt: Voreinstellung."
          >
            <input
              type="number"
              min={1}
              value={draft.wiedervorlageStunden}
              placeholder={String(voreinstellung?.wiedervorlageStunden ?? 24)}
              onChange={(event) => onChange({ ...draft, wiedervorlageStunden: event.target.value })}
            />
          </Field>
        )}
      </div>

      <Field
        label="Lieferung mit fehlerhaften Zeilen"
        explain={
          <>
            <p>
              Was geschieht, wenn einzelne Zeilen dem Schema nicht genügen - eine fehlende Kundennummer, ein
              Datum, das es nicht gibt.
            </p>
            <p>
              <strong>Ganz stehen lassen</strong> verarbeitet die Datei gar nicht; sie wandert vollständig nach
              „Gescheitert". <strong>In Teile zerlegen</strong> lässt die guten Zeilen weiterlaufen und legt die
              schlechten als eigene Datei nach „Gescheitert" - mit Zeilennummer und Grund, damit sie sich
              korrigieren und zurückgeben lässt.
            </p>
            <p>
              Voreingestellt ist „ganz stehen lassen". Wer aus dreitausend Zeilen 2.983 bekommt und es nicht
              weiß, bucht einen Monatsabschluss auf unvollständigen Daten - das darf niemandem zustoßen, der
              nichts eingestellt hat.
            </p>
            <p className="muted">
              Zum Zerlegen braucht der Durchgang ein Verzeichnis für Gescheitertes. Fehlt es, bleibt die Lieferung
              ganz stehen, und der Lauf sagt es.
            </p>
          </>
        }
      >
        <select
          className="input--wahl"
          value={draft.auslieferung}
          onChange={(event) => onChange({ ...draft, auslieferung: event.target.value as Auslieferungsart })}
        >
          <option value="NUR_VOLLSTAENDIG">Ganz stehen lassen</option>
          <option value="IN_TEILEN">In Teile zerlegen</option>
        </select>
      </Field>

      <CheckField
        label="Konflikte dürfen hingenommen werden"
        explain={
          <>
            <p>
              „Akzeptieren" heißt: den Konflikt sehenden Auges stehen lassen. Das verschwindet nicht
              stillschweigend - es steht mit Name, Zeitpunkt und Bemerkung in der Historie des Falls.
            </p>
            <p>
              Abgeschaltet bleibt jeder Fall offen, bis jemand ihn bereinigt. Genau das ist der Zweck: Wer keinen
              Mülleimer haben will, bekommt keinen.
            </p>
          </>
        }
        checked={draft.akzeptierenErlaubt}
        onChange={(akzeptierenErlaubt) => onChange({ ...draft, akzeptierenErlaubt })}
      />
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
      {/*
        * Keine eigene Überschrift mehr: Die Fläche heißt „Benachrichtigung",
        * und darin „Benachrichtigung per E-Mail" zu wiederholen sagt dasselbe
        * zweimal. Kommt eines Tages ein zweiter Weg dazu, bekommt jeder von
        * beiden seine — vorher wäre sie eine Gliederung für einen einzigen
        * Punkt.
        */}
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
            explain="Ohne Häkchen kommt nur Post, wenn etwas ansteht oder schiefging - für einen Lauf, den niemand beobachtet, lohnt sich das Häkchen."
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
              <option value="KEINE">Keine - nur im eigenen Netz</option>
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
            explain="Benutzer und Kennwort stehen in den Zugängen, nicht hier. Ohne Zugang wird ohne Anmeldung versandt - das geht nur im eigenen Netz."
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
function konflikteAus(tenant: Tenant): Pick<
  Draft,
  'konfliktVorlage' | 'wiedervorlageStunden' | 'akzeptierenErlaubt' | 'auslieferung'
> {
  const konflikte = tenant.konflikte;

  return {
    konfliktVorlage: konflikte?.vorlage ?? EMPTY.konfliktVorlage,
    wiedervorlageStunden:
      konflikte?.wiedervorlageStunden === undefined ? '' : String(konflikte.wiedervorlageStunden),
    /*
     * `?? true` und nicht `=== true`: Ein Mandant ohne Eintrag hat nichts
     * verboten. Andersherum gälte für jeden bestehenden Kunden ab dem nächsten
     * Start ein Verbot, das niemand ausgesprochen hat.
     */
    akzeptierenErlaubt: konflikte?.akzeptierenErlaubt ?? true,
    auslieferung: konflikte?.auslieferung ?? EMPTY.auslieferung,
  };
}

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
        explain="Durch Komma getrennt. Was hier steht, zählt beim Einlesen als leeres Feld - und nicht als Inhalt, der die Vollständigkeitsprüfung bestehen lässt."
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

      {/*
        * Beide Angaben in einer Zeile: Die eine sagt, wie viele Werte geprüft
        * werden — die andere, worauf erweitert wird, wenn das nicht reicht. Erst
        * zusammen ergeben sie eine Aussage, und untereinander lasen sie sich wie
        * zwei unabhängige Zahlen.
        */}
      <div className="field-paar">
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
      </div>

      <Field
        label="Mindestkonfidenz"
        explain="Ab welchem Anteil passender Werte ein Feldtyp als sicher gilt. Sie lockert nur die Typerkennung - ob Unikom einen Wertekonflikt selbst entscheiden darf, bleibt bei 0,97, gleich was hier steht."
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
