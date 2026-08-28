import { Client } from 'basic-ftp';

import type { SourceCredentials, SourceTrace } from '../../../domain/source/SourceAdapter.js';
import type { SourceConfig } from '../../../domain/transfer/TransferJob.js';

/**
 * Eine FTPS-Verbindung aufbauen — für die lesende und die schreibende Seite.
 *
 * Wie beim SFTP-Gegenstück steht hier eine Entscheidung, die es nur einmal
 * geben darf: ob ein Zertifikat geprüft wird. Zwei Fassungen davon wären zwei
 * Gelegenheiten, die Prüfung an einer Stelle stillschweigend fallen zu lassen.
 */

/** Der Vorgabeport hängt daran, wann TLS beginnt (Spec Abschnitt 7). */
export function ftpsPort(config: SourceConfig): number {
  return config.port ?? (config.implicitFtps ? 990 : 21);
}

export async function openFtpsConnection(
  config: SourceConfig,
  credentials: SourceCredentials,
  trace: SourceTrace | undefined,
  role: 'Quelle' | 'Ziel'
): Promise<Client> {
  if (!config.host) {
    throw new Error(`Für dieses FTPS-${role} ist kein Server eingetragen`);
  }

  const client = new Client((config.timeoutSeconds ?? 30) * 1000);

  const mode = config.implicitFtps ? 'implizites TLS' : 'explizites TLS';
  const certificates = config.validateCertificates === false ? 'ungeprüft' : 'geprüft';
  trace?.(
    `Verbindung zu ${config.host}:${ftpsPort(config)} als ` +
      `„${credentials.username ?? config.username ?? '-'}“ über ${mode}, Zertifikat ${certificates}`
  );

  try {
    await client.access({
      host: config.host,
      port: ftpsPort(config),
      user: credentials.username ?? config.username,
      password: credentials.password,
      // Explizites FTPS als Vorgabe, implizites nur auf Verlangen.
      secure: config.implicitFtps ? 'implicit' : true,
      secureOptions: {
        // Zertifikate werden geprüft, solange es der Workflow nicht
        // ausdrücklich abstellt (Spec Abschnitt 7).
        rejectUnauthorized: config.validateCertificates !== false,
        servername: config.host,
        // Lässt ein eigenes oder selbstsigniertes Serverzertifikat zu, ohne
        // die Prüfung für alle anderen Server aufzugeben.
        ca: config.trustedCertificate,
      },
    });
  } catch (error) {
    trace?.(`Verbindung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  trace?.(`Verbunden und angemeldet über ${mode}`);
  return client;
}
