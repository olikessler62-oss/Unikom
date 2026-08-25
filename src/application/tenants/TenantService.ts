import type { Meldeeinstellungen } from '../../domain/background/Postausgang.js';
import type { Konfliktverhalten } from '../../domain/conflicts/Konfliktverhalten.js';
import type { Mandanteneinstellungen } from '../../domain/consolidation/Einstellungen.js';
import { pruefeEinstellungen } from '../../domain/consolidation/Einstellungspruefung.js';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  type Tenant,
  type TenantRepository,
} from '../../domain/tenants/Tenant.js';
import { assertRegionIsUsable, type Region } from '../../domain/tenants/Region.js';
import {
  assertWithinTenant,
  rootsOverlap,
  TenantBoundaryError,
} from '../../domain/tenants/TenantContainment.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';

export class TenantService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly jobRepository: TransferJobRepository
  ) {}

  list(): Promise<Tenant[]> {
    return this.tenantRepository.list();
  }

  getById(id: string): Promise<Tenant | undefined> {
    return this.tenantRepository.getById(id);
  }

  async create(input: {
    name: string;
    description?: string;
    rootDirectory?: string;
    region?: Region;
  }): Promise<Tenant> {
    const name = input.name.trim();

    if (!name) {
      throw new Error('Ein Mandant braucht einen Namen');
    }

    if (await this.tenantRepository.findByName(name)) {
      throw new Error(`Einen Mandanten namens „${name}“ gibt es schon`);
    }

    await this.assertRootIsFree(input.rootDirectory, undefined);

    if (input.region) {
      assertRegionIsUsable(input.region);
    }

    const now = new Date();

    return this.tenantRepository.save({
      id: randomUUID(),
      name,
      description: input.description?.trim() || undefined,
      rootDirectory: input.rootDirectory?.trim() || undefined,
      region: input.region,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(
    id: string,
    changes: {
      name?: string;
      description?: string;
      rootDirectory?: string;
      region?: Region;
      enabled?: boolean;
      /** Wohin Meldungen gehen. `null` löscht die Einstellung. */
      benachrichtigung?: Meldeeinstellungen | null;
      /**
       * Die Konsolidierungseinstellungen dieses Kunden — die Ebene, die in der
       * Hierarchie gewinnt (SPEC-02, Abschnitt 40).
       *
       * Sie war bis hierher nur lesbar: Neun Stellen im Erzeugnis fragten
       * danach, und keine einzige konnte sie setzen. Die Spitze der Hierarchie
       * war damit immer leer, und es galt überall die Voreinstellung.
       */
      consolidation?: Mandanteneinstellungen | null;
      /**
       * Wie lange Ausleitungen liegen bleiben (SPEC-07 §5). `null` nimmt die
       * Einstellung fort — dann gilt wieder die Voreinstellung.
       */
      ausleitungenTage?: number | null;
      /** Wie lange Archivpakete liegen bleiben. `null` nimmt die Angabe fort. */
      archivTage?: number | null;
      /**
       * Wie dieser Mandant mit offenen Konflikten umgeht. `null` nimmt die
       * Einstellung fort — dann gilt wieder die Voreinstellung.
       */
      konflikte?: Konfliktverhalten | null;
    }
  ): Promise<Tenant> {
    const tenant = await this.require(id);

    /*
     * Geprüft wird, bevor irgendetwas gespeichert wird. Eine Region, die still
     * auf die Einstellung des Rechners ausweicht, stünde sonst im Mandanten,
     * und jede Datei dieses Kunden würde danach anders gelesen als angezeigt.
     */
    if (changes.region !== undefined) {
      assertRegionIsUsable(changes.region);
    }

    /*
     * Geprüft, bevor irgendetwas gespeichert wird — und alle Fehler auf einmal.
     * Ein Zahlendreher hier wirkt auf jeden Lauf jedes Workflows dieses Kunden,
     * und er fällt nicht auf: Eine Stichprobe von drei liefert Typen, nur eben
     * geratene.
     */
    if (changes.consolidation) {
      const fehler = pruefeEinstellungen(changes.consolidation);

      if (fehler.length > 0) {
        throw new Error(fehler.map((eintrag) => eintrag.grund).join(' — '));
      }
    }

    if (changes.name !== undefined) {
      const conflicting = await this.tenantRepository.findByName(changes.name.trim());

      if (conflicting && conflicting.id !== id) {
        throw new Error(`Einen Mandanten namens „${changes.name.trim()}“ gibt es schon`);
      }
    }

    if (changes.rootDirectory !== undefined) {
      await this.assertRootIsFree(changes.rootDirectory, id);
      await this.assertExistingJobsStayInside(id, changes.rootDirectory);
    }

    return this.tenantRepository.save({
      ...tenant,
      name: changes.name?.trim() || tenant.name,
      description: changes.description === undefined ? tenant.description : changes.description.trim() || undefined,
      rootDirectory:
        changes.rootDirectory === undefined ? tenant.rootDirectory : changes.rootDirectory.trim() || undefined,
      region: changes.region ?? tenant.region,
      enabled: changes.enabled ?? tenant.enabled,
      /*
       * `null` heißt „fortnehmen", `undefined` heißt „nicht angefasst". Ohne
       * diesen Unterschied ließe sich ein einmal eingetragener Postausgang nie
       * wieder abschalten.
       */
      benachrichtigung: changes.benachrichtigung === undefined
        ? tenant.benachrichtigung
        : (changes.benachrichtigung ?? undefined),
      consolidation: changes.consolidation === undefined
        ? tenant.consolidation
        : (changes.consolidation ?? undefined),
      ausleitungenTage: changes.ausleitungenTage === undefined
        ? tenant.ausleitungenTage
        : (changes.ausleitungenTage ?? undefined),
      archivTage: changes.archivTage === undefined ? tenant.archivTage : (changes.archivTage ?? undefined),
      konflikte: changes.konflikte === undefined ? tenant.konflikte : (changes.konflikte ?? undefined),
      updatedAt: new Date(),
    });
  }

  /**
   * Deleting is refused while jobs still point at the client. Silently taking
   * their jobs with them would remove a schedule somebody relies on; moving
   * them elsewhere would put one client's data in another one's hands.
   */
  async delete(id: string): Promise<void> {
    const jobs = (await this.jobRepository.list()).filter((job) => job.tenantId === id);

    if (jobs.length > 0) {
      const tenant = await this.require(id);
      throw new Error(
        `„${tenant.name}“ hat noch ${jobs.length} Workflow(s). Diese bitte zuerst löschen oder umhängen — ` +
          'deleting the client would either take a running schedule with it or hand its jobs to somebody else.'
      );
    }

    await this.tenantRepository.delete(id);
  }

  /**
   * Creates the standard client on an empty installation and adopts jobs that
   * predate clients. A company with a single source server never has to think
   * about clients at all this way.
   */
  async ensureDefaultTenant(): Promise<Tenant> {
    const existing = await this.tenantRepository.getById(DEFAULT_TENANT_ID);
    const now = new Date();

    const tenant =
      existing ??
      (await this.tenantRepository.save({
        id: DEFAULT_TENANT_ID,
        name: DEFAULT_TENANT_NAME,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }));

    for (const job of await this.jobRepository.list()) {
      if (!job.tenantId) {
        await this.jobRepository.save({ ...job, tenantId: DEFAULT_TENANT_ID, updatedAt: now });
      }
    }

    return tenant;
  }

  private async require(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.getById(id);

    if (!tenant) {
      throw new Error(`Den Mandanten ${id} gibt es nicht`);
    }

    return tenant;
  }

  /**
   * Two clients may not share or nest their directories. Nesting would make the
   * boundary hold in one direction only, which is worse than having none:
   * it looks like a guarantee.
   */
  private async assertRootIsFree(rootDirectory: string | undefined, ownId: string | undefined): Promise<void> {
    const root = rootDirectory?.trim();

    if (!root) {
      return;
    }

    for (const other of await this.tenantRepository.list()) {
      if (other.id === ownId || !other.rootDirectory) {
        continue;
      }

      if (rootsOverlap(root, other.rootDirectory)) {
        throw new TenantBoundaryError(
          other.name,
          `${root} overlaps with the directory of "${other.name}" (${other.rootDirectory}). ` +
            'Two clients must not share or nest their directories.'
        );
      }
    }
  }

  /** Narrowing a root must not leave existing jobs writing outside it. */
  private async assertExistingJobsStayInside(tenantId: string, rootDirectory: string): Promise<void> {
    const root = rootDirectory.trim();

    if (!root) {
      return;
    }

    const tenant = await this.require(tenantId);
    const candidate: Tenant = { ...tenant, rootDirectory: root };

    for (const job of await this.jobRepository.list()) {
      if (job.tenantId === tenantId) {
        assertWithinTenant(candidate, job.destinationDirectory, `Das Ziel des Workflows „${job.name}“`);
      }
    }
  }
}
