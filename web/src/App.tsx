import { Fragment, useEffect, useRef, useState } from 'react';

import { api } from './api/client.js';

import { useAuswahlschliesser } from './components/Auswahlschliesser.js';
import { Meldungen } from './components/Meldungen.js';
import { MenuIcon } from './components/MenuIcon.js';
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
import { TenantsScreen } from './screens/TenantsScreen.js';
import { UsersScreen } from './screens/UsersScreen.js';
import { DataEnquiryScreen } from './screens/DataEnquiryScreen.js';
import { ConsolidationScreen } from './screens/ConsolidationScreen.js';
import { WorkflowsScreen } from './screens/WorkflowsScreen.js';
import { Sprachwahl } from './components/Sprachwahl.js';
import { useSession } from './session/useSession.js';
import { FOOTER_ACTIONS, HEADER_ACTIONS, Notice } from './components/Pieces.js';
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

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar__brand">Unikom</div>

        {/*
         * Zwischen Schriftzug und Menü ist der Platz für den späteren globalen
         * Mandantenfilter ("Alle Mandanten ▼"): oberhalb von allem, was er
         * einschränkt. Er soll erst erscheinen, wenn es mehr als einen
         * Mandanten gibt — bei einem wäre es eine Auswahl ohne Wahl. Bis dahin
         * steht hier nichts, damit das Menü ruhig bleibt.
         */}

        <div className="sidebar__nav">
          {blocks.map((entries, index) => (
            <Fragment key={entries[0].id}>
              {index > 0 && <div className="sidebar__break" aria-hidden="true" />}
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className={entry.id === current?.id ? 'sidebar__link sidebar__link--active' : 'sidebar__link'}
                  onClick={() => setArea(entry.id)}
                >
                  <MenuIcon name={entry.id} />
                  {/*
                    * Hier stand einmal die Zahl des Ausstehenden in Klammern
                    * hinter dem Wort. Sie steht jetzt an der Glocke im Kopfband,
                    * zusammen mit den Meldungen: Zwei Zähler für dieselbe Sache
                    * an zwei Orten sind einer zu viel - und der eine, den jemand
                    * später zu ändern vergisst, widerspricht dann dem anderen.
                    */}
                  {t(entry.label)}
                </button>
              ))}
            </Fragment>
          ))}

          {/*
            * Abmelden, Datenschutz und Impressum stehen im selben Fluss wie
            * alles andere, nur eine Gruppe weiter — nicht am unteren Rand der
            * Seitenleiste. Dort wanderten sie auf einem hohen Bildschirm weit
            * von den Menüpunkten weg und waren kaum noch zu finden.
            */}
          <div className="sidebar__break" aria-hidden="true" />

          <button className="sidebar__link" onClick={() => void session.logout()}>
            <MenuIcon name="signOut" />
            {t('nav.signOut')}
          </button>

          {/* Abmelden ist eine Handlung, Datenschutz und Impressum sind Seiten. */}
          <div className="sidebar__space" aria-hidden="true" />

          {PAGES.map((page) => (
            <button
              key={page.id}
              className={page.id === current?.id ? 'sidebar__link sidebar__link--active' : 'sidebar__link'}
              onClick={() => setArea(page.id)}
            >
              <MenuIcon name={page.id} />
              {t(page.label)}
            </button>
          ))}

          <div className="build-stamp">{t('nav.build')} {__UNIKOM_BUILD__}</div>
        </div>
      </nav>

      {/*
        * Der Editor füllt die Höhe selbst aus und scrollt in seinem mittleren
        * Teil. Deshalb gibt der Inhaltsbereich hier seinen eigenen Bildlauf ab
        * — sonst liefe der Inhalt unter der Knopfleiste durch, statt über ihr
        * zu enden.
        */}
      <main className={view.editingJob ? 'main main--fills' : 'main'}>
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
        <div className="main__header">
          <h1>{current ? t(current.label) : 'Unikom'}</h1>
          {/*
           * Der Platz für Knöpfe, die zur Überschrift gehören. Er steht immer
           * hier und ist meistens leer; die Ansichten hängen sich mit
           * `HeaderAction` hinein.
           */}
          <div id={HEADER_ACTIONS} className="main__header__actions" />

          <div className="main__header__ende">
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
            <Sprachwahl />
          </div>
        </div>

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
        <div ref={body} className={bodyScrolls ? 'main__body main__body--scrolls' : 'main__body'}>
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
          ) : current?.id === 'tenants' ? (
            <TenantsScreen canManage={canManageCredentials} />
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
        <div id={FOOTER_ACTIONS} className="main__footer" />
      </main>
    </div>
  );
}
