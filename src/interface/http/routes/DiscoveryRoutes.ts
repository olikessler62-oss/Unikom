import fs from 'node:fs/promises';
import path from 'node:path';

import type { UnikomApplication } from '../../../application/runtime/UnikomApplication.js';
import { discoverEmail, quelleAlsText } from '../../../application/discovery/EmailDiscovery.js';
import { discover } from '../../../domain/discovery/Discovery.js';
import { combine, type Erkennungsmodus, type Strukturvorgabe } from '../../../domain/discovery/Expectation.js';
import type { DataBlock } from '../../../domain/discovery/Discovery.js';
import { extractFilename, toCsv } from '../../../domain/discovery/Extract.js';
import { alsBlock, ausBlock } from '../../../infrastructure/formats/Bestand.js';
import { readJson, writeJson } from '../../../infrastructure/formats/Json.js';
import { readXml, writeXml } from '../../../infrastructure/formats/Xml.js';
import { rankProfiles } from '../../../domain/discovery/Profilabgleich.js';
import { regionAus } from '../../../domain/consolidation/Einstellungen.js';
import { isSafeFilename } from '../../../infrastructure/filesystem/SafePath.js';
import { ApiError, ok, requireObject, requireString, type Route } from '../Http.js';

const MODI: readonly Erkennungsmodus[] = ['AUTOMATIK', 'EINSTELLUNGEN', 'BEIDE'];

/** Genug für eine Bestellung im E-Mail-Text; alles darüber ist eine Datei. */
const MAX_ZEICHEN = 2_000_000;

/**
 * Die Analyse läuft auf dem Server, nicht im Browser.
 *
 * SPEC-01, Abschnitt 2, ist an der Stelle eindeutig: Der Browser ist
 * Oberfläche, die Verarbeitung geschieht außerhalb. Und die Erkennung braucht
 * die Region des Mandanten — ob „1,234" tausendzweihundert oder eins Komma
 * zwei ist, entscheidet sie und nicht der Rechner, an dem jemand sitzt.
 */
export function discoveryRoutes(application: UnikomApplication): Route[] {
  return [
    {
      method: 'POST',
      pattern: '/api/discovery/analyse',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'Die Analyse');
        const inhalt = requireString(input, 'content');

        if (inhalt.length > MAX_ZEICHEN) {
          throw new ApiError(
            400,
            `Der Inhalt ist mit ${inhalt.length} Zeichen zu groß für die Sofortanalyse; ` +
              'bitte als Datei über einen Workflow verarbeiten'
          );
        }

        const tenantId = requireString(input, 'tenantId');
        const tenant = await application.tenantService.getById(tenantId);

        if (!tenant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const modus = modusAus(input.mode);

        /*
         * Gelesen wird aus einem Schnappschuss, nicht aus den Einstellungen.
         *
         * Auch eine Analyse am Bildschirm ist eine Verarbeitung: Wer sie
         * gleich darauf wiederholt, nachdem jemand am Mandanten die Region
         * geändert hat, bekommt ein anderes Ergebnis — und soll erkennen
         * können, woran das lag. Der Schnappschuss beantwortet das (SPEC-01,
         * Abschnitt 10), und er kostet hier eine Zeile.
         */
        const vorlaeufig = await application.profileService.schnappschuss({ tenantId });
        const region = regionAus(vorlaeufig.einstellungen);

        /*
         * Eine E-Mail ist kein eigener Erkennungsweg, sondern eine Hülle: Sie
         * wird aufgemacht, und Rumpf wie Anhänge gehen durch dieselbe Engine
         * (FR_007, Abschnitt 11). Was bleibt, ist die Herkunft je Block.
         */
        const art = artAus(input.kind);
        const email = art === 'EMAIL' ? discoverEmail(inhalt, { region }) : undefined;

        /*
         * JSON und XML bringen ihre Feldnamen mit und wissen, wo die Daten
         * anfangen. Sie durch die Blocksuche zu schicken, die aus einem
         * E-Mail-Text die Tabelle heraussucht, wäre nicht nur unnötig — sie
         * könnte dabei etwas anderes finden als das, was in der Datei steht.
         */
        const erkannt = email
          ? {
              blocks: email.blocks.map((eintrag) => ({ ...eintrag.block, source: quelleAlsText(eintrag.quelle) })),
              ignoredLines: [],
              notes: email.notes,
            }
          : art === 'JSON'
            ? alsBlock(lies(() => readJson(bytes(inhalt)), 'JSON'), { region })
            : art === 'XML'
              ? alsBlock(lies(() => readXml(bytes(inhalt)), 'XML'), { region })
              : discover(inhalt, { region });

        /*
         * Bekannte Strukturen des Mandanten gegen das Erkannte halten.
         *
         * Das ist der Gewinn aus FR_008, Abschnitt 7: Bei der dritten Lieferung
         * desselben Lieferanten erkennt UniCom sie wieder, statt jedes Mal von
         * vorn zu raten. Ausgewählt wird nichts stillschweigend — welche
         * Struktur gepasst hat und wie gut, steht in der Antwort.
         */
        const bekannte = erkannt.blocks[0]
          ? rankProfiles(erkannt.blocks[0], await application.profilRepository.list(tenantId))
          : [];

        const ausdruecklich = input.expectation as Strukturvorgabe | undefined;
        const passend = bekannte.find((treffer) => treffer.score >= 0.75);
        const vorgabe = ausdruecklich ?? (modus === 'AUTOMATIK' ? undefined : passend?.version.vorgabe);
        const ergebnis = combine(erkannt.blocks, vorgabe, vorgabe ? modus : 'AUTOMATIK');

        /*
         * Sobald ein Profil gepasst hat, gilt sein Schnappschuss: Er trägt die
         * Einstellungen dieser Quelle und die Versionsnummer, mit der gelesen
         * wurde. Der vorläufige von oben hat nur den Weg dorthin bezahlt.
         */
        const schnappschuss =
          passend && vorgabe && !ausdruecklich
            ? await application.profileService.schnappschuss({
                tenantId,
                profilId: passend.profil.id,
                version: passend.version.version,
              })
            : vorlaeufig;

        return ok({
          region,
          message: email
            ? { from: email.message.from, subject: email.message.subject, date: email.message.date,
                attachments: email.message.attachments.map((anhang) => anhang.filename) }
            : undefined,
          knownStructures: bekannte.map((treffer) => ({
            id: treffer.profil.id,
            name: treffer.profil.name,
            version: treffer.version.version,
            score: treffer.score,
            abweichungen: treffer.abweichungen,
          })),
          usedStructure: ausdruecklich || modus === 'AUTOMATIK' ? undefined : passend?.profil.name,
          /*
           * Womit gelesen wurde — Profil, Version und die geltenden
           * Einstellungen samt Ebene, aus der jede stammt.
           */
          snapshot: {
            id: schnappschuss.id,
            profileId: schnappschuss.profilId,
            profileName: schnappschuss.profilName,
            profileVersion: schnappschuss.profilVersion,
            einstellungen: schnappschuss.einstellungen,
            herkunft: schnappschuss.herkunft,
          },
          blocks: erkannt.blocks,
          ignoredLines: erkannt.ignoredLines,
          notes: [...erkannt.notes, ...ergebnis.notes],
          chosen: ergebnis.block
            ? {
                start: ergebnis.block.start,
                end: ergebnis.block.end,
                columns: ergebnis.columns,
                configurationMatch: ergebnis.configurationMatch,
                patternMatch: ergebnis.patternMatch,
                overallConfidence: ergebnis.overallConfidence,
                abweichungen: ergebnis.abweichungen,
              }
            : undefined,
        });
      },
    },
    {
      /*
       * Eine Beispieldatei ansehen — der Anfang davon, als Text.
       *
       * ## Warum der Server sie liest und nicht der Browser
       *
       * Dieselbe Antwort wie beim Verzeichnisbrowser, und sie gilt hier noch
       * stärker: Eine Datei, die der Browser öffnet, liegt auf dem Rechner, an
       * dem jemand sitzt. Die Lieferung liegt aber dort, wo Unikom läuft — und
       * genau die soll erkannt werden, nicht eine Abschrift davon, die jemand
       * vorher auf seinen Arbeitsplatz kopiert hat.
       *
       * ## Warum das Ergebnis in die Textfläche geht
       *
       * Es könnte auch gleich analysiert werden. Dann bekäme man ein Ergebnis
       * über etwas, das man nie gesehen hat — und das Versprechen dieses
       * Bildschirms ist das Gegenteil: „Gespeichert wird, was Sie hier
       * bestätigen." Der gelesene Anfang steht deshalb sichtbar da, und die
       * Erkennung läuft darüber wie über eingefügten Text.
       *
       * ## Warum kein eigener Größenwall
       *
       * Der Dienst liest höchstens `PROBE_BYTES`. Was hier ankommt, ist damit
       * immer kleiner als die Grenze der Analyse — eine zweite Zahl daneben
       * wäre eine, die eines Tages der ersten widerspricht.
       */
      method: 'POST',
      pattern: '/api/discovery/read-file',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body }) => {
        const input = requireObject(body, 'Die Datei');
        const tenantId = requireString(input, 'tenantId');

        if (!(await application.tenantService.getById(tenantId))) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        const ergebnis = await application.localDirectories.leseProbe({
          tenantId,
          datei: requireString(input, 'path'),
        });

        /*
         * Ein Misserfolg kommt als Antwort und nicht als Fehler.
         *
         * „Das ist ein PDF" ist keine Störung, sondern das Ergebnis des
         * Hinsehens — genauso wie beim Blättern, wo ein Verzeichnis ohne
         * Leserecht `ok: false` mit einem Satz zurückgibt. Die Oberfläche zeigt
         * beides an derselben Stelle; ein 400er zwänge sie, denselben Satz noch
         * einmal aus einem anderen Kanal zu holen.
         */
        return ok(ergebnis);
      },
    },
    {
      /*
       * Aus dem erkannten Block eine Datei machen.
       *
       * Damit endet der Weg nicht bei der Ansicht: Was hier entsteht, ist ein
       * gewöhnlicher Datenbestand, den die Übertragung und die Konsolidierung
       * verarbeiten können wie jeden anderen.
       */
      method: 'POST',
      pattern: '/api/discovery/extract',
      authorization: 'MANAGE_JOBS',
      handle: async ({ body, session }) => {
        const input = requireObject(body, 'Die Übernahme');
        const tenantId = requireString(input, 'tenantId');
        const tenant = await application.tenantService.getById(tenantId);

        if (!tenant) {
          throw new ApiError(404, `Den Mandanten „${tenantId}“ gibt es nicht`);
        }

        if (!tenant.rootDirectory) {
          throw new ApiError(
            400,
            `Für den Mandanten „${tenant.name}“ ist kein Wurzelverzeichnis eingestellt; ` +
              'ohne das weiß Unikom nicht, wohin die Datei gehört'
          );
        }

        const block = input.block as DataBlock | undefined;

        if (!block || !Array.isArray(block.rows) || block.rows.length === 0) {
          throw new ApiError(400, 'Es wurde kein Datenblock übergeben, aus dem eine Datei entstehen könnte');
        }

        const basis = requireString(input, 'name');
        const format = formatAus(input.format);

        if (!isSafeFilename(`${basis}.${ENDUNGEN[format]}`)) {
          throw new ApiError(400, `„${basis}“ taugt nicht als Dateiname; Pfadangaben gehören nicht hinein`);
        }

        /*
         * Geschrieben wird ausschließlich in „eingang" unter dem
         * Wurzelverzeichnis des Mandanten. Kein Pfad aus der Anfrage: Ein
         * Verzeichnis, das der Aufrufer bestimmt, ist ein Weg aus dem Bereich
         * des Mandanten heraus, und dieser Weg soll gar nicht erst bestehen.
         */
        const verzeichnis = path.join(tenant.rootDirectory, 'eingang');
        const datei = path.join(verzeichnis, extractFilename(basis, new Date(), ENDUNGEN[format]));

        /*
         * Der Weg zurück (SPEC-03, Abschnitt 7 und 8): Was hier entsteht, kann
         * eine CSV sein oder ein verschachteltes JSON oder XML. Die Werte gehen
         * dabei als Text hinaus — sie in JSON-Zahlen zu verwandeln hieße, sie
         * nach der Region umzurechnen, und das ist eine Frage des Mappings.
         */
        const bestand = ausBlock(block);
        const geschrieben =
          format === 'JSON'
            ? writeJson(bestand, { wurzel: basis })
            : format === 'XML'
              ? writeXml(bestand, { wurzel: basis, datensatz: 'zeile' })
              : { text: toCsv(block), notes: [] as string[] };

        await fs.mkdir(verzeichnis, { recursive: true });
        await fs.writeFile(datei, geschrieben.text, 'utf-8');

        application.logger.log({
          timestamp: new Date(),
          level: 'INFO',
          userId: session?.user.id,
          username: session?.user.username,
          message:
            `Datenblock übernommen: ${block.rows.length} Datensätze, ${block.columns.length} Spalten ` +
            `nach ${datei}`,
        });

        return ok({
          file: datei,
          format,
          rows: block.rows.length,
          columns: block.columns.length,
          notes: geschrieben.notes,
        });
      },
    },
  ];
}

/** In welche Formate ein erkannter Block ausgeleitet werden kann. */
const FORMATE = ['CSV', 'JSON', 'XML'] as const;
type Zielformat = (typeof FORMATE)[number];

const ENDUNGEN: Record<Zielformat, string> = { CSV: 'csv', JSON: 'json', XML: 'xml' };

function formatAus(wert: unknown): Zielformat {
  if (wert === undefined) {
    return 'CSV';
  }

  if (typeof wert !== 'string' || !(FORMATE as readonly string[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}" ist kein Zielformat. Erwartet wird eines von: ${FORMATE.join(', ')}`);
  }

  return wert as Zielformat;
}

/** Die Arten von Inhalt, die dieser Weg annimmt. */
const ARTEN = ['TEXT', 'EMAIL', 'JSON', 'XML'] as const;
type Art = (typeof ARTEN)[number];

function artAus(wert: unknown): Art {
  if (wert === undefined) {
    return 'TEXT';
  }

  if (typeof wert !== 'string' || !(ARTEN as readonly string[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}" ist keine Art von Inhalt. Erwartet wird eine von: ${ARTEN.join(', ')}`);
  }

  return wert as Art;
}

function bytes(inhalt: string): Uint8Array {
  return new Uint8Array(Buffer.from(inhalt, 'utf-8'));
}

/**
 * Ein Leser, der scheitert, sagt warum — mit 400 und nicht mit 500.
 *
 * Eine kaputte Datei ist kein Fehler der Anwendung, sondern eine Auskunft über
 * die Datei. Sie als Serverfehler auszugeben hieße, dem Benutzer die Ursache zu
 * verschweigen und ihn im Protokoll suchen zu lassen.
 */
function lies<T>(leser: () => T, format: string): T {
  try {
    return leser();
  } catch (fehler) {
    throw new ApiError(400, `${format} konnte nicht gelesen werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  }
}

function modusAus(wert: unknown): Erkennungsmodus {
  if (wert === undefined) {
    return 'AUTOMATIK';
  }

  if (typeof wert !== 'string' || !(MODI as readonly string[]).includes(wert)) {
    throw new ApiError(400, `„${String(wert)}“ ist kein Erkennungsmodus. Erwartet wird einer von: ${MODI.join(', ')}`);
  }

  return wert as Erkennungsmodus;
}
