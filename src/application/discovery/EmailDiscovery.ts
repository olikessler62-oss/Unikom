import { discover, discoverFields, type DataBlock, type DiscoveryOptions } from '../../domain/discovery/Discovery.js';
import { parseEmail, type EmailMessage } from '../../infrastructure/formats/Email.js';
import { readXlsx } from '../../infrastructure/formats/Xlsx.js';

/**
 * Eine E-Mail durch dieselbe Data-Discovery-Engine schicken wie jeden anderen
 * Inhalt (FR_007, Abschnitt 11 und 12).
 *
 * Der Rumpf und jeder Anhang sind für die Engine nur Inhalt. Was sie
 * unterscheidet, ist die **Herkunft**: Bei einem Block muss später
 * nachvollziehbar sein, ob er aus dem Text der Nachricht kam oder aus
 * „Bestellung.xlsx", Blatt „Bestellungen".
 */
export interface BlockQuelle {
  art: 'BODY' | 'ATTACHMENT';
  /** Der Dateiname des Anhangs, sofern der Block von dort kommt. */
  filename?: string;
  /** Das Tabellenblatt, sofern der Anhang eine Arbeitsmappe ist. */
  sheet?: string;
}

export interface QuellBlock {
  quelle: BlockQuelle;
  block: DataBlock;
}

export interface EmailDiscoveryResult {
  message: EmailMessage;
  blocks: QuellBlock[];
  notes: string[];
}

/** Anhänge, die keine Daten tragen können — Bilder, Unterschriften, Logos. */
const UNINTERESSANT = /\.(png|jpe?g|gif|bmp|svg|ico|zip|exe|dll|p7s|vcf)$/i;

export function discoverEmail(roh: Buffer | string, options: DiscoveryOptions): EmailDiscoveryResult {
  const message = parseEmail(roh);
  const blocks: QuellBlock[] = [];
  const notes = [...message.notes];

  for (const block of discover(message.body, options).blocks) {
    blocks.push({ quelle: { art: 'BODY' }, block });
  }

  for (const anhang of message.attachments) {
    if (UNINTERESSANT.test(anhang.filename)) {
      continue;
    }

    try {
      blocks.push(...ausAnhang(anhang.filename, anhang.content, options));
    } catch (error) {
      // Ein Anhang, der sich nicht lesen lässt, darf die Nachricht nicht
      // wertlos machen — der Rumpf und die anderen Anhänge stehen weiter.
      notes.push(
        `Der Anhang „${anhang.filename}" ließ sich nicht lesen: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (blocks.length === 0) {
    notes.push('In dieser Nachricht wurde keine eindeutige Datenstruktur gefunden');
  }

  return { message, blocks, notes };
}

function ausAnhang(filename: string, inhalt: Buffer, options: DiscoveryOptions): QuellBlock[] {
  if (/\.xlsx$/i.test(filename)) {
    const mappe = readXlsx(inhalt);

    return mappe.sheets.flatMap((blatt) =>
      discoverFields(
        blatt.rows.map((zeile) => zeile.map((zelle) => zelle.text)),
        options
      ).blocks.map((block) => ({ quelle: { art: 'ATTACHMENT' as const, filename, sheet: blatt.name }, block }))
    );
  }

  // Alles andere — CSV, TXT, was auch immer — ist Text und geht denselben Weg
  // wie der Rumpf. Ein eigener Zweig je Dateiendung wäre genau die zweite
  // Erkennungslogik, die FR_007 ausschließt.
  return discover(inhalt.toString('utf-8'), options).blocks.map((block) => ({
    quelle: { art: 'ATTACHMENT' as const, filename },
    block,
  }));
}

/** Wie die Herkunft einem Menschen gezeigt wird. */
export function quelleAlsText(quelle: BlockQuelle): string {
  if (quelle.art === 'BODY') {
    return 'Text der Nachricht';
  }

  return quelle.sheet ? `Anhang ${quelle.filename}, Blatt „${quelle.sheet}"` : `Anhang ${quelle.filename}`;
}
