import crypto from 'node:crypto';
import Client from 'ssh2-sftp-client';

import type { SourceCredentials, SourceTrace } from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';

/**
 * Eine SFTP-Verbindung aufbauen — für die lesende und die schreibende Seite.
 *
 * Herausgezogen, sobald es eine zweite Seite gab. Der Grund ist nicht die
 * Zeilenzahl: Hier sitzt die Hostkey-Prüfung, und zwei Fassungen davon wären
 * zwei Gelegenheiten, sich darüber uneins zu werden, wann eine Verbindung
 * abgelehnt gehört. Eine davon würde irgendwann nachgeben, und niemand merkte
 * es, bis es darauf ankäme.
 */

/** Formatiert einen Hostkey so, wie OpenSSH ihn zeigt — zum Vergleichen. */
export function fingerprintOf(hostKey: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
}

function normaliseFingerprint(value: string): string {
  const trimmed = value.trim().replace(/=+$/, '');
  return trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${trimmed}`;
}

/**
 * Hostkey-Prüfung (Spec Abschnitt 6). Ohne hinterlegten Fingerabdruck wird die
 * Verbindung abgelehnt; das Abschalten der Prüfung verlangt das ausdrückliche
 * `allowUnknownHostKey`. Gibt die Begründung zurück, wenn abgelehnt wird —
 * eine abgelehnte Verbindung erscheint sonst als allgemeiner Handschlagfehler
 * und schickt den Anwender an die falsche Stelle.
 */
function verifyHostKey(
  config: SourceConfig,
  hostKey: Buffer,
  trace: SourceTrace | undefined
): { accepted: boolean; problem?: string } {
  const actual = fingerprintOf(hostKey);
  trace?.(`Der Server zeigt den Hostkey ${actual}`);

  if (config.hostKeyFingerprint) {
    const expected = normaliseFingerprint(config.hostKeyFingerprint);
    const matches =
      expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

    trace?.(
      matches ? 'Der Hostkey stimmt mit dem hinterlegten Fingerabdruck überein' : 'Der Hostkey stimmt NICHT überein'
    );

    return matches
      ? { accepted: true }
      : {
          accepted: false,
          problem:
            `Der SSH-Hostkey von ${config.host} stimmt nicht mit dem hinterlegten Fingerabdruck überein. ` +
            `Erwartet ${expected}, der Server zeigt ${actual}. Die Verbindung wurde abgelehnt.`,
        };
  }

  if (config.allowUnknownHostKey === true) {
    trace?.('Der Hostkey wird ungeprüft angenommen, weil der Workflow einen unbekannten Schlüssel erlaubt');
    return { accepted: true };
  }

  return {
    accepted: false,
    problem:
      `Für ${config.host} ist kein SSH-Hostkey-Fingerabdruck hinterlegt. ` +
      `Der Server zeigt ${actual}. Diesen Wert nach einer Prüfung als Fingerabdruck eintragen — ` +
      'oder ausdrücklich erlauben, dass ein unbekannter Hostkey angenommen wird.',
  };
}

/**
 * @param role Wofür die Verbindung gebraucht wird, für die Fehlermeldung —
 * „Quelle" oder „Ziel". Ein Workflow von Server zu Server hat zwei davon, und
 * „kein Server eingetragen" wäre sonst nicht zuzuordnen.
 */
export async function openSftpConnection(
  config: SourceConfig,
  credentials: SourceCredentials,
  trace: SourceTrace | undefined,
  role: 'Quelle' | 'Ziel'
): Promise<Client> {
  if (!config.host) {
    throw new Error(`Für diese SFTP-${role} ist kein Server eingetragen`);
  }

  const client = new Client();
  let hostKeyProblem: string | undefined;

  const method = credentials.privateKey ? 'Schlüsseldatei' : credentials.password ? 'Passwort' : 'ohne Anmeldedaten';
  trace?.(
    `Verbindung zu ${config.host}:${config.port ?? 22} als ` +
      `„${credentials.username ?? config.username ?? '—'}“ über ${method}`
  );

  try {
    await client.connect({
      host: config.host,
      port: config.port ?? 22,
      username: credentials.username ?? config.username,
      password: credentials.password,
      privateKey: credentials.privateKey,
      passphrase: credentials.passphrase,
      readyTimeout: (config.timeoutSeconds ?? 30) * 1000,
      hostVerifier: (hostKey: Buffer) => {
        const verdict = verifyHostKey(config, hostKey, trace);
        hostKeyProblem = verdict.problem;
        return verdict.accepted;
      },
    });
  } catch (error) {
    if (hostKeyProblem) {
      trace?.(hostKeyProblem);
      throw new Error(hostKeyProblem);
    }

    trace?.(`Verbindung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  trace?.(`Verbunden und angemeldet über ${method}`);
  return client;
}
