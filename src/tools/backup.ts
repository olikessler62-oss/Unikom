/**
 * Sicherung der Unikom-Datenbank — im laufenden Betrieb.
 *
 *   npm run backup
 *   npm run backup -- --ziel D:\Sicherungen
 *
 * Die Datenbank besteht aus drei Dateien (unikom.db, -wal, -shm), und der
 * jüngste Stand steht meist im Write-ahead-Log, nicht in der .db. Wer die .db
 * kopiert, sichert deshalb den älteren Teil und merkt es erst, wenn er die
 * Sicherung braucht.
 *
 * `VACUUM INTO` schreibt stattdessen einen in sich stimmigen Stand in eine
 * einzige Datei, ohne den Server anzuhalten.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { assertDataDirectoryIsLocal } from '../infrastructure/persistence/sqlite/DataDirectory.js';
import {
  backupDatabase,
  BUSY_TIMEOUT_MS,
  DATABASE_FILENAME,
} from '../infrastructure/persistence/sqlite/SqliteDatabase.js';

function main(argv: string[]): void {
  const dataDirectory = path.resolve(process.env.UNIKOM_DATA_DIRECTORY ?? 'application-data');
  const quelle = path.join(dataDirectory, DATABASE_FILENAME);

  if (!fs.existsSync(quelle)) {
    // Ohne diese Prüfung legte SQLite eine leere Datenbank an und die
    // Sicherung meldete Erfolg über nichts.
    throw new Error(
      `In „${dataDirectory}“ liegt keine Datenbank. Erwartet wird ${DATABASE_FILENAME}; ` +
        'mit UNIKOM_DATA_DIRECTORY lässt sich ein anderes Datenverzeichnis angeben'
    );
  }

  assertDataDirectoryIsLocal(dataDirectory);

  const zielVerzeichnis = path.resolve(zielAus(argv) ?? path.join(dataDirectory, 'backups'));
  const ziel = path.join(zielVerzeichnis, `unikom-${zeitstempel(new Date())}.db`);

  const database = new DatabaseSync(quelle);

  try {
    // Der Server schreibt möglicherweise gerade; einen Augenblick warten ist
    // besser, als die Sicherung an einem SQLITE_BUSY scheitern zu lassen.
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    backupDatabase(database, ziel);
  } finally {
    database.close();
  }

  const groesse = fs.statSync(ziel).size;

  console.log(`Sicherung geschrieben: ${ziel}`);
  console.log(`Größe: ${(groesse / 1024 / 1024).toFixed(1)} MB`);
  console.log('');
  console.log('Es ist eine einzige, vollständige Datei. Zum Zurückspielen wird sie bei angehaltenem');
  console.log(`Server nach ${quelle} kopiert; eine vorhandene .db-wal und .db-shm daneben müssen fort.`);
}

/** Ein Name, der sich von selbst sortiert und ohne Datenbank lesbar ist. */
function zeitstempel(moment: Date): string {
  const zweistellig = (wert: number): string => String(wert).padStart(2, '0');

  return [
    moment.getFullYear(),
    zweistellig(moment.getMonth() + 1),
    zweistellig(moment.getDate()),
  ].join('-') + `-${zweistellig(moment.getHours())}${zweistellig(moment.getMinutes())}`;
}

function zielAus(argv: string[]): string | undefined {
  const stelle = argv.indexOf('--ziel');
  return stelle >= 0 ? argv[stelle + 1] : undefined;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
