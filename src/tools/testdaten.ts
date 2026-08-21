/**
 * Schreibt den Fallkatalog als echte Dateien aus.
 *
 *   npm run testdaten
 *   npm run testdaten -- --ziel D:\Proben
 *
 * Die Fälle leben in src/testing/consolidation/Faelle.ts und werden von dort
 * getestet. Als Dateien braucht man sie trotzdem: für den Vorführtermin, für
 * einen Kunden, der fragt „und was macht ihr mit sowas", und für jede Prüfung
 * von Hand. Eine Quelle, zwei Verwendungen — damit die Datei auf der Platte
 * nie etwas anderes enthält als der Test.
 */
import fs from 'node:fs';
import path from 'node:path';

import { alsBytes, FAELLE, NOCH_OFFEN } from '../testing/consolidation/Faelle.js';
import { MAPPEN } from '../testing/consolidation/Mappen.js';
import { ENDUNG, STRUKTUREN_OFFEN, STRUKTURFAELLE } from '../testing/consolidation/Strukturen.js';
import { writeXlsx } from '../testing/consolidation/Xlsx.js';

function main(argv: string[]): void {
  const stelle = argv.indexOf('--ziel');
  const ziel = path.resolve(stelle >= 0 ? argv[stelle + 1] : 'testdaten');

  fs.mkdirSync(ziel, { recursive: true });

  for (const fall of FAELLE) {
    fs.writeFileSync(path.join(ziel, `${fall.name}.csv`), alsBytes(fall.inhalt, fall.encoding));
  }

  for (const mappe of MAPPEN) {
    fs.writeFileSync(path.join(ziel, `${mappe.name}.xlsx`), writeXlsx(mappe.sheets));
  }

  for (const fall of STRUKTURFAELLE) {
    fs.writeFileSync(path.join(ziel, `${fall.name}.${ENDUNG[fall.format]}`), alsBytes(fall.inhalt, fall.encoding));
  }

  fs.writeFileSync(path.join(ziel, 'KATALOG.md'), katalog(), 'utf-8');

  const alle = [...FAELLE, ...MAPPEN, ...STRUKTURFAELLE];

  console.log(`${alle.length} Dateien geschrieben nach ${ziel}`);
  console.log(`Davon ${alle.filter((fall) => !fall.loesbar).length}, bei denen UniCom nachfragen muss.`);
}

function katalog(): string {
  const zeilen = [
    '# Fallkatalog Konsolidierung',
    '',
    'Erzeugt aus `src/testing/consolidation/Faelle.ts` mit `npm run testdaten`.',
    'Nicht von Hand ändern — die Testgrundlage ist die Quelldatei.',
    '',
    '| Datei | Zeichensatz | Region | Muss UniCom allein lösen | Zweck |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const fall of FAELLE) {
    zeilen.push(
      `| ${fall.name}.csv | ${fall.encoding} | ${fall.region.locale} | ${fall.loesbar ? 'ja' : 'nein — Prüffall'} | ${fall.zweck} |`
    );
  }

  zeilen.push('', '## Arbeitsmappen (Excel)', '');
  zeilen.push('| Datei | Blätter | Region | Muss UniCom allein lösen | Zweck |');
  zeilen.push('| --- | --- | --- | --- | --- |');

  for (const mappe of MAPPEN) {
    zeilen.push(
      `| ${mappe.name}.xlsx | ${mappe.sheets.map((sheet) => sheet.name).join(', ')} | ${mappe.region.locale} | ` +
        `${mappe.loesbar ? 'ja' : 'nein — Prüffall'} | ${mappe.zweck} |`
    );
  }

  zeilen.push('', '## Feste Feldbreiten, JSON und XML', '');
  zeilen.push('| Datei | Format | Region | Muss UniCom allein lösen | Zweck |');
  zeilen.push('| --- | --- | --- | --- | --- |');

  for (const fall of STRUKTURFAELLE) {
    zeilen.push(
      `| ${fall.name}.${ENDUNG[fall.format]} | ${fall.format} | ${fall.region.locale} | ` +
        `${fall.loesbar ? 'ja' : 'nein — Prüffall'} | ${fall.zweck} |`
    );
  }

  zeilen.push('', '## Noch nicht abgedeckt', '');

  for (const offen of [...NOCH_OFFEN, ...STRUKTUREN_OFFEN]) {
    zeilen.push(`* ${offen}`);
  }

  zeilen.push('');

  return zeilen.join('\n');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
