import fs from 'node:fs/promises';
import path from 'node:path';

import { MAX_FUNDE, type Bestand, type Bestandsauskunft, type Fund } from '../../domain/privacy/DataStore.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';

/**
 * Die Dateien in den Verzeichnissen der Mandanten.
 *
 * Hier wird **angezeigt und nicht angefasst**. Unikom kennt den Aufbau einer
 * fremden Ergebnisdatei nicht; sie umzuschreiben hieße, in Daten einzugreifen,
 * für die jemand anders geradesteht. Was Unikom kann, ist sagen: hier liegt
 * etwas, das auf den Begriff passt — und zwar mit Zeile und Datei.
 *
 * Gesucht wird im Dateinamen und, bei lesbaren Textdateien bis zu einer Größe,
 * auch im Inhalt. Eine Ergebnisdatei mit zehntausend Zeilen nützt niemandem,
 * wenn nur ihr Name durchsucht wird — der Name enthält den gesuchten Menschen
 * nämlich gerade nicht.
 */
const LESBAR = /\.(csv|txt|eml|json|xml|md|log)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

export function dateiBestand(tenants: TenantRepository): Bestand {
  return {
    key: 'dateien-mandant',
    name: 'Dateien in den Mandantenverzeichnissen',
    inhalt: 'Eingangsdateien, Arbeitsstände, Ergebnisse',
    ort: 'DATEISYSTEM',
    personenbezug: 'JA',
    aufbewahrung: 'je Workflow; Ergebnisse unbegrenzt',
    behandlung: 'ANZEIGEN',
    // Jeder Mandant hat sein eigenes Wurzelverzeichnis; enger geht es nicht.
    mandantenweise: true,

    async suchen(begriff, tenantId, grenze = MAX_FUNDE): Promise<Bestandsauskunft> {
      const alle = await tenants.list();
      const gemeint = tenantId ? alle.filter((mandant) => mandant.id === tenantId) : alle;
      const funde: Fund[] = [];
      let treffer = 0;
      let ungelesen = 0;

      for (const mandant of gemeint) {
        if (!mandant.rootDirectory) {
          continue;
        }

        for await (const datei of dateien(mandant.rootDirectory)) {
          const imNamen = path.basename(datei).toLowerCase().includes(begriff.toLowerCase());
          let gefunden = { anzahl: 0, zeilen: [] as string[] };

          if (LESBAR.test(datei)) {
            try {
              gefunden = await passendeZeilen(datei, begriff, grenze);
            } catch {
              ungelesen += 1;
            }
          }

          if (!imNamen && gefunden.anzahl === 0) {
            continue;
          }

          treffer += Math.max(1, gefunden.anzahl);

          /*
           * Jede getroffene Zeile ist eine eigene Fundstelle.
           *
           * Vorher stand hier eine je Datei mit der ersten Zeile als Auszug.
           * Für eine Auskunft ist das zu wenig: Wer wissen will, was über ihn
           * gespeichert ist, bekommt dann eine Datei genannt und eine von
           * dreißig Zeilen gezeigt.
           */
          for (const zeile of gefunden.zeilen.length > 0 ? gefunden.zeilen : [path.basename(datei)]) {
            if (funde.length >= grenze) {
              break;
            }

            funde.push({ wo: datei, auszug: zeile });
          }
        }
      }

      return {
        key: 'dateien-mandant',
        name: 'Dateien in den Mandantenverzeichnissen',
        treffer,
        behandlung: 'ANZEIGEN',
        funde,
        hinweis:
          'Unikom zeigt diese Fundstellen an und ändert sie nicht. Den Aufbau einer Ergebnisdatei kennt es nicht; ' +
          'was darin zu geschehen hat, entscheidet der Mandant' +
          (ungelesen > 0 ? `. ${ungelesen} Datei(en) waren nicht lesbar und wurden übergangen` : ''),
      };
    },

    async ausfuehren(): Promise<number> {
      return 0;
    },
  };
}

async function* dateien(wurzel: string): AsyncGenerator<string> {
  let eintraege;

  try {
    eintraege = await fs.readdir(wurzel, { withFileTypes: true });
  } catch {
    // Ein Verzeichnis, das es nicht gibt oder das verschlossen ist, ist kein
    // Grund, die ganze Auskunft scheitern zu lassen.
    return;
  }

  for (const eintrag of eintraege) {
    const voll = path.join(wurzel, eintrag.name);

    if (eintrag.isDirectory()) {
      yield* dateien(voll);
    } else if (eintrag.isFile()) {
      yield voll;
    }
  }
}

/**
 * Die getroffenen Zeilen einer Datei — und wie viele es wirklich sind.
 *
 * Die Zahl und die Auswahl sind getrennt, weil sie verschiedenen Zwecken
 * dienen. Vorher wurden fünf Zeilen zurückgegeben und dieselben fünf gezählt:
 * Eine Datei mit dreißig Treffern meldete fünf, und die Auskunft nannte eine
 * Zahl, die zu niedrig war, ohne es zu sagen.
 */
async function passendeZeilen(
  datei: string,
  begriff: string,
  hoechstens: number
): Promise<{ anzahl: number; zeilen: string[] }> {
  const angaben = await fs.stat(datei);

  if (angaben.size > MAX_BYTES) {
    return { anzahl: 0, zeilen: [] };
  }

  const inhalt = await fs.readFile(datei, 'utf-8');
  const gesucht = begriff.toLowerCase();
  const getroffen = inhalt.split(/\r\n|\r|\n/).filter((zeile) => zeile.toLowerCase().includes(gesucht));

  return { anzahl: getroffen.length, zeilen: getroffen.slice(0, hoechstens) };
}
