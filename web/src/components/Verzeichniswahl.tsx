import { useEffect, useState, type ReactNode } from 'react';

import type { RemoteDirectoryResult } from '../api/types.js';
import { messageOf } from '../api/useResource.js';
import { pathSegments } from '../screens/job/paths.js';
import { mapNode, toNodes, type TreeNode } from '../screens/job/tree.js';
import { Field, FieldButton, FolderIcon, FolderOpenIcon, listentasten, Loading, Modal } from './Pieces.js';

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
  onToggle,
  onChoose,
}: {
  nodes: TreeNode[];
  chosen?: string;
  onToggle(node: TreeNode): void;
  onChoose(node: TreeNode): void;
}) {
  return (
    <ul className="tree">
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
            <button type="button" className="tree__name" onClick={() => onChoose(node)}>
              {node.open ? <FolderOpenIcon /> : <FolderIcon />}
              <span className="tree__label">{node.name}</span>
            </button>
          </div>

          {node.error && <p className="tree__error">✗ {node.error}</p>}

          {node.open && node.children && node.children.length > 0 && (
            <Verzeichnisbaum nodes={node.children} chosen={chosen} onToggle={onToggle} onChoose={onChoose} />
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

  async function oeffne(at: string): Promise<void> {
    setStand({ busy: true });
    setNewFolder('');
    setFolderError(undefined);

    try {
      const gelesen = await lies(at);

      setStand({ busy: false, at: gelesen });

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
          onClose={onClose}
        >
          {stand.busy && !stand.at ? (
            <Loading />
          ) : !stand.at?.ok ? (
            <p className="verdict verdict--bad">✗ {stand.at?.message}</p>
          ) : (
            (() => {
              // An der Laufwerksauswahl gibt es keine Wurzelzeile: Dort steht
              // die Liste der Laufwerke für sich.
              const wurzel = tree.length === 1 && tree[0].children ? tree[0] : undefined;

              return (
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
                <input readOnly value={chosen?.path ?? stand.at.path ?? ''} />
              </div>

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

              <div className="browse">
                <Verzeichnisbaum
                  nodes={tree}
                  chosen={chosen?.path}
                  onToggle={(knoten) => void toggleNode(knoten)}
                  onChoose={(knoten) => setChosen({ path: knoten.path, relativePath: knoten.relativePath })}

                />
                {(wurzel ? wurzel.children?.length : tree.length) === 0 && (
                  <p className="browse__empty">Keine Unterverzeichnisse</p>
                )}
              </div>


              {/*
                * Die Dateien des Verzeichnisses — nur, wenn eine gewählt werden
                * soll. Sie unter die Ordner zu mischen hieße, dass wer ein
                * Verzeichnis sucht, durch tausend Dateien scrollt.
                */}
              {waehle === 'DATEI' && (
                <div className="browse">
                  {(stand.at.files ?? []).length === 0 ? (
                    <p className="browse__empty">Keine Dateien in diesem Verzeichnis</p>
                  ) : (
                    <ul className="browse" onKeyDown={listentasten}>
                      {(stand.at.files ?? []).map((datei) => (
                        <li key={datei.path}>
                          <button
                            type="button"
                            className={chosen?.path === datei.path ? 'tree__name tree__row--chosen' : 'tree__name'}
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

              {/*
                * OK und Abbrechen, rechtsbündig — siehe `.modal__actions`.
                *
                * Vorher stand die Hauptaktion in einer eigenen Zeile und
                * darunter „Schließen": zwei Zeilen für eine Entscheidung, und
                * der Ausgang sah aus, als gehörte er nicht dazu.
                */}
              <div className="row modal__actions">
                <button
                  type="button"
                  disabled={waehle === 'DATEI' && !chosen}
                  onClick={() => {
                    // Der Pfad des Servers, in der Schreibweise des Feldes —
                    // und zwar der hervorgehobene, nicht der, in dem das
                    // Fenster gerade steht. Beides ist beim Öffnen dasselbe;
                    // sobald jemand im Baum etwas anklickt, ist es das nicht
                    // mehr, und dann zählt, was er angeklickt hat.
                    /*
                     * Der Pfad des Servers, in der Schreibweise des Feldes —
                     * und zwar der hervorgehobene, nicht der, in dem das
                     * Fenster gerade steht. Beides ist beim Öffnen dasselbe;
                     * sobald jemand im Baum etwas anklickt, ist es das nicht
                     * mehr, und dann zählt, was er angeklickt hat.
                     */
                    onWaehlen(
                      {
                        pfad: chosen?.path ?? stand.at!.path ?? '',
                        relativ: chosen?.relativePath ?? stand.at!.relativePath ?? '',
                      },
                      stand.at!
                    );
                  }}
                >
                  OK
                </button>
                <button type="button" className="secondary" onClick={onClose}>
                  Abbrechen
                </button>
              </div>
            </>
              );
            })()
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
        <input value={wert} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
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
function verzeichnisTeil(pfad: string): string {
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
  explain,
  titel,
  wert,
  disabled,
  lies,
  lege,
  onChange,
}: {
  label: string;
  explain?: ReactNode;
  /** Die Überschrift des Fensters — sie soll sagen, wofür das Verzeichnis gilt. */
  titel: string;
  wert: string;
  disabled?: boolean;
  lies(pfad: string): Promise<RemoteDirectoryResult>;
  lege?(elternPfad: string, name: string): Promise<{ ok: boolean; path?: string; message: string }>;
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
        <input value={wert} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
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
