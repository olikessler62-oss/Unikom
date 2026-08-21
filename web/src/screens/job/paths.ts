/**
 * Ein Pfad, zerlegt in seine anklickbaren Teile.
 *
 * Drei Schreibweisen kommen vor, und alle drei stehen im selben Fenster: ein
 * Laufwerkspfad (`C:\a\b`), ein Netzwerkpfad (`\\Server\Freigabe\a`) und ein
 * Serverpfad (`/kunde/eingang`). Sie unterscheiden sich nur in ihrer Wurzel —
 * beim Netzwerkpfad gehören Server *und* Freigabe dazu, denn eine Ebene über
 * der Freigabe gibt es nichts mehr anzusehen.
 *
 * Ohne diese Leiste geht es nur über „eine Ebene höher", einmal je Ebene: Von
 * `…\kunde-a\2026\eingang` zurück nach `…\kunde-a` sind das drei Klicks, und dazwischen
 * lädt jedes Mal ein Verzeichnis, das niemand sehen wollte.
 */
export function pathSegments(full: string): { label: string; path: string }[] {
  const wert = full.trim();

  if (wert === '') {
    return [];
  }

  if (wert.startsWith('\\\\')) {
    const teile = wert.slice(2).split(/[\\/]+/).filter(Boolean);
    const wurzel = `\\\\${teile.slice(0, 2).join('\\')}`;

    return [{ label: wurzel, path: wurzel }, ...aufbauen(teile.slice(2), wurzel, '\\')];
  }

  const laufwerk = /^([A-Za-z]:)[\\/]?/.exec(wert);

  if (laufwerk) {
    const teile = wert.slice(laufwerk[0].length).split(/[\\/]+/).filter(Boolean);

    return [{ label: laufwerk[1], path: `${laufwerk[1]}\\` }, ...aufbauen(teile, laufwerk[1], '\\')];
  }

  const teile = wert.split('/').filter(Boolean);

  return [{ label: '/', path: '/' }, ...aufbauen(teile, '', '/')];
}

function aufbauen(teile: string[], wurzel: string, trenner: string): { label: string; path: string }[] {
  let gelaufen = wurzel;

  return teile.map((teil) => {
    gelaufen = `${gelaufen}${trenner}${teil}`;
    return { label: teil, path: gelaufen };
  });
}
