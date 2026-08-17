import { isFeature, type Feature } from './Feature.js';
import { DEFAULT_WARNING_DAYS, type Licence } from './Licence.js';

/**
 * A licence travels as one line of text:
 *
 *   UNIKOM-LICENCE-1.<payload>.<signature>
 *
 * `payload` is the licence as JSON in base64url, `signature` is the vendor's
 * signature over exactly that payload string. Signing the encoded text rather
 * than the object means the check never depends on how JSON is serialised — two
 * libraries ordering keys differently would otherwise invalidate a good licence.
 *
 * One line of text so it survives the way licences actually travel: an e-mail, a
 * text field, a file copied onto a server.
 */
export const LICENCE_PREFIX = 'UNIKOM-LICENCE-1';

export interface LicenceDocument {
  /** The base64url text the signature covers. */
  payload: string;
  signature: Buffer;
}

/** Raised for anything malformed; the caller turns it into INVALID. */
export class LicenceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenceFormatError';
  }
}

export function composeLicenceDocument(payload: string, signature: Buffer): string {
  return `${LICENCE_PREFIX}.${payload}.${signature.toString('base64url')}`;
}

/**
 * Splits the text without checking the signature — that needs a key and belongs
 * to the infrastructure. Whitespace and line breaks are dropped first: a licence
 * that went through an e-mail arrives wrapped.
 */
export function splitLicenceDocument(text: string): LicenceDocument {
  const compact = text.replace(/\s+/g, '');
  const parts = compact.split('.');

  if (parts.length !== 3 || parts[0] !== LICENCE_PREFIX) {
    throw new LicenceFormatError('Das ist keine Unikom-Lizenz.');
  }

  const [, payload, signature] = parts;

  if (!payload || !signature) {
    throw new LicenceFormatError('Die Lizenz ist unvollständig.');
  }

  return { payload, signature: Buffer.from(signature, 'base64url') };
}

export function encodeLicencePayload(licence: Licence): string {
  const record = {
    id: licence.id,
    customer: licence.customer,
    issuedAt: licence.issuedAt.toISOString(),
    validUntil: licence.validUntil.toISOString(),
    features: [...licence.features],
    warningDays: licence.warningDays,
  };

  return Buffer.from(JSON.stringify(record), 'utf8').toString('base64url');
}

/**
 * Reads the payload back. Everything is checked here rather than trusted,
 * because a signature only proves who wrote the text, not that it says
 * something this version understands.
 */
export function decodeLicencePayload(payload: string): Licence {
  let record: unknown;

  try {
    record = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new LicenceFormatError('Der Inhalt der Lizenz ist unlesbar.');
  }

  if (typeof record !== 'object' || record === null) {
    throw new LicenceFormatError('Der Inhalt der Lizenz ist unlesbar.');
  }

  const fields = record as Record<string, unknown>;

  return {
    id: requireText(fields.id, 'id'),
    customer: requireText(fields.customer, 'customer'),
    issuedAt: requireDate(fields.issuedAt, 'issuedAt'),
    validUntil: requireDate(fields.validUntil, 'validUntil'),
    // A module this version does not know cannot be granted — dropping it is
    // the fail-closed reading, and it keeps a newer licence usable on an older
    // installation instead of invalidating it wholesale.
    features: Array.isArray(fields.features)
      ? fields.features.filter((entry): entry is Feature => typeof entry === 'string' && isFeature(entry))
      : [],
    warningDays:
      typeof fields.warningDays === 'number' && Number.isFinite(fields.warningDays) && fields.warningDays >= 0
        ? Math.floor(fields.warningDays)
        : DEFAULT_WARNING_DAYS,
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LicenceFormatError(`In der Lizenz fehlt "${field}".`);
  }

  return value;
}

function requireDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new LicenceFormatError(`In der Lizenz fehlt "${field}".`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new LicenceFormatError(`Das Datum "${field}" in der Lizenz ist ungültig.`);
  }

  return date;
}
