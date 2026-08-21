import type { RemoteDirectoryEntry } from '../../api/types.js';

/**
 * Ein Knoten im Verzeichnisbaum.
 *
 * `children` fehlt, solange niemand aufgeklappt hat — und das ist die ganze
 * Idee: Jede Ebene kostet bei SFTP und FTPS eine Verbindung, bei einer Freigabe
 * einen Platz in der Warteschlange des Servers. Ein Baum, der beim Öffnen alles
 * holt, wäre auf einer schnellen Platte bequem und an einer langsamen Leitung
 * unbenutzbar. Geholt wird, was jemand ansieht.
 *
 * `undefined` und `[]` sind deshalb zwei verschiedene Dinge: noch nicht geholt
 * gegen geholt und leer. Ohne diesen Unterschied fragte der Baum bei jedem
 * Klick erneut nach einem Verzeichnis, von dem er schon weiß, dass nichts darin
 * liegt.
 */
export interface TreeNode {
  name: string;
  path: string;
  /** Ohne das Remote-Arbeitsverzeichnis — so, wie es ins Eingabefeld gehört. */
  relativePath: string;
  children?: TreeNode[];
  open: boolean;
  busy: boolean;
  /** Was schiefging, an dem Zweig, an dem es schiefging. */
  error?: string;
}

/** Was der Server aufgelistet hat, als noch nicht aufgeklappte Knoten. */
export function toNodes(entries: RemoteDirectoryEntry[]): TreeNode[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    relativePath: entry.relativePath,
    open: false,
    busy: false,
  }));
}

/**
 * Ersetzt genau einen Knoten und lässt alle übrigen, wie sie sind.
 *
 * Der Baum wird neu aufgebaut statt an Ort und Stelle geändert: React erkennt
 * eine Änderung an einem neuen Objekt, nicht an einem veränderten. Wer hier in
 * die vorhandene Liste hineinschriebe, bekäme einen Baum, der sich erst beim
 * nächsten Klick irgendwo anders neu zeichnet — der Fehler, den man auf die
 * Datenübertragung schiebt, weil er wie eine langsame Antwort aussieht.
 */
export function mapNode(nodes: TreeNode[], path: string, change: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return change(node);
    }

    return node.children ? { ...node, children: mapNode(node.children, path, change) } : node;
  });
}

/** Der Knoten zu diesem Pfad, gleich wie tief er liegt. */
export function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    const gefunden = node.children ? findNode(node.children, path) : undefined;

    if (gefunden) {
      return gefunden;
    }
  }

  return undefined;
}
