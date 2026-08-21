import type { FieldType } from '../consolidation/Recognition.js';

/**
 * Die ausgelieferte Bezeichnungsliste (SPEC-09, Abschnitt 4).
 *
 * Ohne sie bliebe der Anspruch der Spec unerfüllbar: V1 enthält keine KI, die
 * aus einem Feldnamen Bedeutung ableitet (SPEC-11), und der Kunde soll die
 * Zuordnungen gerade **nicht** selbst pflegen müssen. Also bringt Unikom mit,
 * was es weiß.
 *
 * Sie wird wie ein Programmbestandteil gepflegt und ausgeliefert. Erweitern
 * kann der Kunde sie; mandantenspezifische Einträge gehen den ausgelieferten
 * vor (SPEC-02, Abschnitt 16).
 *
 * ## Warum hier Typen stehen und nicht nur Namen
 *
 * „Die semantische Zuordnung darf nicht ausschließlich anhand des Feldnamens
 * erfolgen" (SPEC-09, Abschnitt 4). Eine Spalte „Geburtsdatum", in der Namen
 * stehen, ist keine Geburtsdatumsspalte, sondern ein falsch beschrifteter
 * Export — und wer nur den Namen liest, leitet sie still ins Datumsfeld.
 * Deshalb trägt jeder Eintrag die Typen, die zu ihm passen.
 */
export interface Bezeichnung {
  /** Das interne Feld, auf das zugeordnet wird. */
  intern: string;
  /** Wie es einem Menschen gegenüber heißt. */
  label: string;
  /** Bekannte Schreibweisen, in mehreren Sprachen. */
  namen: readonly string[];
  /** Welche Datentypen dazu passen; leer heißt: jeder. */
  typen?: readonly FieldType[];
  /** Was die Zuordnung sonst noch stützt — eine Kurzbeschreibung für Menschen. */
  hinweis?: string;
}

const TEXT: readonly FieldType[] = ['STRING'];
const KENNUNG: readonly FieldType[] = ['STRING', 'INTEGER'];
const ZAHL: readonly FieldType[] = ['INTEGER', 'DECIMAL'];
const DATUM: readonly FieldType[] = ['DATE', 'DATETIME'];

/**
 * Der ausgelieferte Bestand.
 *
 * Bewusst kurz gehalten und auf das beschränkt, was in kaufmännischen Daten
 * wirklich ständig vorkommt. Eine Liste mit dreihundert Einträgen sähe
 * beeindruckender aus und brächte mehr Mehrdeutigkeit als Nutzen — jeder
 * zusätzliche Eintrag ist eine weitere Gelegenheit, dass zwei interne Felder
 * denselben Namen beanspruchen.
 */
export const AUSGELIEFERT: readonly Bezeichnung[] = [
  {
    intern: 'customerId',
    label: 'Kundennummer',
    typen: KENNUNG,
    namen: [
      'Kundennummer',
      'Kundennr',
      'Kunden-Nr',
      'Kunden-ID',
      'KundenID',
      'Kunde-ID',
      'Debitor',
      'Debitorennummer',
      'Customer ID',
      'CustomerID',
      'Customer No',
      'Customer Number',
      'Customer_Number',
      'Client ID',
      'Account Number',
    ],
  },
  {
    intern: 'customerName',
    label: 'Kundenname',
    typen: TEXT,
    namen: ['Kunde', 'Kundenname', 'Name', 'Firma', 'Firmenname', 'Customer', 'Customer Name', 'Company', 'Account Name'],
  },
  {
    intern: 'orderNumber',
    label: 'Bestellnummer',
    typen: KENNUNG,
    namen: [
      'Bestellnummer',
      'Bestellnr',
      'Bestell-Nr',
      'Auftragsnummer',
      'Auftragsnr',
      'Auftrags-Nr',
      'Order ID',
      'Order No',
      'Order Number',
      'PO Number',
    ],
  },
  {
    intern: 'invoiceNumber',
    label: 'Rechnungsnummer',
    typen: KENNUNG,
    namen: ['Rechnungsnummer', 'Rechnungsnr', 'Rechnungs-Nr', 'Beleg', 'Belegnummer', 'Invoice ID', 'Invoice No', 'Invoice Number'],
  },
  {
    intern: 'articleNumber',
    label: 'Artikelnummer',
    typen: KENNUNG,
    namen: [
      'Artikelnummer',
      'Artikelnr',
      'Artikel-Nr',
      'Artikel-ID',
      'Sachnummer',
      'Materialnummer',
      'SKU',
      'Item ID',
      'Item No',
      'Item Number',
      'Product ID',
      'Part Number',
    ],
  },
  {
    intern: 'articleName',
    label: 'Artikelbezeichnung',
    typen: TEXT,
    namen: ['Artikel', 'Artikelbezeichnung', 'Bezeichnung', 'Beschreibung', 'Item', 'Item Name', 'Description', 'Product Name'],
  },
  {
    intern: 'quantity',
    label: 'Menge',
    typen: ZAHL,
    namen: ['Menge', 'Anzahl', 'Stückzahl', 'Stueckzahl', 'Quantity', 'Qty', 'Amount of Items', 'Units'],
  },
  {
    intern: 'unitPrice',
    label: 'Einzelpreis',
    typen: ZAHL,
    namen: ['Einzelpreis', 'Stückpreis', 'Stueckpreis', 'Preis', 'Unit Price', 'Price', 'Price per Unit'],
  },
  {
    intern: 'totalAmount',
    label: 'Gesamtbetrag',
    typen: ZAHL,
    namen: ['Gesamtbetrag', 'Gesamtpreis', 'Betrag', 'Summe', 'Rechnungsbetrag', 'Total', 'Total Amount', 'Net Amount', 'Gross Amount'],
  },
  {
    intern: 'currency',
    label: 'Währung',
    typen: TEXT,
    namen: ['Währung', 'Waehrung', 'Currency', 'Curr', 'ISO-Währung'],
  },
  {
    intern: 'orderDate',
    label: 'Bestelldatum',
    typen: DATUM,
    namen: ['Bestelldatum', 'Auftragsdatum', 'Datum', 'Belegdatum', 'Order Date', 'Date', 'Document Date'],
  },
  {
    intern: 'dueDate',
    label: 'Fälligkeitsdatum',
    typen: DATUM,
    namen: ['Fälligkeit', 'Faelligkeit', 'Fälligkeitsdatum', 'Zahlungsziel', 'Due Date', 'Payment Due', 'Maturity Date'],
  },
  {
    intern: 'deliveryDate',
    label: 'Lieferdatum',
    typen: DATUM,
    namen: ['Lieferdatum', 'Liefertermin', 'Versanddatum', 'Delivery Date', 'Ship Date', 'Shipping Date'],
  },
  {
    intern: 'birthDate',
    label: 'Geburtsdatum',
    typen: DATUM,
    namen: ['Geburtsdatum', 'Geburtstag', 'geb', 'DOB', 'Date of Birth', 'Birth Date', 'Birthday'],
  },
  {
    intern: 'street',
    label: 'Straße',
    typen: TEXT,
    namen: ['Straße', 'Strasse', 'Str', 'Adresse', 'Anschrift', 'Street', 'Address', 'Address Line 1'],
  },
  {
    intern: 'postalCode',
    label: 'Postleitzahl',
    typen: KENNUNG,
    namen: ['PLZ', 'Postleitzahl', 'Postal Code', 'ZIP', 'ZIP Code', 'Postcode'],
    hinweis: 'Bleibt Text: Eine führende Null gehört zur Postleitzahl',
  },
  {
    intern: 'city',
    label: 'Ort',
    typen: TEXT,
    namen: ['Ort', 'Stadt', 'Wohnort', 'City', 'Town', 'Location'],
  },
  {
    intern: 'country',
    label: 'Land',
    typen: TEXT,
    namen: ['Land', 'Staat', 'Country', 'Country Code', 'Nation'],
  },
  {
    intern: 'email',
    label: 'E-Mail-Adresse',
    typen: TEXT,
    namen: ['E-Mail', 'EMail', 'Mail', 'E-Mail-Adresse', 'Email', 'Email Address', 'Mail Address'],
  },
  {
    intern: 'phone',
    label: 'Telefonnummer',
    typen: TEXT,
    namen: ['Telefon', 'Telefonnummer', 'Tel', 'Rufnummer', 'Phone', 'Phone Number', 'Telephone'],
  },
  {
    intern: 'iban',
    label: 'IBAN',
    typen: TEXT,
    namen: ['IBAN', 'Kontonummer', 'Bankverbindung', 'Bank Account'],
  },
  {
    intern: 'vatId',
    label: 'Umsatzsteuer-Identifikationsnummer',
    typen: TEXT,
    namen: ['USt-IdNr', 'UStIdNr', 'Umsatzsteuer-ID', 'Steuernummer', 'VAT ID', 'VAT Number', 'Tax ID'],
  },
];

/**
 * Bringt einen Feldnamen auf eine Form, in der sich vergleichen lässt.
 *
 * `Kunden-Nr.`, `KUNDEN NR`, `kunden_nr` und `Kundennr` sind derselbe Name.
 * Umlaute werden aufgelöst, weil dieselbe Spalte in zwei Exporten einmal
 * `Straße` und einmal `Strasse` heißt — und das ist keine Absicht, sondern das
 * Ergebnis zweier Systeme.
 */
export function normalisiere(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Ein Treffer in der Liste, mit der Herkunft der Kenntnis. */
export interface Namenstreffer {
  bezeichnung: Bezeichnung;
  /** Der Eintrag, der gepasst hat — für die Begründung. */
  ueber: string;
}

/**
 * Alle internen Felder, deren Liste diesen Namen kennt.
 *
 * Es sind mehrere, wenn der Name mehrdeutig ist: `Name` steht bei
 * `customerName`, `Datum` bei `orderDate`. Genau diese Mehrdeutigkeit ist eine
 * Auskunft und darf nicht durch „das erste passt schon" ersetzt werden
 * (SPEC-09, Abschnitt 3: mehrdeutige Zuordnungen dürfen nicht eigenmächtig
 * vorgenommen werden).
 */
export function findeBezeichnungen(name: string, liste: readonly Bezeichnung[] = AUSGELIEFERT): Namenstreffer[] {
  const gesucht = normalisiere(name);

  if (gesucht === '') {
    return [];
  }

  return liste
    .flatMap((bezeichnung) =>
      bezeichnung.namen
        .filter((eintrag) => normalisiere(eintrag) === gesucht)
        .map((eintrag) => ({ bezeichnung, ueber: eintrag }))
    )
    .filter((treffer, stelle, alle) => alle.findIndex((anderer) => anderer.bezeichnung.intern === treffer.bezeichnung.intern) === stelle);
}

/** Ob der erkannte Typ zu dem passt, was dieses interne Feld trägt. */
export function typPasst(bezeichnung: Bezeichnung, typ: FieldType): boolean {
  if (!bezeichnung.typen || bezeichnung.typen.length === 0) {
    return true;
  }

  // Eine leere Spalte sagt nichts über ihren Typ; sie widerspricht deshalb auch
  // nicht. Sie stützt die Zuordnung aber ebenso wenig — das entscheidet der
  // Aufrufer.
  return typ === 'NULL' || bezeichnung.typen.includes(typ);
}
