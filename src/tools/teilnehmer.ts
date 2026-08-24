/**
 * Schreibt fünf Teilnehmerlisten als echte Dateien aus.
 *
 *   npm run teilnehmer
 *   npm run teilnehmer -- --ziel D:\Proben
 *
 * ## Wozu
 *
 * Zum Ausprobieren des Zusammenführens von Hand: fünf Lieferungen desselben
 * Stapels, wie sie aus fünf Häusern kämen. Alle Personen sind erfunden.
 *
 * ## Warum als Erzeuger und nicht als abgelegte Dateien
 *
 * Wie beim Fallkatalog (`src/tools/testdaten.ts`): Eine Quelle, zwei
 * Verwendungen. Wer eine Spalte ändern will, ändert sie hier — und bekommt
 * fünf Dateien, die zueinander passen, statt fünf Dateien, die einmal
 * zueinander gepasst haben.
 *
 * ## Was absichtlich auseinanderläuft
 *
 * Die fünf Listen sind sich nur im Inhalt einig, in nichts sonst:
 *
 * ```text
 * Spaltenfolge      jede Liste eine andere
 * Spaltennamen      deutsch, englisch, französisch, spanisch
 * Trennzeichen      Komma, Semikolon, Tabulator
 * Umlaute           einmal „ü", einmal „ue" — dieselbe Person schriebe sich
 *                   in zwei Häusern verschieden
 * Datum             TT.MM.JJJJ, JJJJ-MM-TT, MM/TT/JJJJ, TT/MM/JJJJ, TT-MM-JJJJ
 * Nationalität      Wort, Kürzel, Landesname — drei Arten, dasselbe zu sagen
 * Anrede            Herr/Frau, Mr/Ms, M./Mme, Sr./Sra.
 * ```
 *
 * Der `03/12/1985` der Londoner Liste und der `12/03/1985` der Pariser sind
 * derselbe Tag oder zwei verschiedene — je nachdem, wen man fragt. Das ist
 * kein Versehen, sondern der Fall, an dem sich zeigt, ob eine Zuordnung nach
 * der Herkunft der Datei rechnet oder nach dem Zufall.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Eine erfundene Person, wie sie in einer Liste steht. */
interface Person {
  vorname: string;
  nachname: string;
  /** Leer, wo keiner geführt wird — das ist der Regelfall. */
  titel: string;
  /** Nur für die Anrede; sie steht in jeder Liste anders da. */
  weiblich: boolean;
}

/** Eine Liste, wie ein Haus sie abliefert. */
interface Liste {
  datei: string;
  trenner: string;
  /** Die Spaltenüberschriften — ihre Reihenfolge ist die der Datei. */
  kopf: string[];
  /** Wie diese Liste ein Datum schreibt. */
  datum(tag: number, monat: number, jahr: number): string;
  /** Herr/Frau in der Sprache des Hauses. */
  anrede(weiblich: boolean): string;
  /** Die Staatsangehörigkeiten, aus denen diese Liste schöpft. */
  nationen: string[];
  kurse: string[];
  personen: Person[];
  /** Die Zeile, in der Reihenfolge des Kopfes. */
  zeile(person: Person, felder: Felder): string[];
}

/** Die fertigen Werte einer Person — die Liste ordnet sie nur noch an. */
interface Felder {
  anrede: string;
  titel: string;
  vorname: string;
  nachname: string;
  nation: string;
  geburtstag: string;
  kurs: string;
}

function p(vorname: string, nachname: string, titel: string, weiblich: boolean): Person {
  return { vorname, nachname, titel, weiblich };
}

/* ---------- Berlin: deutsch, Komma, Umlaute als Umlaute ---------- */

const BERLIN: Person[] = [
  p('Anna', 'Bergmüller', 'Dr.', true),
  p('Tobias', 'Kröger', '', false),
  p('Marlene', 'Hofstätter', 'Prof. Dr.', true),
  p('Jonas', 'Wiedemann', 'Dipl.-Ing.', false),
  p('Katharina', 'Löwenstein', '', true),
  p('Sebastian', 'Grünberg', 'Dr.-Ing.', false),
  p('Elisabeth', 'Vogelsang', '', true),
  p('Maximilian', 'Schäfer', 'M.Sc.', false),
  p('Johanna', 'Bräutigam', '', true),
  p('Frederik', 'Osterloh', 'Dr.', false),
  p('Charlotte', 'Rühmann', '', true),
  p('Benedikt', 'Stahlberg', 'Dipl.-Ing.', false),
  p('Franziska', 'Möllenkamp', '', true),
  p('Alexander', 'Reinhardt', '', false),
  p('Theresa', 'Günzel', 'Dr.', true),
  p('Konstantin', 'Falkenberg', 'Prof.', false),
  p('Miriam', 'Achterberg', '', true),
  p('Lennart', 'Süßkind', '', false),
  p('Viktoria', 'Nordhoff', 'M.Sc.', true),
  p('Matthias', 'Ehrenfeld', '', false),
  p('Susanne', 'Kaltenbrunn', 'Dipl. Ing.', true),
  p('Christoph', 'Weidenbach', '', false),
  p('Annelie', 'Sturmhöfel', '', true),
  p('Gregor', 'Lindenthal', 'Dr.', false),
  p('Barbara', 'Wüstenberg', '', true),
  p('Nikolas', 'Immerthal', '', false),
  p('Rosalie', 'Fährmann', '', true),
  p('Valentin', 'Ockenfels', 'Prof. Dr.', false),
  p('Henriette', 'Bollmann', '', true),
  p('Dominik', 'Straßburger', '', false),
];

/* ---------- München: deutsch, Semikolon, Umlaute als ue/oe/ae ---------- */

const MUENCHEN: Person[] = [
  p('Juergen', 'Kaltenbach', 'Dr.', false),
  p('Steffi', 'Buergermeister', '', true),
  p('Ruediger', 'Hoellriegel', 'Dipl. Ing.', false),
  p('Baerbel', 'Schwaiger', '', true),
  p('Guenther', 'Ostermaier', 'Prof.', false),
  p('Kaethe', 'Muehlbauer', '', true),
  p('Hansjoerg', 'Steinlechner', '', false),
  p('Ute', 'Roeckenwagner', 'Dr.', true),
  p('Bernd', 'Puehringer', '', false),
  p('Marlies', 'Aschenbrenner', '', true),
  p('Wolfgang', 'Duerrmeier', 'Dipl.-Ing.', false),
  p('Roswitha', 'Grasleitner', '', true),
  p('Klaus-Peter', 'Foerstner', '', false),
  p('Hannelore', 'Weissbacher', 'Dr.', true),
  p('Siegfried', 'Neuhaeusler', '', false),
  p('Gudrun', 'Hoehenberger', '', true),
  p('Manfred', 'Riedhammer', 'Prof. Dr.', false),
  p('Traudl', 'Obermueller', '', true),
  p('Egon', 'Landsberger', '', false),
  p('Sieglinde', 'Waldhaeusl', 'M.Sc.', true),
  p('Ferdinand', 'Kroetzinger', '', false),
  p('Irmgard', 'Zwiesler', '', true),
  p('Anton', 'Bruecklmeier', 'Dr.', false),
  p('Waltraud', 'Sonnleithner', '', true),
  p('Reinhold', 'Gschwendtner', '', false),
  p('Hildegard', 'Poeschl', '', true),
  p('Alois', 'Wiesheu', 'Dipl. Ing.', false),
  p('Christl', 'Fuerholzer', '', true),
  p('Sepp', 'Haidhauser', '', false),
  p('Rosmarie', 'Untermoser', '', true),
];

/* ---------- London: englisch, Komma ---------- */

const LONDON: Person[] = [
  p('Eleanor', 'Whitfield', 'Dr.', true),
  p('Oliver', 'Hargreaves', '', false),
  p('Imogen', 'Blackwood', 'Prof.', true),
  p('Harrison', 'Pemberton', '', false),
  p('Beatrice', 'Fairweather', '', true),
  p('Callum', 'Ashworth', 'Dr.', false),
  p('Rosalind', 'Thornbury', '', true),
  p('Nathaniel', 'Ravensworth', 'Prof. Dr.', false),
  p('Georgina', 'Loughlin', '', true),
  p('Sebastian', 'Meriwether', 'M.Sc.', false),
  p('Philippa', 'Cavendish', '', true),
  p('Douglas', 'Kinnaird', '', false),
  p('Clementine', 'Ashby', 'Dr.', true),
  p('Rupert', 'Featherstone', '', false),
  p('Arabella', 'Sinclair', '', true),
  p('Gideon', 'Wolstenholme', '', false),
  p('Marguerite', 'Ainsworth', 'B.A.', true),
  p('Tobias', 'Grantham', '', false),
  p('Vivienne', 'Stanhope', 'Dr.', true),
  p('Everett', 'Bramwell', '', false),
  p('Cordelia', 'Ledbetter', '', true),
  p('Alistair', 'Hollingworth', 'Prof.', false),
  p('Josephine', 'Rathbone', '', true),
  p('Barnaby', 'Culpepper', '', false),
  p('Wilhelmina', 'Fitzgerald', '', true),
  p('Percival', 'Ashcombe', 'Dr.', false),
  p('Henrietta', 'Waverley', '', true),
  p('Montgomery', 'Blythe', '', false),
  p('Ottoline', 'Marchbanks', 'M.Sc.', true),
  p('Crispin', 'Thackeray', '', false),
];

/* ---------- Paris: französisch, Semikolon ---------- */

const PARIS: Person[] = [
  p('Amélie', 'Rousseau', 'Dr.', true),
  p('Étienne', 'Lefèvre', '', false),
  p('Solène', 'Duchêne', 'Prof.', true),
  p('Bastien', 'Marchand', 'Ing.', false),
  p('Ophélie', 'Beauchamp', '', true),
  p('Thibault', 'Vaugeois', 'Dr.', false),
  p('Clémence', 'Fontenay', '', true),
  p('Aurélien', 'Bouchard', '', false),
  p('Léontine', 'Charpentier', '', true),
  p('Maximilien', 'Delacroix', 'Prof. Dr.', false),
  p('Marguerite', 'Anceaume', '', true),
  p('Frédéric', 'Loiseau', 'Ing.', false),
  p('Bérénice', 'Vaillancourt', '', true),
  p('Gaspard', 'Lemoine', '', false),
  p('Sidonie', 'Thibodeau', 'Dr.', true),
  p('Anatole', 'Perrichon', '', false),
  p('Éléonore', 'Grandjean', '', true),
  p('Ludovic', 'Beaumanoir', '', false),
  p('Perrine', 'Chastenet', '', true),
  p('Sylvestre', 'Aubertin', 'Prof.', false),
  p('Roseline', 'Ferrandière', '', true),
  p('Grégoire', 'Maupassant', '', false),
  p('Coralie', 'Vandenbroucke', 'Dr.', true),
  p('Baptiste', 'Roquefort', '', false),
  p('Apolline', 'Chevalier', '', true),
  p('Cyprien', 'Beauregard', '', false),
  p('Mathilde', 'Séverin', '', true),
  p('Célestin', 'Wallemand', 'Ing.', false),
  p('Adélaïde', 'Fournier', '', true),
  p('Hippolyte', 'Carbonnier', '', false),
];

/* ---------- Madrid: spanisch, Tabulator ---------- */

const MADRID: Person[] = [
  p('Inmaculada', 'Peñaranda', 'Dr.', true),
  p('Íñigo', 'Balmaseda', '', false),
  p('Soledad', 'Guzmán', 'Prof.', true),
  p('Nicolás', 'Ibarrondo', 'Ing.', false),
  p('Milagros', 'Cañizares', '', true),
  p('Baltasar', 'Fuenmayor', 'Dr.', false),
  p('Purificación', 'Zubizarreta', '', true),
  p('Jerónimo', 'Villalobos', '', false),
  p('Encarnación', 'Mendizábal', '', true),
  p('Sebastián', 'Otxandiano', 'Prof. Dr.', false),
  p('Rosario', 'Berrocal', '', true),
  p('Anselmo', 'Quintanilla', '', false),
  p('Consuelo', 'Aranguren', 'Dr.', true),
  p('Fructuoso', 'Salcedo', '', false),
  p('Amparo', 'Bermúdez', '', true),
  p('Casimiro', 'Elizondo', '', false),
  p('Begoña', 'Larrañaga', 'M.Sc.', true),
  p('Práxedes', 'Montoro', '', false),
  p('Covadonga', 'Arrieta', '', true),
  p('Evaristo', 'Palomares', 'Dr.', false),
  p('Nieves', 'Escudero', '', true),
  p('Bonifacio', 'Aizpurúa', '', false),
  p('Remedios', 'Valdivieso', '', true),
  p('Genaro', 'Uriarte', 'Ing.', false),
  p('Loreto', 'Barrenechea', '', true),
  p('Teodoro', 'Cifuentes', '', false),
  p('Piedad', 'Goikoetxea', 'Prof.', true),
  p('Aurelio', 'Manzanares', '', false),
  p('Nuria', 'Etxeberría', '', true),
  p('Bernabé', 'Sotomayor', '', false),
];

/* ---------- Die fünf Lieferungen ---------- */

const LISTEN: Liste[] = [
  {
    datei: 'Teilnehmer_Berlin_2026-03-02.csv',
    trenner: ',',
    kopf: ['Anrede', 'Titel', 'Vorname', 'Nachname', 'Nationalität', 'Geburtstag', 'Kurs'],
    datum: (t, m, j) => `${zwei(t)}.${zwei(m)}.${j}`,
    anrede: (w) => (w ? 'Frau' : 'Herr'),
    nationen: ['deutsch', 'deutsch', 'deutsch', 'österreichisch', 'polnisch', 'deutsch', 'türkisch'],
    kurse: ['Datenschutz Grundlagen', 'Arbeitssicherheit', 'Erste Hilfe', 'Brandschutzhelfer'],
    personen: BERLIN,
    zeile: (_person, f) => [f.anrede, f.titel, f.vorname, f.nachname, f.nation, f.geburtstag, f.kurs],
  },
  {
    datei: 'Teilnehmer_Muenchen_2026-03-02.csv',
    trenner: ';',
    kopf: [
      'Nachname',
      'Vorname',
      'Titel',
      'Anrede',
      'Staatsangehoerigkeit',
      'Geburtsdatum',
      'Kursbezeichnung',
    ],
    // JJJJ-MM-TT: das Haus exportiert aus einer Datenbank, nicht aus Excel.
    datum: (t, m, j) => `${j}-${zwei(m)}-${zwei(t)}`,
    anrede: (w) => (w ? 'Frau' : 'Herr'),
    nationen: ['DE', 'DE', 'AT', 'DE', 'CH', 'DE', 'IT'],
    kurse: ['Datenschutz Grundlagen', 'Arbeitssicherheit', 'Ladungssicherung', 'Erste Hilfe'],
    personen: MUENCHEN,
    zeile: (_person, f) => [f.nachname, f.vorname, f.titel, f.anrede, f.nation, f.geburtstag, f.kurs],
  },
  {
    datei: 'Participants_London_2026-03-02.csv',
    trenner: ',',
    kopf: ['First name', 'Last name', 'Title', 'Salutation', 'Nationality', 'Date of birth', 'Course'],
    // MM/TT/JJJJ — und die Pariser Liste schreibt TT/MM/JJJJ. Siehe oben.
    datum: (t, m, j) => `${zwei(m)}/${zwei(t)}/${j}`,
    anrede: (w) => (w ? 'Ms' : 'Mr'),
    nationen: ['British', 'British', 'Irish', 'British', 'Canadian', 'British', 'Australian'],
    kurse: ['Data Protection Basics', 'Health and Safety', 'First Aid', 'Fire Warden'],
    personen: LONDON,
    zeile: (_person, f) => [f.vorname, f.nachname, f.titel, f.anrede, f.nation, f.geburtstag, f.kurs],
  },
  {
    datei: 'Participants_Paris_2026-03-02.csv',
    trenner: ';',
    kopf: ['Civilité', 'Titre', 'Nom', 'Prénom', 'Nationalité', 'Date de naissance', 'Formation'],
    datum: (t, m, j) => `${zwei(t)}/${zwei(m)}/${j}`,
    anrede: (w) => (w ? 'Mme' : 'M.'),
    nationen: ['française', 'française', 'belge', 'française', 'suisse', 'française', 'canadienne'],
    kurse: [
      'Protection des données',
      'Sécurité au travail',
      'Premiers secours',
      'Équipier de première intervention',
    ],
    personen: PARIS,
    // Nom vor Prénom — die einzige Liste, die den Nachnamen an dritter Stelle führt.
    zeile: (_person, f) => [f.anrede, f.titel, f.nachname, f.vorname, f.nation, f.geburtstag, f.kurs],
  },
  {
    datei: 'Participantes_Madrid_2026-03-02.tsv',
    trenner: '\t',
    kopf: [
      'Apellidos',
      'Nombre',
      'Tratamiento',
      'Título',
      'Nacionalidad',
      'Fecha de nacimiento',
      'Curso',
    ],
    datum: (t, m, j) => `${zwei(t)}-${zwei(m)}-${j}`,
    anrede: (w) => (w ? 'Sra.' : 'Sr.'),
    // Landesnamen statt Staatsangehörigkeiten — die dritte Art, dasselbe zu sagen.
    nationen: ['España', 'España', 'Portugal', 'España', 'México', 'España', 'Argentina'],
    kurse: [
      'Protección de datos',
      'Seguridad laboral',
      'Primeros auxilios',
      'Prevención de incendios',
    ],
    personen: MADRID,
    // Tratamiento vor Título — umgekehrt zu allen anderen.
    zeile: (_person, f) => [f.nachname, f.vorname, f.anrede, f.titel, f.nation, f.geburtstag, f.kurs],
  },
];

function zwei(zahl: number): string {
  return String(zahl).padStart(2, '0');
}

/**
 * Ein Geburtstag aus der Stelle in der Liste.
 *
 * Gerechnet und nicht gewürfelt: Der Erzeuger soll bei jedem Lauf dieselben
 * Dateien schreiben. Sonst hätte man nach dem zweiten Aufruf zwei Stände und
 * wüsste bei einem Unterschied im Ergebnis nicht, woher er kommt.
 */
function geburtstag(stelle: number): { tag: number; monat: number; jahr: number } {
  return {
    tag: 1 + ((stelle * 7 + 3) % 28),
    monat: 1 + ((stelle * 5 + 1) % 12),
    jahr: 1962 + ((stelle * 13) % 41),
  };
}

/**
 * Ein Feld für die Datei.
 *
 * Eingefasst wird nur, was es braucht: ein Feld mit dem Trennzeichen, mit einem
 * Anführungszeichen oder mit einem Zeilenumbruch. Alles einzufassen wäre auch
 * richtig, sähe aber nicht nach dem aus, was Fremdsysteme abliefern — und
 * genau das sollen diese Dateien nachstellen.
 */
function feld(wert: string, trenner: string): string {
  if (!wert.includes(trenner) && !wert.includes('"') && !wert.includes('\n')) {
    return wert;
  }

  return `"${wert.split('"').join('""')}"`;
}

function alsText(liste: Liste): string {
  const zeilen = [liste.kopf.map((spalte) => feld(spalte, liste.trenner)).join(liste.trenner)];

  liste.personen.forEach((person, stelle) => {
    const { tag, monat, jahr } = geburtstag(stelle);

    const felder: Felder = {
      anrede: liste.anrede(person.weiblich),
      titel: person.titel,
      vorname: person.vorname,
      nachname: person.nachname,
      nation: liste.nationen[stelle % liste.nationen.length],
      geburtstag: liste.datum(tag, monat, jahr),
      kurs: liste.kurse[stelle % liste.kurse.length],
    };

    zeilen.push(
      liste
        .zeile(person, felder)
        .map((wert) => feld(wert, liste.trenner))
        .join(liste.trenner)
    );
  });

  // Mit Abschlusszeile: Eine Datei ohne sie ist zulässig, aber unüblich.
  return zeilen.join('\r\n') + '\r\n';
}

function beschreibung(): string {
  const zeilen = [
    '# Teilnehmerlisten zum Ausprobieren',
    '',
    'Fünf Lieferungen desselben Stapels, wie sie aus fünf Häusern kämen —',
    'je 30 Teilnehmer. **Alle Personen sind erfunden.**',
    '',
    'Erzeugt mit `npm run teilnehmer`. Geändert wird nicht hier, sondern in',
    '`src/tools/teilnehmer.ts`; dieser Ordner ist das Ergebnis.',
    '',
    '## Was die Listen unterscheidet',
    '',
    '| Datei | Trenner | Spalten 1–4 | Datum | Nationalität |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const liste of LISTEN) {
    const { tag, monat, jahr } = geburtstag(0);

    zeilen.push(
      `| \`${liste.datei}\` | ${trennername(liste.trenner)} | ${liste.kopf.slice(0, 4).join(', ')} ` +
        `| \`${liste.datum(tag, monat, jahr)}\` | ${liste.nationen[0]} |`
    );
  }

  zeilen.push(
    '',
    '## Die Fallen, die absichtlich darin stecken',
    '',
    '* **`ü` gegen `ue`.** Berlin schreibt `Bergmüller`, München `Buergermeister`.',
    '  Dieselbe Person schriebe sich in zwei Häusern verschieden.',
    '* **`03/12/1985` gegen `12/03/1985`.** London schreibt Monat zuerst, Paris den',
    '  Tag. Ohne die Herkunft der Datei ist nicht zu entscheiden, welcher Tag',
    '  gemeint ist — und beide Schreibweisen sind für sich genommen gültig.',
    '* **Drei Arten, die Herkunft zu sagen.** `deutsch`, `DE`, `España`: Wort,',
    '  Kürzel, Landesname.',
    '* **Nachname an wechselnder Stelle.** Berlin führt ihn als vierte Spalte,',
    '  München als erste, Paris als dritte.',
    '* **Titel und Anrede vertauscht.** Madrid führt `Tratamiento` vor `Título`,',
    '  alle anderen die Anrede nach dem Titel oder davor.',
    '',
    '## Als Stapel',
    '',
    'Alle fünf Namen enden auf dasselbe Datum. Für die Fläche „Mehrere Dateien',
    'zusammenführen" lassen sich daraus fünf Plätze bauen:',
    '',
    '```text',
    'Berlin     Teilnehmer_Berlin_{stapel}.csv',
    'München    Teilnehmer_Muenchen_{stapel}.csv',
    'London     Participants_London_{stapel}.csv',
    'Paris      Participants_Paris_{stapel}.csv',
    'Madrid     Participantes_Madrid_{stapel}.tsv',
    '```',
    '',
    'Dateien insgesamt: 5. Wer nur vier davon in das Abholverzeichnis legt, sieht,',
    'was der Lauf meldet, wenn eine Lieferung fehlt.',
    ''
  );

  return zeilen.join('\r\n');
}

function trennername(trenner: string): string {
  return trenner === ',' ? 'Komma' : trenner === ';' ? 'Semikolon' : 'Tabulator';
}

function main(argv: string[]): void {
  const stelle = argv.indexOf('--ziel');
  const ziel = path.resolve(stelle >= 0 ? argv[stelle + 1] : 'Testdateien');

  fs.mkdirSync(ziel, { recursive: true });

  for (const liste of LISTEN) {
    fs.writeFileSync(path.join(ziel, liste.datei), alsText(liste), 'utf-8');
  }

  fs.writeFileSync(path.join(ziel, 'LIESMICH.md'), beschreibung(), 'utf-8');

  console.log(`${LISTEN.length} Teilnehmerlisten geschrieben nach ${ziel}`);
  console.log(`Je ${LISTEN[0].personen.length} Personen, alle erfunden.`);
}

main(process.argv.slice(2));
