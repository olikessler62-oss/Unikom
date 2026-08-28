import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { RemoteDirectoryResult } from '../api/types.js';
import { messageOf } from '../api/useResource.js';
import { pathSegments } from '../screens/job/paths.js';
import { mapNode, sichtbare, toNodes, type TreeNode } from '../screens/job/tree.js';
import {
  Field,
  FieldButton,
  FolderIcon,
  FolderOpenIcon,
  listentasten,
  Loading,
  Modal,
  titelBeiUeberlauf,
} from './Pieces.js';

/**
 * Der Verzeichnisbaum im Auswahlfenster.
 *
 * Zwei Knöpfe je Zeile, und das ist Absicht: Das Dreieck klappt auf, der Name
 * wählt aus. Beides auf einen Knopf gelegt hieße, dass jeder Blick in ein
 * Verzeichnis zugleich die Wahl umstellt — man klappt drei Ebenen auf, um sich
 * umzusehen, und hat am Ende die unterste gewählt, ohne es zu wollen.
 *
 * Rekursiv gezeichnet, weil ein Baum rekursiv ist. Die Einrückung kommt aus
 * der Verschachtelung der Listen und nicht aus einer mitgezählten Tiefe: Eine
 * mitgezählte Zahl geht spätestens dann daneben, wenn irgendwo eine Ebene
 * übersprungen wird.
 */
function Verzeichnisbaum({
  nodes,
  chosen,
  fokus,
  melde,
  onToggle,
  onChoose,
}: {
  nodes: TreeNode[];
  chosen?: string;
  /** Der Knoten, der die Tastatur hat — genau einer trägt `tabIndex={0}`. */
  fokus?: string;
  /**
   * Meldet den Knopf einer Zeile an, damit die Tastatur ihn anspringen kann.
   *
   * Über eine Kartei und nicht über einen Selektor: Ein Pfad enthält
   * Rückstriche, Doppelpunkte und Leerzeichen — daraus einen gültigen
   * CSS-Selektor zu bauen ist eine Fehlerquelle, die genau bei den Pfaden
   * zuschlägt, die ein Kunde tatsächlich hat.
   */
  melde(pfad: string, knopf: HTMLButtonElement | null): void;
  onToggle(node: TreeNode): void;
  onChoose(node: TreeNode): void;
}) {
  return (
    <ul className="tree" role="group">
      {nodes.map((node) => (
        <li key={node.path}>
          <div className={`tree__row${chosen === node.path ? ' tree__row--chosen' : ''}`}>
            <button
              type="button"
              className="tree__toggle"
              aria-label={node.open ? `${node.name} zuklappen` : `${node.name} aufklappen`}
              title={node.open ? 'zuklappen' : 'aufklappen'}
              onClick={() => onToggle(node)}
            >
              {node.busy ? '·' : node.open ? '▾' : '▸'}
            </button>
            {/*
              * Das Symbol sitzt im Namensknopf und nicht neben ihm: Es gehört
              * zum Ordner, nicht zum Aufklappen — und ein drittes anklickbares
              * Ding je Zeile wäre eine Trefferfläche mehr, die niemand sucht.
              */}
            {/*
              * Ein Doppelklick klappt auf.
              *
              * Er ist das, was jeder aus dem Dateidialog kennt, und er
              * widerspricht der Aufteilung nicht: Der erste Klick wählt, der
              * zweite sieht hinein. Wer sich nur umsehen will, nimmt weiterhin
              * das Dreieck und ändert die Wahl dabei nicht.
              */}
            <button
              type="button"
              className="tree__name"
              ref={(knopf) => melde(node.path, knopf)}
              /*
               * Genau ein Knopf im Baum ist mit der Tabulatortaste erreichbar.
               * Ohne das wanderte der Fokus durch dreißig Ordner, bevor er den
               * Knopf unten erreicht — und ein Baum wäre mit der Tastatur nicht
               * zu verlassen.
               */
              tabIndex={fokus === node.path ? 0 : -1}
              aria-expanded={node.children || node.open ? node.open : undefined}
              aria-selected={chosen === node.path}
              onClick={() => onChoose(node)}
              onDoubleClick={() => onToggle(node)}
            >
              {node.open ? <FolderOpenIcon /> : <FolderIcon />}
              <span className="tree__label">{node.name}</span>
            </button>
          </div>

          {node.error && <p className="tree__error">✗ {node.error}</p>}

          {node.open && node.children && node.children.length > 0 && (
            <Verzeichnisbaum
              nodes={node.children}
              chosen={chosen}
              fokus={fokus}
              melde={melde}
              onToggle={onToggle}
              onChoose={onChoose}
            />
          )}
          {node.open && node.children?.length === 0 && <p className="tree__empty">keine Unterverzeichnisse</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Das Auswahlfenster für ein Verzeichnis (SPEC-02; Regel: der Server antwortet,
 * nicht der Browser).
 *
 * ## Warum es hier steht und nicht im Job-Editor
 *
 * Es hing dort fest, und damit hing an ihm auch die Regel, dass jedes
 * Verzeichnisfeld einen Auswahlknopf bekommt: Wer außerhalb des Editors ein
 * Verzeichnis brauchte, hatte die Wahl zwischen Abtippen und einem zweiten,
 * ähnlichen Fenster. Zwei Fenster, die dasselbe fragen, werden sich früher oder
 * später darüber uneins, was ein eingetippter Pfad bedeutet.
 *
 * ## Was hier nicht steht
 *
 * **Welchen Server es fragt.** Das ist der Teil, der vom Aufrufer abhängt: eine
 * lokale Quelle, eine Freigabe mit hinterlegtem Zugang, ein SFTP-Ziel. Der
 * Aufrufer reicht `lies` herein, und dieses Fenster zeigt nur, was
 * zurückkommt — nicht, was es für wahrscheinlich hält.
 *
 * `lege` ist freiwillig: Ohne die Möglichkeit, einen Ordner anzulegen,
 * verschwindet die Zeile dafür. Ein Knopf, der nichts kann, ist schlimmer als
 * keiner.
 */
export interface Verzeichniswahl {
  /** Der volle Pfad, wie der Server ihn nennt. */
  pfad: string;
  /** Derselbe Ort in der Schreibweise des Feldes — ohne Arbeitsverzeichnis. */
  relativ: string;
}

export function Verzeichnisfenster({
  titel,
  start,
  waehle = 'VERZEICHNIS',
  lies,
  lege,
  onWaehlen,
  onClose,
}: {
  titel: string;
  /** Wo das Fenster aufgeht. */
  start: string;
  /**
   * Was am Ende übernommen wird.
   *
   * Bei `DATEI` erscheint zusätzlich die Dateiliste des Verzeichnisses, und der
   * Knopf unten übernimmt die gewählte Datei. Gewandert wird trotzdem durch die
   * Ordner — eine Datei liegt schließlich in einem.
   */
  waehle?: 'VERZEICHNIS' | 'DATEI';
  lies(pfad: string): Promise<RemoteDirectoryResult>;
  lege?(elternPfad: string, name: string): Promise<{ ok: boolean; path?: string; message: string }>;
  onWaehlen(wahl: Verzeichniswahl, gelesen: RemoteDirectoryResult): void;
  onClose(): void;
}) {
  const [stand, setStand] = useState<{ busy: boolean; at?: RemoteDirectoryResult }>({ busy: true });
  /*
   * Der Baum und die Wahl darin. Getrennt vom Ladezustand, weil sie
   * verschiedene Lebensdauern haben: Der Baum wächst, während man sich umsieht,
   * die Wahl ändert sich nur, wenn jemand einen Namen anklickt.
   */
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [chosen, setChosen] = useState<{ path: string; relativePath: string }>();
  const [newFolder, setNewFolder] = useState('');
  const [folderError, setFolderError] = useState<string>();

  /*
   * Der Pfad, den das Fenster gerade meint — abgeleitet und nicht mitgeführt.
   *
   * Ein zweiter Zustand daneben ginge früher oder später auseinander: Man
   * klickt im Baum, klickt oben eine Abkürzung, blättert eine Ebene höher — und
   * irgendeiner dieser Wege vergäße, das Feld nachzuziehen.
   */
  const gewaehlterPfad = chosen?.path ?? stand.at?.path ?? '';

  /*
   * Die Dateien des **gewählten** Ordners.
   *
   * Getrennt von `stand.at`: Das ist der Ort, an dem das Fenster aufgemacht
   * wurde, und der ändert sich beim Klicken im Baum nicht — `oeffne` baut den
   * Baum neu und läuft deshalb nur beim Öffnen und beim Springen über das
   * Pfadfeld. Die Liste zeigte damit die Dateien des Startverzeichnisses,
   * während oben im Feld längst ein anderer Ordner stand: „Keine Dateien in
   * diesem Verzeichnis" bei einem Ordner voller Dateien.
   *
   * Nur im Dateimodus geholt. Wer ein Verzeichnis sucht, sieht die Liste nicht
   * und soll für sie auch nicht warten.
   */
  const [dateien, setDateien] = useState<RemoteDirectoryResult['files']>();

  /*
   * Der Ordner, dessen Dateien im Kasten stehen — und nicht `chosen`.
   *
   * `chosen` trägt am Ende auch eine **Datei**: Wer eine anklickt, wählt sie
   * aus. Würde die Liste daran hängen, versuchte sie beim ersten Klick, eine
   * Datei als Verzeichnis zu lesen — und leerte sich selbst.
   */
  const [ordner, setOrdner] = useState<string>();

  const gezeigterOrdner = ordner ?? stand.at?.path ?? '';

  useEffect(() => {
    if (waehle !== 'DATEI' || gezeigterOrdner === '') {
      setDateien(undefined);
      return;
    }

    /*
     * Wer schnell durch den Baum klickt, hat mehrere Anfragen unterwegs. Ohne
     * diese Marke gewänne die zuletzt **eingetroffene** und nicht die zuletzt
     * gestellte — und im Kasten stünden die Dateien eines Ordners, den niemand
     * mehr ansieht.
     */
    let gilt = true;

    void lies(gezeigterOrdner)
      .then((gelesen) => gilt && setDateien(gelesen.files ?? []))
      .catch(() => gilt && setDateien([]));

    return () => {
      gilt = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gezeigterOrdner, waehle]);

  /*
   * Was jemand gerade hineinschreibt. `undefined` heißt: Das Feld folgt der
   * Auswahl.
   *
   * Es war lange nur zum Lesen, mit der Begründung, ein Feld, in dem nichts
   * geschieht, sei die schlechtere Antwort. Das stimmt — die Antwort darauf ist
   * aber nicht, es lesbar zu lassen, sondern **etwas geschehen zu lassen**: Ein
   * Pfad aus der Zwischenablage und Enter, und das Fenster steht dort. Das ist
   * der häufigste Fall überhaupt, und bisher klickte man ihn zu Fuß nach.
   */
  const [pfadentwurf, setPfadentwurf] = useState<string>();

  // Sobald sich die Auswahl bewegt, ist der Entwurf überholt.
  useEffect(() => setPfadentwurf(undefined), [gewaehlterPfad]);

  /**
   * Was „OK" übernimmt — das Angeklickte, sonst das Getippte, sonst der Ort.
   *
   * ## Warum das Getippte zählt
   *
   * Das Pfadfeld lädt ausdrücklich zum Einfügen ein: „Pfad eingeben oder
   * einfügen, dann Enter". Wer statt Enter auf „OK" drückt, tut das
   * Naheliegende — und bekam bisher nichts: Ohne Enter blieb die Auswahl leer,
   * und der Knopf war still abgeschaltet. Zwei Wege in dasselbe Feld, von denen
   * einer ins Nichts führt, sind einer zu viel.
   *
   * ## Warum eine Datei nicht auf den Ort zurückfällt
   *
   * Wer ein **Verzeichnis** sucht, hat mit dem Ort, an dem das Fenster steht,
   * schon eine gültige Antwort — er ist selbst ein Verzeichnis. Wer eine
   * **Datei** sucht, hat sie nicht: Ein Ordner ist keine Datei, und ihn
   * ersatzweise zu übernehmen hieße, dem Feld etwas einzutragen, das dort nie
   * stehen darf. Dann gibt es nichts zu übernehmen, und der Knopf sagt es.
   */
  const getippt = (pfadentwurf ?? '').trim();
  const uebernahme: Verzeichniswahl | undefined = chosen
    ? { pfad: chosen.path, relativ: chosen.relativePath }
    : getippt !== ''
      ? { pfad: getippt, relativ: getippt }
      : waehle === 'DATEI'
        ? undefined
        : { pfad: stand.at?.path ?? '', relativ: stand.at?.relativePath ?? '' };

  /** Der Knoten, der die Tastatur hat. */
  const [fokus, setFokus] = useState<string>();

  /*
   * Die Knöpfe der Zeilen, nach Pfad. Über eine Kartei und nicht über einen
   * Selektor: Ein Pfad enthält Rückstriche und Doppelpunkte, und daraus einen
   * gültigen CSS-Selektor zu bauen ginge genau bei den Pfaden schief, die ein
   * Kunde wirklich hat.
   */
  const knoepfe = useRef(new Map<string, HTMLButtonElement>());

  const melde = (pfad: string, knopf: HTMLButtonElement | null): void => {
    if (knopf) {
      knoepfe.current.set(pfad, knopf);
    } else {
      knoepfe.current.delete(pfad);
    }
  };

  const springe = (pfad: string): void => {
    setFokus(pfad);
    knoepfe.current.get(pfad)?.focus();
  };

  async function oeffne(at: string): Promise<void> {
    setStand({ busy: true });
    setNewFolder('');
    setFolderError(undefined);

    try {
      const gelesen = await lies(at);

      setStand({ busy: false, at: gelesen });

      // Der neue Ort ist auch der, dessen Dateien gezeigt werden.
      setOrdner(undefined);

      /*
       * Das aktuelle Verzeichnis ist die Wurzel des Baums und zugleich die
       * Vorauswahl. Damit gilt für den Knopf unten immer dasselbe: Er nimmt,
       * was hervorgehoben ist — und beim Öffnen ist das der Ort, an dem man
       * steht. Ohne diese Wurzelzeile wäre „nichts gewählt" ein eigener,
       * unsichtbarer Zustand mit eigener Regel.
       */
      const wurzel = (gelesen.path ?? at).trim();

      /*
       * Ohne Pfad gibt es keine Wurzelzeile: An der Wurzel eines Windows-
       * Rechners steht die Auswahl der Laufwerke, und die ist kein Verzeichnis.
       * Eine Zeile ohne Beschriftung, die sich obendrein übernehmen ließe,
       * trüge dann ein leeres Verzeichnis ins Feld.
       */
      setTree(
        wurzel === ''
          ? toNodes(gelesen.entries)
          : [
              {
                name: pathSegments(wurzel).at(-1)?.label ?? wurzel,
                path: wurzel,
                relativePath: gelesen.relativePath ?? '',
                open: true,
                busy: false,
                children: toNodes(gelesen.entries),
              },
            ]
      );
      /*
       * Beim Wählen einer Datei ist das Verzeichnis **keine** Vorauswahl: Sonst
       * übernähme der Knopf unten einen Ordner, wo eine Datei erwartet wird.
       */
      setChosen(
        waehle === 'DATEI' || wurzel === ''
          ? undefined
          : { path: wurzel, relativePath: gelesen.relativePath ?? '' }
      );
    } catch (failure) {
      setStand({
        busy: false,
        at: { ok: false, message: messageOf(failure, 'Die Verbindung ist fehlgeschlagen'), entries: [] },
      });
    }
  }

  useEffect(() => {
    void oeffne(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Die Tastatur im Baum, nach dem Muster „Tree View" der WAI-ARIA-Praxis.
   *
   * ```text
   * ↑ ↓        durch die sichtbaren Zeilen
   * →          aufklappen, sonst ins erste Kind
   * ←          zuklappen, sonst zum Elternknoten
   * Pos1 Ende  erste und letzte Zeile
   * Enter      übernehmen und schließen
   * Buchstabe  zur nächsten Zeile, die so beginnt
   * ```
   *
   * Bewegt wird durch die **sichtbaren** Zeilen: Was unter einem zugeklappten
   * Zweig liegt, steht nirgends und darf nicht erreichbar sein — ein Fokus an
   * einer Stelle, die man nicht sieht, ist schlimmer als keiner.
   *
   * `→` und `←` sind nicht symmetrisch, und das ist gewollt: Rechts geht es
   * hinein, links hinaus. Wer rechts auf einem offenen Ordner drückt, will
   * tiefer; wer links auf einem geschlossenen drückt, will heraus.
   */
  function baumtasten(event: KeyboardEvent<HTMLDivElement>): void {
    const liste = sichtbare(tree);
    const stelle = liste.findIndex((eintrag) => eintrag.node.path === fokus);
    const jetzt = stelle === -1 ? undefined : liste[stelle];

    const zu = (ziel: number): void => {
      const eintrag = liste[Math.min(liste.length - 1, Math.max(0, ziel))];

      if (eintrag) {
        event.preventDefault();
        springe(eintrag.node.path);
      }
    };

    switch (event.key) {
      case 'ArrowDown':
        return zu(stelle === -1 ? 0 : stelle + 1);

      case 'ArrowUp':
        return zu(stelle === -1 ? 0 : stelle - 1);

      case 'Home':
        return zu(0);

      case 'End':
        return zu(liste.length - 1);

      case 'ArrowRight': {
        if (!jetzt) {
          return zu(0);
        }

        event.preventDefault();

        if (!jetzt.node.open) {
          void toggleNode(jetzt.node);
          return;
        }

        return zu(stelle + 1);
      }

      case 'ArrowLeft': {
        if (!jetzt) {
          return;
        }

        event.preventDefault();

        if (jetzt.node.open) {
          void toggleNode(jetzt.node);
          return;
        }

        // Der Elternknoten ist der letzte davorstehende mit kleinerer Tiefe.
        for (let i = stelle - 1; i >= 0; i -= 1) {
          if (liste[i].tiefe < jetzt.tiefe) {
            return zu(i);
          }
        }

        return;
      }

      case 'Enter': {
        if (!jetzt) {
          return;
        }

        event.preventDefault();
        setChosen({ path: jetzt.node.path, relativePath: jetzt.node.relativePath });
        return;
      }

      default: {
        /*
         * Ein Buchstabe springt zur nächsten Zeile, die so beginnt — vom Fokus
         * aus und wieder von vorn. Bei dreißig Ordnern ist das der Unterschied
         * zwischen einem Tastendruck und dreißig.
         */
        if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) {
          return;
        }

        const buchstabe = event.key.toLowerCase();

        for (let i = 1; i <= liste.length; i += 1) {
          const kandidat = liste[(Math.max(0, stelle) + i) % liste.length];

          if (kandidat.node.name.toLowerCase().startsWith(buchstabe)) {
            event.preventDefault();
            springe(kandidat.node.path);
            return;
          }
        }
      }
    }
  }

  /**
   * Klappt einen Zweig auf oder zu und holt seine Kinder beim ersten Mal.
   *
   * Geholt wird nur einmal: Ein zweites Aufklappen zeigt, was schon da ist.
   * Bei SFTP und FTPS ist jede Ebene eine Anmeldung, bei einer Freigabe ein
   * Platz in der Warteschlange — ein Baum, der bei jedem Klick nachfragt, wäre
   * an einer langsamen Leitung nicht zu bedienen.
   *
   * Ein Zweig, der sich nicht lesen lässt, trägt seinen Fehler selbst. Eine
   * Meldung über dem ganzen Fenster sagte nicht, welcher Ordner gemeint war.
   */
  async function toggleNode(node: TreeNode): Promise<void> {
    if (node.open) {
      setTree((vorher) => mapNode(vorher, node.path, (knoten) => ({ ...knoten, open: false })));
      return;
    }

    if (node.children) {
      setTree((vorher) => mapNode(vorher, node.path, (knoten) => ({ ...knoten, open: true })));
      return;
    }

    setTree((vorher) => mapNode(vorher, node.path, (knoten) => ({ ...knoten, busy: true, error: undefined })));

    try {
      const gelesen = await lies(node.path);

      setTree((vorher) =>
        mapNode(vorher, node.path, (knoten) => ({
          ...knoten,
          busy: false,
          open: gelesen.ok,
          children: gelesen.ok ? toNodes(gelesen.entries) : undefined,
          error: gelesen.ok ? undefined : gelesen.message,
        }))
      );
    } catch (failure) {
      setTree((vorher) =>
        mapNode(vorher, node.path, (knoten) => ({
          ...knoten,
          busy: false,
          error: messageOf(failure, 'Das Verzeichnis konnte nicht gelesen werden'),
        }))
      );
    }
  }

  /**
   * Legt einen Ordner dort an, wo das Fenster gerade steht, und geht hinein.
   *
   * Der häufige Fall ist das Archiv: Es gibt es noch nicht, also lässt es sich
   * nicht aussuchen. Angelegt wird auf dem Server und über dieselbe Verbindung
   * wie alles andere — hier entsteht nichts auf dem Rechner, an dem jemand
   * sitzt.
   */
  async function createFolder(): Promise<void> {
    if (!lege) {
      return;
    }

    setFolderError(undefined);

    try {
      const antwort = await lege(stand.at?.path ?? '', newFolder.trim());

      if (!antwort.ok) {
        setFolderError(antwort.message);
        return;
      }

      // Hinein statt nur daneben: Wer einen Ordner anlegt, will ihn benutzen.
      await oeffne(antwort.path ?? stand.at?.path ?? '');
    } catch (failure) {
      setFolderError(messageOf(failure, 'Der Ordner konnte nicht angelegt werden'));
    }
  }

  return (

        <Modal
          title={titel}
          // Das Fenster bringt „Abbrechen" und „OK" mit; ein „Schließen"
          // daneben wäre ein dritter Knopf für das, was der erste schon tut.
          ownActions
          // Kopf und Knopfleiste stehen fest, nur die Mitte rollt.
          geteilt
          onClose={onClose}
        >
          {stand.busy && !stand.at ? (
            <Loading />
          ) : !stand.at?.ok ? (
            <p className="verdict verdict--bad">✗ {stand.at?.message}</p>
          ) : (
            <>
              {/*
                * Der Pfad als Kette von Knöpfen, nicht als Zeile Text: Aus
                * `…/kunde-a/2026/eingang` zurück nach `…/kunde-a` war es sonst
                * dreimal „eine Ebene höher", und dazwischen lud jedes Mal ein
                * Verzeichnis, das niemand sehen wollte.
                */}
              <p className="browse__here">
                <span className="browse__label">Hier:</span>
                <span className="browse__crumbs">
                  {pathSegments(stand.at.path ?? '').map((teil) => (
                    <button
                      key={teil.path}
                      type="button"
                      className="browse__crumb"
                      onClick={() => void oeffne(teil.path)}
                    >
                      {teil.label}
                    </button>
                  ))}
                </span>
                {stand.at.filesFound !== undefined && (
                  <span className="browse__count">
                    {stand.at.filesFound === 1 ? '1 Datei' : `${stand.at.filesFound} Dateien`}
                  </span>
                )}
              </p>

              {/*
                * Der volle Pfad dessen, was gewählt ist — abgeleitet und nicht
                * mitgeführt.
                *
                * Ein zweiter Zustand daneben ginge früher oder später
                * auseinander: Man klickt im Baum, klickt oben eine Abkürzung,
                * blättert eine Ebene höher — und irgendeiner dieser Wege
                * vergäße, das Feld nachzuziehen. Was hier steht, *ist* die
                * Auswahl, deshalb kann es nicht daneben liegen.
                *
                * Nur zum Lesen: Getippt wird in das Feld hinter dem Fenster.
                * Ein Feld, in das man schreiben kann und in dem nichts
                * geschieht, wäre die schlechtere Antwort. Markieren und
                * kopieren bleibt möglich, und genau dafür steht es hier.
                */}
              <div className="row browse__jump">
                <input
                  value={pfadentwurf ?? gewaehlterPfad}
                  spellCheck={false}
                  aria-label="Pfad - Enter springt dorthin"
                  title="Pfad eingeben oder einfügen, dann Enter"
                  onChange={(event) => setPfadentwurf(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return;
                    }

                    event.preventDefault();

                    const ziel = (pfadentwurf ?? '').trim();

                    // Enter ohne Änderung ist kein Sprung ins Leere: Dann steht
                    // das Fenster schon dort, wo es hin soll.
                    if (ziel !== '' && ziel !== gewaehlterPfad) {
                      void oeffne(ziel);
                    }
                  }}
                />
              </div>

              {/*
                * Nur dieser Teil rollt.
                *
                * Kopf und Knopfleiste stehen — wer in einer langen Liste
                * unten sucht, verlöre sonst den Pfad aus dem Blick, und
                * „OK" wanderte aus dem Bild. Das Fenster trägt dafür
                * `geteilt`; was die Mitte ist, sagt diese Umfassung.
                */}
              <div className="fenster__mitte">

              {/*
                * Was schon benutzt wird, steht obenan — der häufigste Fall ist,
                * dass der nächste Workflow neben den bestehenden liegt. Nur
                * wenn es solche Orte gibt: eine leere Überschrift wäre eine
                * Zeile, die nichts sagt.
                */}
              {stand.at.known && stand.at.known.length > 0 && (
                <>
                  <p className="browse__label">Schon benutzt</p>
                  <ul className="browse browse--known" onKeyDown={listentasten}>
                    {stand.at.known.map((entry) => (
                      <li key={entry.path}>
                        <button type="button" onClick={() => void oeffne(entry.path)}>
                          {entry.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/*
                * `role="tree"` und die Tasten am Kasten, nicht an der Zeile:
                * Eine Zeile, die erst beim Aufklappen entsteht, hätte sonst
                * keine Tastatur — und man merkte es genau dann nicht, wenn man
                * es prüft, weil die oberste Ebene funktioniert.
                */}
              <div className="browse browse--baum" role="tree" onKeyDown={baumtasten}>
                <Verzeichnisbaum
                  nodes={tree}
                  chosen={chosen?.path}
                  fokus={fokus ?? sichtbare(tree)[0]?.node.path}
                  melde={melde}
                  onToggle={(knoten) => void toggleNode(knoten)}
                  onChoose={(knoten) => {
                    setChosen({ path: knoten.path, relativePath: knoten.relativePath });
                    setOrdner(knoten.path);
                    setFokus(knoten.path);
                  }}
                />
                {tree.length === 0 && <p className="browse__empty">Keine Unterverzeichnisse</p>}
              </div>


              {/*
                * Die Dateien des Verzeichnisses — nur, wenn eine gewählt werden
                * soll. Sie unter die Ordner zu mischen hieße, dass wer ein
                * Verzeichnis sucht, durch tausend Dateien scrollt.
                */}
              {waehle === 'DATEI' && (
                <div className="browse browse--dateien">
                  {(dateien ?? []).length === 0 ? (
                    <p className="browse__empty">Keine Dateien in diesem Verzeichnis</p>
                  ) : (
                    <ul onKeyDown={listentasten}>
                      {(dateien ?? []).map((datei) => (
                        <li key={datei.path}>
                          <button
                            type="button"
                            /*
                              * Eigene Klassen und nicht die des Baums.
                              *
                              * Hier stand `tree__name tree__row--chosen` — die
                              * Auszeichnung einer Baumzeile an einer Zeile, die
                              * kein Baum ist. Das ging zweimal schief: `--chosen`
                              * gehört im Baum an die **Zeile**, und die Regel für
                              * den Namen darin (`.tree__row--chosen .tree__name`)
                              * traf hier nie, weil beide Klassen an demselben
                              * Element hingen. Und in Spring färbt sich ein
                              * `tree__name` beim Überfahren fast weiß, weil eine
                              * Baumzeile dort fast schwarz wird — auf dem hellen
                              * Grund dieser Liste heißt das unsichtbar.
                              *
                              * `.browse li > button` gibt der Zeile ohnehin alles,
                              * was sie braucht: Form, Ruhe und Hervorhebung.
                              */
                            className={chosen?.path === datei.path ? 'browse__gewaehlt' : undefined}
                            onClick={() => setChosen({ path: datei.path, relativePath: datei.relativePath })}
                          >
                            {datei.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/*
                * Anlegen, statt einen Pfad blind zu tippen. Das Archiv gibt es
                * beim Einrichten fast nie schon — und ein Verzeichnis, das man
                * nur getippt hat, sieht man erst nach dem ersten Lauf.
                */}
              {waehle === 'VERZEICHNIS' && lege && (
              <div className="row browse__new">
                <input
                  value={newFolder}
                  placeholder="Name eines neuen Ordners"
                  onChange={(event) => setNewFolder(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newFolder.trim()) {
                      event.preventDefault();
                      void createFolder();
                    }
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={!newFolder.trim()}
                  onClick={() => void createFolder()}
                >
                  Ordner anlegen
                </button>
              </div>
              )}

              {folderError && <p className="verdict verdict--bad">✗ {folderError}</p>}
              </div>

              {/*
                * OK und Abbrechen, rechtsbündig — siehe `.modal__actions`.
                *
                * Vorher stand die Hauptaktion in einer eigenen Zeile und
                * darunter „Schließen": zwei Zeilen für eine Entscheidung, und
                * der Ausgang sah aus, als gehörte er nicht dazu.
                */}
              <div className="row modal__actions">
                {/*
                  * Ein Knopf, der nichts tut, sagt nicht warum.
                  *
                  * Ohne Auswahl war „OK" abgeschaltet und sonst nichts — und
                  * abgeschaltet sieht einem Knopf man nicht zuverlässig an. Wer
                  * im Feld einen Pfad stehen sah und drückte, bekam keine
                  * Reaktion und keinen Grund. Der Satz steht dort, wo der Blick
                  * ohnehin ist: neben dem Knopf.
                  */}
                {!uebernahme && <span className="modal__grund">Erst eine Datei aussuchen</span>}

                <button
                  type="button"
                  disabled={!uebernahme}
                  onClick={() => uebernahme && onWaehlen(uebernahme, stand.at!)}
                >
                  OK
                </button>
                <button type="button" className="secondary" onClick={onClose}>
                  Abbrechen
                </button>
              </div>
            </>
          )}
        </Modal>
  );
}


/**
 * Ein Dateifeld mit seinem Auswahlknopf.
 *
 * Dasselbe Fenster wie für Verzeichnisse, nur endet die Auswahl an einer Datei
 * statt an einem Ordner. Ein zweites Fenster wäre eines, das sich früher oder
 * später darüber uneins wird, was ein eingetippter Pfad bedeutet — und
 * ausgerechnet die Datei ist der Fall, in dem ein Tippfehler still bleibt: Das
 * Schema, das es nicht gibt, meldet sich erst im Nachtlauf.
 */
export function Dateifeld({
  label,
  explain,
  titel,
  wert,
  start,
  disabled,
  lies,
  onChange,
}: {
  label: string;
  explain?: ReactNode;
  titel: string;
  wert: string;
  /**
   * Wo das Fenster aufgeht, wenn im Feld kein voller Pfad steht.
   *
   * Gebraucht dort, wo das Feld nur einen **Dateinamen** trägt und das
   * Verzeichnis daneben steht — sonst ginge das Fenster an der Wurzel auf und
   * der Weg zurück wäre jedes Mal derselbe.
   */
  start?: string;
  disabled?: boolean;
  lies(pfad: string): Promise<RemoteDirectoryResult>;
  onChange(pfad: string): void;
}) {
  const [offen, setOffen] = useState(false);

  return (
    <>
      <Field
        label={label}
        explain={explain}
        action={
          <FieldButton title={`${label} aussuchen`} disabled={disabled} onClick={() => setOffen(true)}>
            <FolderIcon />
          </FieldButton>
        }
      >
        <input
          value={wert}
          disabled={disabled}
          {...titelBeiUeberlauf()}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      {offen && (
        <Verzeichnisfenster
          titel={titel}
          /*
           * Aufgemacht wird im Verzeichnis der bisherigen Datei und nicht an
           * ihrem vollen Pfad: Der wäre kein Verzeichnis, und das Fenster
           * stünde beim Öffnen auf einem Fehler.
           */
          start={verzeichnisTeil(wert) || start || ''}
          waehle="DATEI"
          lies={lies}
          onWaehlen={(wahl) => {
            onChange(wahl.relativ);
            setOffen(false);
          }}
          onClose={() => setOffen(false)}
        />
      )}
    </>
  );
}

/** Der Ordner, in dem ein Pfad liegt — mit beiden Trennzeichen, die vorkommen. */
export function verzeichnisTeil(pfad: string): string {
  const trenner = Math.max(pfad.lastIndexOf('/'), pfad.lastIndexOf(String.fromCharCode(92)));

  return trenner === -1 ? '' : pfad.slice(0, trenner);
}

/**
 * Ein Verzeichnisfeld mit seinem Auswahlknopf.
 *
 * Der Knopf sitzt **rechts neben dem Feld** und nicht in einer Zeile darunter:
 * Er gehört zu diesem Feld, und eine eigene Zeile ließe offen, zu welchem.
 *
 * Getippt werden darf trotzdem. Ein Feld, das nur noch die Auswahl annimmt,
 * zwingt bei jedem bekannten Pfad durch drei Ebenen Klicken.
 */
export function Verzeichnisfeld({
  label,
  pflicht,
  explain,
  titel,
  wert,
  disabled,
  marke,
  lies,
  lege,
  onChange,
}: {
  label: string;
  /** Ob ohne dieses Verzeichnis nichts läuft — siehe `Field`. */
  pflicht?: boolean;
  explain?: ReactNode;
  /** Die Überschrift des Fensters — sie soll sagen, wofür das Verzeichnis gilt. */
  titel: string;
  wert: string;
  disabled?: boolean;
  /**
   * Ein Zeichen über den Zustand des Feldes — etwa das Ergebnis einer Probe.
   *
   * Es steht **in** der Zeile und nicht darunter: Eine Zeile, die unter dem Feld
   * erscheint, sobald eine Antwort eintrifft, schiebt alles darunter fort,
   * während jemand noch tippt. Das Zeichen hält seinen Platz von Anfang an frei
   * und wechselt nur sein Aussehen.
   */
  marke?: ReactNode;
  lies(pfad: string): Promise<RemoteDirectoryResult>;
  lege?(elternPfad: string, name: string): Promise<{ ok: boolean; path?: string; message: string }>;
  onChange(pfad: string): void;
}) {
  const [offen, setOffen] = useState(false);

  return (
    <>
      <Field
        label={label}
        pflicht={pflicht}
        explain={explain}
        action={
          <>
            {marke}

            <FieldButton title={`${label} aussuchen`} disabled={disabled} onClick={() => setOffen(true)}>
              <FolderIcon />
            </FieldButton>
          </>
        }
      >
        <input
          value={wert}
          disabled={disabled}
          {...titelBeiUeberlauf()}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      {offen && (
        <Verzeichnisfenster
          titel={titel}
          start={wert}
          lies={lies}
          lege={lege}
          onWaehlen={(wahl) => {
            onChange(wahl.relativ);
            setOffen(false);
          }}
          onClose={() => setOffen(false)}
        />
      )}
    </>
  );
}
