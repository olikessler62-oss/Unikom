import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDataDirectoryIsLocal, kindOfPath } from './DataDirectory.js';

const lokal = { platform: 'win32', istNetzlaufwerk: () => false };
const imNetz = { platform: 'win32', istNetzlaufwerk: () => true };

test('eine Freigabe wird als solche erkannt', () => {
  assert.equal(kindOfPath('\\\\FILESERVER\\unikom-daten', lokal), 'UNC');
  assert.equal(kindOfPath('//FILESERVER/unikom-daten', lokal), 'UNC');
  assert.equal(kindOfPath('\\\\?\\UNC\\FILESERVER\\unikom-daten', lokal), 'UNC');
});

test('ein langer Pfad auf eine lokale Platte ist lokal, trotz der zwei Schrägstriche', () => {
  // \\?\C:\… sieht aus wie eine Freigabe und ist keine. Wer das verwechselt,
  // weist einen zulässigen Pfad ab und der Kunde kommt nicht mehr hoch.
  assert.equal(kindOfPath('\\\\?\\C:\\ProgramData\\UniCom', lokal), 'LOKAL');
});

test('ein verbundenes Netzlaufwerk zählt wie eine Freigabe', () => {
  // Es sieht im Pfad aus wie eine Platte, ist aber dieselbe Freigabe mit
  // denselben Sperren.
  assert.equal(kindOfPath('X:\\unikom-daten', imNetz), 'NETZLAUFWERK');
  assert.equal(kindOfPath('X:\\unikom-daten', lokal), 'LOKAL');
});

test('lokale Pfade bleiben lokal', () => {
  assert.equal(kindOfPath('C:\\ProgramData\\UniCom', lokal), 'LOKAL');
  assert.equal(kindOfPath('application-data', lokal), 'LOKAL');
  assert.equal(kindOfPath('/var/lib/unikom', { platform: 'linux' }), 'LOKAL');
});

test('unter Linux entscheidet der Pfad nicht über das Dateisystem', () => {
  // /mnt/nfs/daten ist ein eingehängtes Netzdateisystem und von außen nicht
  // vom lokalen Verzeichnis zu unterscheiden. Die Prüfung behauptet das auch
  // nicht — die Regel steht in SPEC-01, Abschnitt 12.
  assert.equal(kindOfPath('/mnt/nfs/daten', { platform: 'linux' }), 'LOKAL');

  // Die Windows-Schreibweise wird trotzdem überall abgewiesen: Sie kann nur
  // aus einer Einstellung stammen, die für Windows gedacht war.
  assert.equal(kindOfPath('\\\\FILESERVER\\daten', { platform: 'linux' }), 'UNC');
});

test('die Absage nennt den Grund und was weiterhin im Netz liegen darf', () => {
  assert.throws(
    () => assertDataDirectoryIsLocal('\\\\FILESERVER\\unikom-daten', 'UNC'),
    (error: Error) => {
      assert.match(error.message, /Netzwerkfreigabe/);
      assert.match(error.message, /beschädigt/);
      assert.match(error.message, /UNIKOM_DATA_DIRECTORY/);
      // Ohne diesen Satz liest ein Kunde die Meldung als „Unikom kann keine
      // Freigaben" — und das wäre das Gegenteil des Produkts.
      assert.match(error.message, /Quellen und Ziele der Übertragung dürfen weiterhin im Netz liegen/);
      return true;
    }
  );
});

test('ein lokales Verzeichnis kommt ohne Beanstandung durch', () => {
  assert.doesNotThrow(() => assertDataDirectoryIsLocal('C:\\ProgramData\\UniCom', 'LOKAL'));
});
