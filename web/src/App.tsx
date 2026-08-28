import { Fragment, useEffect, useRef, useState } from 'react';

import { api } from './api/client.js';

import { useAuswahlschliesser } from './components/Auswahlschliesser.js';
import { Meldungen } from './components/Meldungen.js';
import { useText } from './i18n/useText.js';
import type { TextKey } from './i18n/texts.js';
import { ChangePasswordScreen } from './screens/ChangePasswordScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { ImprintScreen } from './screens/ImprintScreen.js';
import { JobsScreen } from './screens/JobsScreen.js';
import { HistoryScreen } from './screens/history/HistoryScreen.js';
import { JobEditorScreen } from './screens/job/JobEditorScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { PrivacyScreen } from './screens/PrivacyScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { TenantsScreen, type Blatt, type Mandantenfenster } from './screens/TenantsScreen.js';
import { UsersScreen } from './screens/UsersScreen.js';
import { DataEnquiryScreen } from './screens/DataEnquiryScreen.js';
import { ConsolidationScreen } from './screens/ConsolidationScreen.js';
import { WorkflowsScreen } from './screens/WorkflowsScreen.js';
import { Sprachwahl } from './components/Sprachwahl.js';
import { useSession } from './session/useSession.js';
import { HEADER_ACTIONS, Notice } from './components/Pieces.js';
import type { Handlungsbedarf, Licence, Permission } from './api/types.js';

/**
 * Wie oft die Zahl neben „Handlungsbedarf" nachgeholt wird.
 *
 * Zwei Minuten: Ein Konflikt entsteht im Lauf, und Läufe laufen nachts oder
 * stundenweise — sekundengenau muss die Zahl nicht sein. Sie soll nur nicht
 * eine halbe Stunde lang etwas anderes behaupten, als der Bildschirm dahinter
 * zeigt.
 */
const BEDARF_HOLEN_ALLE_MS = 120_000;

/** Alles außer „gilt" und „wird nicht geprüft" gehört auf den Bildschirm. */
function needsAttention(licence: Licence): boolean {
  return licence.state !== 'ACTIVE' && licence.state !== 'UNLICENSED';
}

interface Area {
  id: string;
  /** Der Schlüssel im Wortbestand — nicht der Text selbst. */
  label: TextKey;
  /** Hidden without it. The server refuses regardless; this only tidies up. */
  permission: Permission;
}

/**
 * Vier Gruppen, zwischen ihnen je eine Linie: der Überblick, die laufende
 * Arbeit, für wen sie läuft, und wer das alles verwaltet.
 *
 * Schlüssel und Zugänge stehen nicht hier. Sie gehören dorthin, wo die Aufgabe
 * festgelegt wird — in den Workflow —, denn sie ändern sich im Takt des Auftrags
 * und nicht im Takt der Installation. Angelegt werden sie deshalb im Editor,
 * gemerkt bleiben sie für jeden weiteren Workflow, und eine zweite Liste an
 * anderer Stelle gibt es bewusst nicht. Aus demselben Grund steht hier nichts über FTP, SFTP,
 * Verzeichnisse, Datenbanken oder Exporte: das ist die Einrichtung eines
 * einzelnen Workflows, keine Gegend der Anwendung.
 */
const BLOCKS: Area[][] = [
  [{ id: 'dashboard', label: 'nav.dashboard', permission: 'VIEW' }],
  [
    { id: 'jobs', label: 'nav.jobs', permission: 'VIEW' },
    { id: 'history', label: 'nav.history', permission: 'VIEW' },
    { id: 'workflows', label: 'nav.workflows', permission: 'VIEW' },
    /*
     * „Handlungsbedarf" und nicht „Daten konsolidieren".
     *
     * Der Modulname benennt die Tätigkeit, die schon vorbei ist — konsolidiert
     * wurde nachts, ohne Zuschauer. Was hier liegt, ist das, was die Maschine
     * **nicht** entscheiden durfte: ein Konflikt, den ein Mensch entscheidet,
     * und ein Ergebnis, das ein Mensch freigibt.
     *
     * Der Modulname steht deshalb, wo er hingehört: auf der Lizenzseite und am
     * Workflow-Schritt. Der Punkt erscheint, **weil** das Modul gekauft ist;
     * heißen muss er deswegen nicht so.
     */
    { id: 'consolidation', label: 'nav.consolidation', permission: 'MANAGE_JOBS' },
  ],
  /*
   * Ein einziger Punkt für den Kunden — und alles, was ihn betrifft, darin.
   *
   * Hier standen einmal drei: Mandanten, Schemata, Archiv. Dazu im Block darüber
   * „Daten konsolidieren" mit vier weiteren Bildschirmen. Alle sieben fragten
   * als Erstes „für welchen Kunden?" — und das ist der Beweis, dass sie zu ihm
   * gehören und nicht neben ihn: Was zuerst nach einem Kunden fragt, ist ein
   * Bildschirm dieses Kunden.
   *
   * Das Menü war nach **Modulen** gegliedert, also danach, was auf der Rechnung
   * steht. Ein Modul ist aber eine Position im Preisverzeichnis und kein Ort im
   * Haus. Sie stehen jetzt als Reiter am Mandanten — siehe `TenantsScreen`.
   */
  [{ id: 'tenants', label: 'nav.tenants', permission: 'VIEW' }],
  [
    { id: 'users', label: 'nav.users', permission: 'MANAGE_USERS' },
    { id: 'enquiry', label: 'nav.enquiry', permission: 'MANAGE_USERS' },
    { id: 'settings', label: 'nav.settings', permission: 'MANAGE_USERS' },
  ],
];

/** Steht ganz unten, gehört zu keinem Bereich und verlangt kein Recht. */
const PAGES: { id: string; label: TextKey }[] = [
  { id: 'privacy', label: 'nav.privacy' },
  { id: 'imprint', label: 'nav.imprint' },
];

/**
 * Ob ein Bereich gerade mehr Inhalt hat, als hineinpasst.
 *
 * Die Linien ober- und unterhalb des Bildlaufs sollen nur da sein, wenn es
 * etwas zu scrollen gibt — eine Linie, die nichts abgrenzt, ist Dekoration. CSS
 * kann das nicht sehen: Es gibt keine Bedingung „läuft über".
 *
 * Der erste Effekt hat bewusst kein Abhängigkeitsfeld und läuft nach jedem
 * Durchlauf. So merkt er es auch, wenn React neuen Inhalt eingesetzt hat. Eine
 * Schleife entsteht daraus nicht: Setzt man denselben Wert, zeichnet React
 * nicht neu. Der zweite fängt ab, was ohne Durchlauf passiert — ein Fenster,
 * das kleiner gezogen wird.
 */
function useOverflowing(reference: React.RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const node = reference.current;

    if (node) {
      // Ein Pixel Toleranz: Gebrochene Höhen ergeben sonst einen Überlauf,
      // den niemand scrollen kann.
      setOverflowing(node.scrollHeight > node.clientHeight + 1);
    }
  });

  useEffect(() => {
    const node = reference.current;

    if (!node) {
      return;
    }

    const observer = new ResizeObserver(() =>
      setOverflowing(node.scrollHeight > node.clientHeight + 1)
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reference]);

  return overflowing;
}

/**
 * Die Zahl neben „Handlungsbedarf" — über alle Mandanten.
 *
 * Sie kommt aus einer eigenen Route und nicht aus den Bildschirmen dahinter:
 * Die liefern ganze Listen samt Datensätzen und kennen je einen Mandanten. Für
 * eine Zahl, die alle zwei Minuten neu geholt wird, wäre das die falsche Menge
 * über die Leitung — und die Schleife über die Mandanten stünde im Browser.
 *
 * Ein Fehlschlag bleibt still. Wenn die Zahl nicht zu holen ist, ist die
 * richtige Anzeige **keine** Zahl — eine Null zu zeigen hieße zu behaupten, es
 * liege nichts an, und das wäre die eine Auskunft, die niemand nachprüft.
 */
function useHandlungsbedarf(): Handlungsbedarf | undefined {
  const [bedarf, setBedarf] = useState<Handlungsbedarf>();

  useEffect(() => {
    let gilt = true;

    const holen = (): void => {
      void api
        .get<Handlungsbedarf>('/api/handlungsbedarf')
        .then((antwort) => gilt && setBedarf(antwort))
        .catch(() => gilt && setBedarf(undefined));
    };

    holen();
    const takt = setInterval(holen, BEDARF_HOLEN_ALLE_MS);

    return () => {
      gilt = false;
      clearInterval(takt);
    };
  }, []);

  return bedarf;
}

/** Which screen is open. Deliberately plain state, not a routing library. */
type View = { area: string; editingJob?: string; historyJob?: string };

/**
 * Ein Menüpunkt (FR-011 §4).
 *
 * Als Funktion und nicht als zwei Zeichenketten im Markup: Der Punkt kommt an
 * drei Stellen vor - Bereiche, Abmelden, Rechtliches -, und drei Abschriften
 * derselben Kette laufen beim ersten Eingriff auseinander.
 *
 * Kein Symbol vor dem Wort, keine runde Ecke, kein Rahmen ringsum. Was den
 * aktiven Punkt anzeigt, ist eine Kante von zwei Pixeln links und eine etwas
 * hellere Fläche. `border-l-2` steht deshalb auch im Ruhezustand da, nur
 * durchsichtig - sonst rückte das Wort um zwei Pixel, sobald man es anwählt.
 *
 * `text-transform` und Schriftart müssen ausdrücklich zurückgesetzt werden: Die
 * Grundregel für `button` im Altbestand macht aus jedem Knopf Versalien in
 * Festbreitenschrift. Sie fällt, wenn der letzte Bildschirm umgestellt ist.
 */
function navItemClass(aktiv: boolean): string {
  const basis =
    'sw-nav-hl block h-auto w-full min-w-0 rounded-none border-0 border-l-2 py-2 pl-[calc(0.75rem-2px)] pr-3' +
    ' text-left text-sm font-medium normal-case leading-snug tracking-normal shadow-none font-sans' +
    ' bg-transparent transition-colors';

  return aktiv
    ? `${basis} sw-nav-hl-active border-l-white text-white`
    : `${basis} border-l-transparent text-white/80 hover:text-white`;
}

export function App() {
  /*
   * Eine offene Auswahlliste schließt sich, sobald der Zeiger fortgeht — für
   * die ganze Anwendung und nicht je Feld. Sie liegt über der Fläche und
   * verdeckt, was darunter steht; wer woanders hinsieht, soll sie nicht erst
   * wegklicken müssen.
   */
  useAuswahlschliesser();

  const session = useSession();
  const t = useText();
  const [view, setView] = useState<View>({ area: 'dashboard' });
  /**
   * Welches Mandantenfenster offen ist - und welches Blatt darin.
   *
   * Beides steht hier und nicht im Bildschirm: Aufgeschlagen wird aus dem
   * Hauptmenü heraus, und das Menü steht hier. `undefined` heißt geschlossen;
   * dann ist der Mandantenbildschirm gar nicht erst da.
   */
  const [fenster, setFenster] = useState<Mandantenfenster>();
  const [blatt, setBlatt] = useState<Blatt>('grunddaten');
  const body = useRef<HTMLDivElement>(null);
  const bodyScrolls = useOverflowing(body);
  const bedarf = useHandlungsbedarf();
  const area = view.area;
  const setArea = (next: string): void => setView({ area: next });

  if (session.state.status === 'loading') {
    return <div className="empty">Wird geladen …</div>;
  }

  if (session.state.status === 'anonymous') {
    return <LoginScreen onLogin={session.login} onChangePassword={session.changePasswordAtLogin} />;
  }

  const { identity } = session.state;

  // A handed-out password may do exactly one thing. Showing anything else
  // would only lead to a screen where every action is refused.
  if (identity.mustChangePassword) {
    return (
      <ChangePasswordScreen
        forced
        displayName={identity.user.displayName}
        onChange={({ current, next }) => session.changePassword(current, next)}
      />
    );
  }

  // Erst die einzelnen Punkte prüfen, dann leere Gruppen fallen lassen: sonst
  // stünde für eine Rolle, die eine ganze Gruppe nicht sieht, eine Trennlinie
  // ohne etwas dahinter.
  const blocks = BLOCKS.map((entries) => entries.filter((entry) => session.may(entry.permission))).filter(
    (entries) => entries.length > 0
  );
  const visible = blocks.flat();
  const current = PAGES.find((entry) => entry.id === area) ?? visible.find((entry) => entry.id === area) ?? visible[0];
  const canManageCredentials = session.may('MANAGE_CREDENTIALS');

  /**
   * „Mandanten" führt nicht auf eine Seite, sondern schlägt ein Fenster auf.
   *
   * Ein Mandant ist nichts, was man ansieht - er ist etwas, das man aufschlägt:
   * heraussuchen, daran arbeiten, wieder weglegen. Deshalb bleibt der
   * Bildschirm dahinter stehen, und der Punkt bleibt hervorgehoben, solange das
   * Fenster offen ist.
   */
  const oeffnetFenster = (id: string): boolean => id === 'tenants';

  const waehle = (id: string): void => {
    if (oeffnetFenster(id)) {
      setFenster({ art: 'liste' });
    } else {
      setArea(id);
    }
  };

  return (
    <div className="app-shell-root relative isolate flex min-h-dvh w-full max-w-full flex-col overflow-x-clip overflow-y-auto md:h-dvh md:min-h-0 md:flex-row md:overflow-hidden">
      <div className="app-shell-sidebar relative z-50 flex w-full shrink-0 flex-col overflow-visible border-b md:h-full md:min-h-0 md:w-[var(--app-shell-sidebar-width)] md:overflow-hidden md:border-b-0">
        {/*
          * Das Logo-Band. Es ist die linke Hälfte der Kopfzeile und holt seine
          * Höhe aus derselben Marke wie die Kopfleiste rechts daneben - nur so
          * fluchtet die Kante darunter über die ganze Breite.
          */}
        <div className="app-shell-brand-header relative flex h-[var(--app-shell-brand-band-height)] max-h-[var(--app-shell-brand-band-height)] min-h-[var(--app-shell-brand-band-height)] shrink-0 items-center gap-2.5 py-0 pl-4 pr-3">
          <p className="app-shell-brand-wordmark">Unikom</p>
        </div>

        {/*
         * Zwischen Schriftzug und Menü ist der Platz für den späteren globalen
         * Mandantenfilter ("Alle Mandanten ▼"): oberhalb von allem, was er
         * einschränkt. Er soll erst erscheinen, wenn es mehr als einen
         * Mandanten gibt — bei einem wäre es eine Auswahl ohne Wahl. Bis dahin
         * steht hier nichts, damit das Menü ruhig bleibt.
         */}

        <div className="app-shell-sidebar-scroll relative z-10 flex w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto px-0 pb-0 pt-0 max-md:shrink-0 max-md:flex-none md:min-h-0 md:flex-1">
          <nav className="flex min-h-full w-full flex-1 flex-col">
            {/*
              * Das Menü. Es malt sich schwarz; das Logo-Band darüber bleibt blau.
              */}
            <div className="app-shell-sidebar-nav-menu relative isolate shrink-0 py-2">
              <div className="flex flex-col gap-0.5">
                {blocks.map((entries, index) => (
                  <Fragment key={entries[0].id}>
                    {index > 0 && <div className="app-shell-sidebar-nav-divider" aria-hidden="true" />}
                    {entries.map((entry) => {
                      const aktiv = oeffnetFenster(entry.id) ? fenster !== undefined : entry.id === current?.id;

                      return (
                        <button key={entry.id} className={navItemClass(aktiv)} onClick={() => waehle(entry.id)}>
                          {/*
                            * Hier stand einmal die Zahl des Ausstehenden in
                            * Klammern hinter dem Wort. Sie steht jetzt an der
                            * Glocke im Kopfband, zusammen mit den Meldungen:
                            * Zwei Zähler für dieselbe Sache an zwei Orten sind
                            * einer zu viel - und der eine, den jemand später zu
                            * ändern vergisst, widerspricht dann dem anderen.
                            */}
                          {t(entry.label)}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}

                <div className="app-shell-sidebar-nav-divider" aria-hidden="true" />

                {/* Abmelden ist eine Handlung und steht deshalb beim Menü, nicht beim Fuß. */}
                <button className={navItemClass(false)} onClick={() => void session.logout()}>
                  {t('nav.signOut')}
                </button>
              </div>
            </div>

            {/*
              * Der freie Platz zwischen Menü und Fuß. Er trägt den Verlauf von
              * Schwarz in die helle Panelfarbe und wächst über das, was übrig
              * ist - auf einem hohen Bildschirm lang, auf einem flachen kaum.
              */}
            <div className="app-shell-sidebar-nav-underflow relative isolate min-h-0 flex-1" aria-hidden="true" />

            {/*
              * Datenschutz und Impressum sind Seiten und stehen am Fuß.
              *
              * Sie standen einmal im selben Fluss wie die Menüpunkte, weil sie
              * am unteren Rand einer hohen Leiste weit fortwandern. Mit dem
              * Verlauf darüber ist der Weg dorthin jetzt sichtbar gezeichnet -
              * und ein Rechtliches, das zwischen den Arbeitsbereichen steht,
              * nimmt dort Platz, den es nicht braucht.
              */}
            <div className="app-shell-sidebar-nav-legal relative isolate shrink-0 pb-2 pt-1">
              {PAGES.map((page) => (
                <button
                  key={page.id}
                  className={navItemClass(page.id === current?.id)}
                  onClick={() => setArea(page.id)}
                >
                  {t(page.label)}
                </button>
              ))}

              <div className="build-stamp">
                {t('nav.build')} {__UNIKOM_BUILD__}
              </div>
            </div>
          </nav>
        </div>
      </div>

      {/*
        * Der Editor füllt die Höhe selbst aus und scrollt in seinem mittleren
        * Teil. Deshalb gibt der Inhaltsbereich hier seinen eigenen Bildlauf ab
        * — sonst liefe der Inhalt unter der Knopfleiste durch, statt über ihr
        * zu enden.
        */}
      <div className="app-shell-content-column flex min-w-0 flex-col overflow-x-clip max-md:flex-none md:min-h-0 md:flex-1">
        {/*
          * Das Kopfband steht auf jedem Bildschirm, auch im Editor.
          *
          * Es war einmal der Kopf einer Ansicht und fiel deshalb fort, sobald
          * der Editor seinen eigenen mitbrachte. Ein Band, das an einer Stelle
          * fehlt, ist aber kein Rahmen mehr - und mit ihm verschwänden Glocke
          * und Sprache genau dort, wo man am längsten sitzt. Der Kopf des
          * Editors steht jetzt darunter; er nennt den Workflow und die Kette
          * der Schritte, und das ist etwas anderes als der Name des Bereichs.
          */}
        <header className="app-page-toolbar-header flex h-[var(--app-shell-brand-band-height)] max-h-[var(--app-shell-brand-band-height)] min-h-[var(--app-shell-brand-band-height)] w-full min-w-0 shrink-0 flex-row items-stretch px-0">
          {/*
            * Eine Zeile in Segmenten, getrennt durch Linien über die volle
            * Bandhöhe. Sie ist so breit wie ihr Inhalt und mindestens so breit
            * wie das Band - wird es eng, rollt sie waagerecht, statt umzubrechen.
            */}
          <div className="planning-toolbar-scroll-row">
            <div className="flex h-full shrink-0 items-center pl-3 pr-2 md:pl-6 md:pr-4">
              <h1 className="m-0 text-[1.2rem] font-semibold leading-none tracking-[0.01em] text-white">
                {current ? t(current.label) : 'Unikom'}
              </h1>
            </div>

            {/*
             * Der Platz für Knöpfe, die zur Überschrift gehören. Er steht immer
             * hier und ist meistens leer; die Ansichten hängen sich mit
             * `HeaderAction` hinein. Ein leeres Segment nimmt keine Breite.
             */}
            <div id={HEADER_ACTIONS} className="flex h-full shrink-0 items-center gap-2 empty:hidden md:px-4" />

            {/* Schiebt alles Folgende an den rechten Rand. */}
            <div className="min-w-2 flex-auto" aria-hidden="true" />

            <div className="planning-toolbar-segment-divider" aria-hidden="true" />

            <div className="flex h-full shrink-0 items-center px-2 md:px-4">
              {/*
                * Die Glocke steht im Band und nicht in einer Ansicht: Eine
                * Meldung, die nur sieht, wer zufällig auf dem richtigen
                * Bildschirm ist, hat ihren Zweck verfehlt. Sie trägt jetzt auch,
                * was auf eine Entscheidung wartet.
                */}
              <Meldungen
                tenantId="default"
                bereich={area}
                bedarf={bedarf}
                onZumBedarf={() => setArea('consolidation')}
              />
            </div>

            <div className="planning-toolbar-segment-divider" aria-hidden="true" />

            <div className="flex h-full shrink-0 items-center pl-2 pr-3 md:pl-4 md:pr-6">
              <Sprachwahl />
            </div>
          </div>
        </header>

        <main className="flex min-w-0 flex-col overflow-x-clip max-md:overflow-y-visible md:min-h-0 md:flex-1 md:overflow-hidden">

        {/*
         * Der scrollende Teil — und nur er.
         *
         * Vorher scrollte der ganze Bereich, und der Kopf blieb mit `sticky`
         * darüber stehen. Das ging nicht auf: Ein klebender Kopf hält erst
         * unterhalb des Innenabstands, und in dem Streifen darüber lief der
         * Inhalt weiter sichtbar durch — der Zurück-Knopf schob sich über die
         * Ecke des Kopf-Panels. Jetzt steht der Kopf fest und der Inhalt
         * scrollt in seinem eigenen Kasten darunter, so wie im Editor.
         */}
        <div
          ref={body}
          className={
            'app-shell-main mx-auto w-full max-w-[calc(1180px+5.5rem)] min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 md:px-6' +
            (bodyScrolls ? ' app-shell-main-scrolls' : '')
          }
        >
          {/*
           * Auf jedem Bildschirm, nicht nur unter Einstellungen: das Ende des
           * bezahlten Zeitraums soll niemanden überraschen, und wer davor steht,
           * ist selten der, der die Rechnung bezahlt.
           */}
          {identity.licence && needsAttention(identity.licence) && (
            <Notice kind={identity.licence.mayRun ? 'warn' : 'error'}>
              {identity.licence.problem ?? 'Die Lizenz dieser Installation gilt nicht.'}
              {!identity.licence.mayRun && ' Übertragungen starten erst wieder mit einer gültigen Lizenz.'}
              {area !== 'settings' && (
                <>
                  {' '}
                  <button className="secondary" onClick={() => setArea('settings')}>
                    Zur Lizenz
                  </button>
                </>
              )}
            </Notice>
          )}

          {view.editingJob ? (
            <JobEditorScreen
              jobId={view.editingJob}
              features={identity.features ?? []}
              onDone={() => setView({ area: 'workflows' })}
            />
          ) : current?.id === 'dashboard' ? (
            <DashboardScreen />
          ) : current?.id === 'jobs' ? (
            <JobsScreen canRun={session.may('RUN_JOBS')} />
          ) : current?.id === 'workflows' ? (
            <WorkflowsScreen
              canManage={session.may('MANAGE_JOBS')}
              canRun={session.may('RUN_JOBS')}
              onEdit={(jobId) => setView({ area: 'workflows', editingJob: jobId })}
              onShowHistory={(jobId) => setView({ area: 'history', historyJob: jobId })}
            />
          ) : current?.id === 'consolidation' ? (
            <ConsolidationScreen />
          ) : current?.id === 'history' ? (
            <HistoryScreen key={view.historyJob ?? 'all'} initialJobId={view.historyJob} />
          ) : current?.id === 'users' ? (
            <UsersScreen ownUserId={identity.user.id} />
          ) : current?.id === 'enquiry' ? (
            <DataEnquiryScreen />
          ) : current?.id === 'settings' ? (
            /*
             * Hier stand einmal auch die Verwaltung der Schlüssel und Zugänge.
             * Sie steht jetzt ausschließlich im Workflow, an der Stelle, an der
             * beim Einrichten auffällt, dass etwas fehlt: Ein Zugang ändert sich
             * beim Kunden im Takt des Auftrags, nicht im Takt der Installation,
             * und eine zweite Liste an anderer Stelle wäre die, in der später
             * die alten Einträge liegen bleiben.
             */
            <SettingsScreen canManage={session.may('MANAGE_USERS')} onLicenceChanged={() => void session.reload()} />
          ) : current?.id === 'privacy' ? (
            <PrivacyScreen />
          ) : current?.id === 'imprint' ? (
            <ImprintScreen />
          ) : (
            <div className="card empty">Dieser Bereich wird gerade gebaut.</div>
          )}
        </div>

        {/*
          * Der Platz für die Knöpfe, mit denen eine Ansicht abschließt —
          * „Speichern" und „Abbrechen". Er steht immer hier und ist meistens
          * leer; die Ansichten hängen sich mit `FooterAction` hinein.
          *
          * Außerhalb des rollenden Kastens und nicht darin: Die Knöpfe gehören
          * zum Formular als Ganzem und nicht zu seiner letzten Fläche. Am Ende
          * des Inhalts standen sie hinter allem, was man vorher ausfüllt — wer
          * oben etwas geändert hatte, musste erst herunterrollen, um es
          * festzuhalten.
          */}
        </main>
      </div>

      {/*
        * Der Mandant liegt über allem und in keinem Bereich.
        *
        * Er stand einmal als eigener Bildschirm im Inhalt. Das hieß: hingehen,
        * etwas tun, wieder zurückgehen - und „zurück" war der nächste Menüpunkt,
        * irgendeiner. Ein Fenster legt sich über das, was man gerade tut, und
        * gibt es unverändert zurück.
        *
        * Es hängt hier und nicht im Inhaltsbereich: Der Bildschirm dahinter soll
        * stehen bleiben, auch wenn er gerade rollt oder ein Formular hält.
        * Solange nichts offen ist, ist der Bildschirm gar nicht erst gebaut.
        */}
      {fenster && (
        <TenantsScreen
          canManage={canManageCredentials}
          fenster={fenster}
          blatt={blatt}
          onFenster={setFenster}
          onBlatt={setBlatt}
        />
      )}
    </div>
  );
}
