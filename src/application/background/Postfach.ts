import type { Meldeeinstellungen } from '../../domain/background/Postausgang.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { Anmeldebuch, Anmeldung } from '../../infrastructure/mail/SmtpPostbote.js';
import type { CredentialService } from '../credentials/CredentialService.js';

/**
 * Woher der Postbote seine Angaben bekommt.
 *
 * Zwei kleine Übersetzer, und beide gibt es aus demselben Grund: Der Postbote
 * soll nichts über Mandanten und nichts über die Zugangsverwaltung wissen
 * müssen. Er kennt einen Server, eine Anmeldung und eine Nachricht.
 */
export function meldeeinstellungenAus(
  tenants: TenantRepository
): (tenantId: string) => Promise<Meldeeinstellungen | undefined> {
  return async (tenantId) => (await tenants.getById(tenantId))?.benachrichtigung;
}

/**
 * Benutzer und Kennwort aus einem hinterlegten Zugang.
 *
 * Das Kennwort wird bei **jedem** Versand neu entschlüsselt und nirgends
 * gehalten. Ein Kennwort in einem langlebigen Objekt steht in jedem
 * Speicherabbild — und ein Speicherabbild ist genau das, was jemand
 * mitschickt, wenn er einen Absturz meldet.
 */
export class ZugangsAnmeldebuch implements Anmeldebuch {
  constructor(private readonly credentials: CredentialService) {}

  async anmeldung(zugangId: string): Promise<Anmeldung | undefined> {
    const zugang = await this.credentials.getById(zugangId);

    if (!zugang?.username) {
      return undefined;
    }

    return { benutzer: zugang.username, kennwort: await this.credentials.resolveSecret(zugangId) };
  }
}
