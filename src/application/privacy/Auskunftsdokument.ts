import type { Bestandsauskunft } from '../../domain/privacy/DataStore.js';
import type { Auskunft, Loeschbericht } from './PrivacyService.js';

/**
 * Die Auskunft als Datei, so wie man sie aus der Hand gibt (FR_009,
 * Abschnitt 6).
 *
 * Sie entsteht auf dem Server und nicht im Browser, aus demselben Grund wie das
 * Laufprotokoll: Der Bildschirm zeigt eine Auswahl, die Datei muss vollständig
 * sein. Eine Auskunft nach Artikel 15, die stillschweigend bei fünfzig Zeilen
 * aufhört, ist schlimmer als keine — der Empfänger hält sie für vollständig.
 * Wo die Datei doch etwas weglässt, steht es darin.
 *
 * Reiner Text: Gelesen wird sie von einem Menschen, oft ausgedruckt und mit
 * einem Anschreiben. Zeitangaben in Ortszeit, wie überall in Unikom.
 */

function moment(value: Date): string {
  const pad = (number: number): string => String(number).padStart(2, '0');

  return (
    `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function stempel(value: Date): string {
  const pad = (number: number): string => String(number).padStart(2, '0');

  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `_${pad(value.getHours())}${pad(value.getMinutes())}`
  );
}

/** Alles, was in einem Dateinamen Ärger macht, wird zum Bindestrich — auf allen drei Systemen. */
function alsDateiname(begriff: string): string {
  const sauber = begriff.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');

  // Ein Begriff aus lauter Sonderzeichen ließe sonst einen Dateinamen mit einer
  // Lücke darin zurück.
  return sauber.length > 0 ? sauber.slice(0, 40) : 'Suche';
}

export function auskunftsdateiname(begriff: string, erstellt: Date): string {
  return `Unikom_Auskunft_${alsDateiname(begriff)}_${stempel(erstellt)}.txt`;
}

export function loeschbelegDateiname(begriff: string, erstellt: Date): string {
  return `Unikom_Loeschbeleg_${alsDateiname(begriff)}_${stempel(erstellt)}.txt`;
}

/** Die Zeitangabe eines Fundes, falls es eine gibt. */
function wann(value?: string): string {
  if (!value) {
    return '';
  }

  const gelesen = new Date(value);

  return Number.isNaN(gelesen.getTime()) ? ` [${value}]` : ` [${moment(gelesen)}]`;
}

function bestandsabschnitt(bestand: Bestandsauskunft): string[] {
  const zeilen = [`${bestand.name} — ${bestand.treffer} Fundstelle(n)`, '-'.repeat(72)];

  if (bestand.hinweis) {
    zeilen.push(bestand.hinweis, '');
  }

  if (bestand.treffer === 0) {
    zeilen.push('Keine Fundstelle.', '');
    return zeilen;
  }

  for (const fund of bestand.funde) {
    zeilen.push(`  ${fund.wo}${wann(fund.wann)}`, `      ${fund.auszug}`);
  }

  /*
   * Der Satz, der diese Datei brauchbar macht.
   *
   * Wenn die Grenze doch einmal greift, muss der Leser es wissen — sonst
   * bestätigt er einer betroffenen Person Vollständigkeit, die er nicht hat.
   */
  if (bestand.funde.length < bestand.treffer) {
    zeilen.push(
      '',
      `  Hinweis: Von ${bestand.treffer} Fundstellen sind hier ${bestand.funde.length} aufgeführt. ` +
        'Die übrigen wurden aus Umfangsgründen weggelassen; eine engere Suche zeigt sie'
    );
  }

  zeilen.push('');
  return zeilen;
}

export function auskunftsdokument(
  auskunft: Auskunft,
  angaben: { erstellt: Date; mandant?: string; veranlasser?: string }
): string {
  const kopf = [
    'Unikom — Auskunft über gespeicherte Daten',
    '',
    `Suchbegriff   ${auskunft.begriff}`,
    `Mandant       ${angaben.mandant ?? 'alle Mandanten dieser Installation'}`,
    `Erstellt      ${moment(angaben.erstellt)}`,
    angaben.veranlasser ? `Durch         ${angaben.veranlasser}` : undefined,
    `Fundstellen   ${auskunft.treffer} in ${auskunft.bestaende.filter((bestand) => bestand.treffer > 0).length} von ${auskunft.bestaende.length} Beständen`,
    '',
    'Diese Auskunft wurde aus dem tatsächlichen Zustand dieser Installation erzeugt.',
    'Sie umfasst jeden Bestand, den Unikom führt — auch die, in denen nichts gefunden wurde.',
    '',
    '='.repeat(72),
    '',
  ].filter((zeile): zeile is string => zeile !== undefined);

  const abschnitte = auskunft.bestaende.flatMap((bestand) => bestandsabschnitt(bestand));

  const fuss = [
    '='.repeat(72),
    '',
    'Was diese Auskunft nicht abdeckt',
    '',
    'Unikom transportiert Daten in Ziele, die der Betreiber eingerichtet hat — fremde',
    'Server, Verzeichnisse, Datenbanken. Was dort aus den Daten geworden ist, weiß es',
    'nicht und kann es nicht sagen. Für diese Ziele ist gesondert nachzufassen.',
    '',
  ];

  if (auskunft.nurAnzeige.length > 0) {
    fuss.push(
      'In folgenden Beständen zeigt Unikom nur an und ändert nichts:',
      ...auskunft.nurAnzeige.map((name) => `  - ${name}`),
      ''
    );
  }

  return [...kopf, ...abschnitte, ...fuss].join('\n');
}

/**
 * Der Beleg über einen ausgeführten Löschauftrag.
 *
 * Er entsteht im selben Zug wie die Löschung und nicht später: Danach findet
 * eine zweite Suche nichts mehr, und ein Beleg, der „nichts gefunden" sagt,
 * belegt gar nichts.
 */
export function loeschbelegDokument(bericht: Loeschbericht, angaben: { mandant?: string }): string {
  const summe = bericht.entfernt.reduce((wert, eintrag) => wert + eintrag.stellen, 0);

  const zeilen = [
    'Unikom — Beleg über einen ausgeführten Löschauftrag',
    '',
    `Suchbegriff   ${bericht.begriff}`,
    `Mandant       ${angaben.mandant ?? 'alle Mandanten dieser Installation'}`,
    `Ausgeführt    ${moment(bericht.zeitpunkt)}`,
    bericht.veranlasser ? `Durch         ${bericht.veranlasser}` : undefined,
    `Umfang        ${summe} Stelle(n)`,
    '',
    '='.repeat(72),
    '',
    'Was entfernt wurde',
    '',
  ].filter((zeile): zeile is string => zeile !== undefined);

  for (const eintrag of bericht.entfernt) {
    const art = eintrag.behandlung === 'SCHWAERZEN' ? 'unkenntlich gemacht' : 'gelöscht';

    zeilen.push(`  ${eintrag.name}: ${eintrag.stellen} Stelle(n) ${art}`);
  }

  zeilen.push(
    '',
    'Geschwärzt heißt: Die Zeile bleibt, der Wert darin geht. Dass eine Verarbeitung',
    'stattgefunden hat, muss nachvollziehbar bleiben (SPEC-05); der Name darin nicht.',
    ''
  );

  if (bericht.offen.length > 0) {
    zeilen.push(
      '='.repeat(72),
      '',
      'Was nicht entfernt wurde und von Hand zu prüfen ist',
      ''
    );

    for (const bestand of bericht.offen) {
      zeilen.push(`  ${bestand.name}: ${bestand.treffer} Fundstelle(n)`);

      if (bestand.hinweis) {
        zeilen.push(`      ${bestand.hinweis}`);
      }

      for (const fund of bestand.funde) {
        zeilen.push(`      - ${fund.wo}`);
      }

      zeilen.push('');
    }
  }

  zeilen.push(
    '='.repeat(72),
    '',
    'Dieser Beleg deckt ab, was in dieser Installation liegt. Daten, die bereits in',
    'ein Ziel außerhalb geflossen sind, sind dort gesondert zu löschen; Unikom kann',
    'das weder tun noch nachprüfen.',
    ''
  );

  return zeilen.join('\n');
}
