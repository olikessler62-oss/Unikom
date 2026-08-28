/**
 * Die Symbole des Hauptmenüs.
 *
 * Als Pfade im Code und nicht als Symbolbibliothek: Die Anwendung läuft auf dem
 * Server des Kunden, oft ohne Internet — ein Paket vom CDN wäre eine
 * Abhängigkeit, die genau dann ausfällt, wenn sie nicht darf. Und ein ganzes
 * Symbolpaket für zehn Zeichen einzubinden wäre ein Megabyte für ein Kilobyte
 * Nutzen.
 *
 * Alle sind aus derselben Grammatik gezeichnet: 24er-Raster, nur Linien, keine
 * Flächen, gleiche Strichstärke. Farbe kommt von der Schrift daneben, damit
 * Symbol und Wort nie auseinanderlaufen.
 */
const PATHS: Record<string, string> = {
  // Vier Felder — der Blick auf alles.
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  // Ein Rechteck mit laufender Anzeige: was gerade tut.
  jobs: 'M3 5h18v14H3zM7 12l3 3 5-6',
  // Uhr mit Zeiger — was gewesen ist.
  history: 'M12 21a9 9 0 1 0-9-9M12 7v5l3 2M3 12l-2-2M3 12l2-2',
  // Knoten und Verbindungen — die Kette.
  workflows: 'M6 6h4v4H6zM14 14h4v4h-4zM10 8h2a2 2 0 0 1 2 2v4',
  // Ein Haus mit Etagen — der Mandant.
  tenants: 'M4 20V7l8-4 8 4v13M9 20v-5h6v5M8 10h.01M12 10h.01M16 10h.01',
  /*
   * Ein Kasten mit einem Häkchen, das über seinen Rand hinausführt — etwas, das
   * abzuhaken ist.
   *
   * Hier standen einmal drei Zuflüsse, die zu einem werden: das Bild der
   * Konsolidierung. Der Punkt heißt aber nicht mehr so, und er meint auch nicht
   * mehr das: Konsolidiert wird nachts, ohne Zuschauer. Was hier liegt, ist eine
   * Liste, die jemand abarbeitet.
   *
   * Kein Ausrufezeichen und kein Warndreieck: Beides hieße „da ist etwas
   * schiefgegangen". Ein offener Konflikt ist aber kein Fehler, sondern eine
   * Frage — der Lauf hat sie richtigerweise nicht selbst beantwortet.
   */
  consolidation: 'M20 11v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9M9 11l3 3 8-8',
  // Person mit Schultern.
  users: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20a7 7 0 0 1 14 0',
  // Zahnrad, auf die Linien reduziert.
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  // Tür mit Pfeil hinaus.
  signOut: 'M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M17 15l3-3-3-3M10 12h10',
  // Schild — was geschützt wird.
  privacy: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  /*
   * Dasselbe Schild mit einer Lupe darin: Auskunft und Löschauftrag sind das
   * Suchen im Geschützten. Ein Schild allein stünde zweimal im Menü — einmal
   * für die Erklärung, einmal für die Arbeit — und wäre dann kein Zeichen mehr,
   * sondern eine Verwechslung.
   */
  enquiry: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM11.2 11.4a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 0 0-5.2 0zM10 15.2l2-2',
  /*
   * Eine Kiste mit Deckel und Griff — was fortgestellt und aufbewahrt wird.
   * Kein Schloss davor: Verschlüsselt ist hier alles, das unterschiede das
   * Archiv von nichts.
   */
  archiv: 'M3 7h18v4H3zM5 11v9h14v-9M10 15h4',
  // Blatt mit Zeilen.
  imprint: 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4',
};

export function MenuIcon({ name }: { name: string }) {
  const path = PATHS[name];

  // Ein fehlendes Symbol lässt den Menüpunkt stehen, statt ihn zu zerlegen.
  if (!path) {
    return null;
  }

  return (
    <svg className="sidebar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}
