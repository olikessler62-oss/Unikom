import { isUsableBy } from '../../domain/credentials/Credential.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { ShareCredentials } from '../../infrastructure/filesystem/ShareConnectionService.js';
import type { CredentialService } from '../credentials/CredentialService.js';

/**
 * Die Anmeldedaten, mit denen eine Windows-Freigabe verbunden wird.
 *
 * Getrennt für Quelle und Ziel, weil es zwei verschiedene Häuser sein können —
 * und weil ein Zugang, der irgendwo lesen darf, nicht anderswo schreiben
 * können soll. Derselbe Zugang für beide Seiten ist erlaubt, aber es ist eine
 * Entscheidung und keine Voreinstellung.
 *
 * Ohne Zugang bleibt es beim bisherigen Verhalten: Die Freigabe wird mit der
 * Identität des Dienstes erreicht. Das ist der häufige Fall in einem Haus mit
 * einem Domänenkonto, und er darf nichts kosten.
 */
export class ShareAccessProvider {
  constructor(private readonly credentialService?: CredentialService) {}

  forSource(job: TransferJob): Promise<ShareCredentials | undefined> {
    return this.resolve(job.sourceType === 'SHARE' ? job.credentialId : undefined, job, 'Quelle');
  }

  forDestination(job: TransferJob): Promise<ShareCredentials | undefined> {
    return this.resolve(job.destinationType === 'SHARE' ? job.destinationCredentialId : undefined, job, 'Ziel');
  }

  private async resolve(
    credentialId: string | undefined,
    job: TransferJob,
    seite: 'Quelle' | 'Ziel'
  ): Promise<ShareCredentials | undefined> {
    if (!credentialId) {
      return undefined;
    }

    if (!this.credentialService) {
      throw new Error(
        `Die ${seite} von „${job.name}“ verweist auf den Zugang ${credentialId}, aber es ist keine ` +
          'Zugangsverwaltung eingerichtet'
      );
    }

    const credential = await this.credentialService.getById(credentialId);
    if (!credential) {
      throw new Error(`Den in der ${seite} von „${job.name}“ eingetragenen Zugang ${credentialId} gibt es nicht`);
    }

    // Erneut geprüft, nicht nur beim Speichern: Ein Zugang kann danach einem
    // anderen Mandanten zugeordnet werden, und ein Workflow kann unmittelbar in
    // die Datenbank geschrieben werden. Hier wird wirklich verbunden.
    if (!isUsableBy(credential, job.tenantId)) {
      throw new Error(
        `Der Zugang „${credential.name}“ gehört einem anderen Mandanten und darf in der ${seite} von ` +
          `„${job.name}“ nicht verwendet werden`
      );
    }

    if (credential.type !== 'USERNAME_PASSWORD') {
      throw new Error(
        `Der Zugang „${credential.name}“ ist vom Typ ${credential.type}. Eine Windows-Freigabe verlangt ` +
          'Benutzername und Kennwort — einen Schlüssel kennt sie nicht.'
      );
    }

    if (!credential.username) {
      throw new Error(`Dem Zugang „${credential.name}“ fehlt der Benutzername, den die Freigabe verlangt`);
    }

    return {
      username: credential.username,
      password: await this.credentialService.resolveSecret(credential.id),
    };
  }
}
