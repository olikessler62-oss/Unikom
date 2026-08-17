/**
 * The vendor's side of licensing: generate the key pair once, then issue a
 * licence per customer and paid period.
 *
 *   npm run licence -- keys
 *   npm run licence -- issue --customer "Muster GmbH" --until 2027-03-31 \
 *                            --features REMOTE_SOURCES,ENCRYPTION
 *   npm run licence -- show unikom.licence
 *
 * The private key is read from UNIKOM_LICENCE_PRIVATE_KEY or from --key-file.
 * Never from an argument: arguments end up in the shell history and, on a
 * shared machine, in the process list.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { FEATURES, isFeature, type Feature } from '../domain/licensing/Feature.js';
import { DEFAULT_WARNING_DAYS, evaluateLicence, type Licence } from '../domain/licensing/Licence.js';
import { licencePublicKey } from '../infrastructure/licensing/LicencePublicKey.js';
import { generateLicenceKeyPair, signLicence, verifyLicenceDocument } from '../infrastructure/licensing/LicenceSigning.js';

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);

  switch (command) {
    case 'keys':
      return printKeys();
    case 'issue':
      return issue(options);
    case 'show':
      return show(rest[0], options);
    default:
      return printUsage();
  }
}

function printKeys(): void {
  const pair = generateLicenceKeyPair();

  console.log('\nÖffentlicher Schlüssel — gehört in BUILT_IN_LICENCE_PUBLIC_KEY');
  console.log('(src/infrastructure/licensing/LicencePublicKey.ts) des Auslieferungs-Builds:\n');
  console.log(`  ${pair.publicKey}\n`);
  console.log('Privater Schlüssel — bleibt beim Hersteller, nie in eine Kundeninstallation:\n');
  console.log(`  ${pair.privateKey}\n`);
  console.log('Ohne ihn lässt sich keine Lizenz mehr ausstellen, und mit ihm jede.');
  console.log('Ein Wechsel des Schlüssels macht alle bereits ausgestellten Lizenzen ungültig.\n');
}

function issue(options: Map<string, string>): void {
  const customer = required(options, 'customer');
  const until = endOfDay(required(options, 'until'));
  const privateKey = readPrivateKey(options);
  const features = parseFeatures(options.get('features'));
  const warningDays = options.has('warn') ? Number.parseInt(options.get('warn')!, 10) : DEFAULT_WARNING_DAYS;

  const licence: Licence = {
    id: options.get('id') ?? `LIC-${randomUUID()}`,
    customer,
    issuedAt: new Date(),
    validUntil: until,
    features,
    warningDays: Number.isFinite(warningDays) && warningDays >= 0 ? warningDays : DEFAULT_WARNING_DAYS,
  };

  const document = signLicence(licence, privateKey);
  const target = options.get('out');

  describe(licence);

  if (target) {
    fs.writeFileSync(target, `${document}\n`, 'utf8');
    console.log(`Geschrieben nach ${target}\n`);
  } else {
    console.log(`${document}\n`);
  }
}

function show(source: string | undefined, options: Map<string, string>): void {
  if (!source) {
    console.error('Bitte eine Lizenzdatei oder den Lizenztext angeben.');
    process.exitCode = 1;
    return;
  }

  const text = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : source;
  const publicKey = options.get('public-key') ?? licencePublicKey();

  if (!publicKey) {
    console.error(
      'Kein öffentlicher Schlüssel: weder eingebaut noch über --public-key oder UNIKOM_LICENCE_PUBLIC_KEY.'
    );
    process.exitCode = 1;
    return;
  }

  try {
    const licence = verifyLicenceDocument(text, publicKey);
    describe(licence);

    const status = evaluateLicence(licence, new Date());
    console.log(`Zustand:   ${status.state}${status.problem ? ` — ${status.problem}` : ''}`);
    console.log(`Läuft:     ${status.mayRun ? 'ja' : 'nein'}\n`);
  } catch (error) {
    console.error(`Ungültig: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function describe(licence: Licence): void {
  console.log('');
  console.log(`Lizenz:    ${licence.id}`);
  console.log(`Kunde:     ${licence.customer}`);
  console.log(`Bezahlt bis: ${licence.validUntil.toISOString()}`);
  console.log(`Warnung ab:  ${licence.warningDays} Tage vorher`);
  console.log(`Module:    ${licence.features.length > 0 ? licence.features.join(', ') : 'nur Grundprodukt'}`);
  console.log('');
}

/**
 * A day given as a date means the whole day. Taken as UTC, so the same licence
 * text means the same thing on every machine; the hour or two of grace that
 * gives a customer in Central Europe is not worth a timezone argument.
 */
function endOfDay(day: string): Date {
  const date = new Date(`${day}T23:59:59.999Z`);

  if (Number.isNaN(date.getTime())) {
    console.error(`Kein gültiges Datum: ${day} (erwartet JJJJ-MM-TT)`);
    process.exit(1);
  }

  return date;
}

function parseFeatures(value: string | undefined): Feature[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }

  if (value.trim().toLowerCase() === 'all') {
    return [...FEATURES];
  }

  const names = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const unknown = names.filter((name) => !isFeature(name));

  if (unknown.length > 0) {
    console.error(`Unbekannte Module: ${unknown.join(', ')}`);
    console.error(`Möglich sind: ${FEATURES.join(', ')} — oder "all".`);
    process.exit(1);
  }

  return names.filter(isFeature);
}

function readPrivateKey(options: Map<string, string>): string {
  const file = options.get('key-file');

  if (file) {
    return fs.readFileSync(file, 'utf8').trim();
  }

  const fromEnvironment = process.env.UNIKOM_LICENCE_PRIVATE_KEY?.trim();

  if (!fromEnvironment) {
    console.error('Kein privater Schlüssel: UNIKOM_LICENCE_PRIVATE_KEY setzen oder --key-file angeben.');
    process.exit(1);
  }

  return fromEnvironment;
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);

  if (!value) {
    console.error(`Es fehlt --${name}`);
    process.exit(1);
  }

  return value;
}

/** `--name value` and `--name=value`; a flag without a value becomes "". */
function parseOptions(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith('--')) {
      continue;
    }

    const separator = entry.indexOf('=');

    if (separator > 0) {
      options.set(entry.slice(2, separator), entry.slice(separator + 1));
      continue;
    }

    const next = argv[index + 1];
    options.set(entry.slice(2), next && !next.startsWith('--') ? next : '');
  }

  return options;
}

function printUsage(): void {
  console.log(`
Unikom — Lizenzen

  npm run licence -- keys
      Erzeugt ein Schlüsselpaar. Einmal pro Produkt, nicht pro Kunde.

  npm run licence -- issue --customer "Muster GmbH" --until 2027-03-31
                           [--features REMOTE_SOURCES,ENCRYPTION | all]
                           [--warn ${DEFAULT_WARNING_DAYS}] [--id LIC-...] [--out unikom.licence]
                           [--key-file privat.key]
      Stellt eine Lizenz aus. Der private Schlüssel kommt aus
      UNIKOM_LICENCE_PRIVATE_KEY oder aus --key-file.

  npm run licence -- show unikom.licence [--public-key <base64>]
      Prüft eine Lizenz und zeigt, was sie sagt.

  Module: ${FEATURES.join(', ')}
`);
}

main(process.argv.slice(2));
