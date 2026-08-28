import type { CredentialRepository } from '../../domain/credentials/Credential.js';
import { allFeatures, type Feature, type FeatureSet } from '../../domain/licensing/Feature.js';
import type { TenantRepository } from '../../domain/tenants/Tenant.js';
import type { TransferJob } from '../../domain/transfer/TransferJob.js';
import type { TransferJobRepository } from '../../domain/transfer/TransferJobRepository.js';
import {
  activeStages,
  durchgaenge,
  durchgangsname,
  followingStage,
  precedingStage,
  schreibtDatei,
  stageConfig,
  stageIsActive,
  STAGE_LABELS,
} from '../../domain/transfer/WorkflowStages.js';
import { ablagestand } from '../../domain/transfer/Ablageorte.js';
import { isSafeFilename } from '../../infrastructure/filesystem/SafePath.js';
import { assertJobIsLicensed, requiredFeaturesFor } from '../licensing/JobLicensing.js';
import { assertJobStaysWithinItsTenant } from '../tenants/JobTenantRules.js';

/**
 * The way in for everything that creates or changes jobs: job editor, API, CLI
 * and imports. It is the first of the two places where licensing is enforced,
 * so writing to the repository directly bypasses that check — worth keeping
 * that path to tests and fixtures.
 */
export class TransferJobService {
  constructor(
    private readonly repository: TransferJobRepository,
    private readonly features: FeatureSet = allFeatures(),
    /** Absent in tests that do not care about clients. */
    private readonly tenants?: TenantRepository,
    private readonly credentials?: CredentialRepository
  ) {}

  async getAll(): Promise<TransferJob[]> {
    return this.repository.list();
  }

  async getById(id: string): Promise<TransferJob | undefined> {
    return this.repository.getById(id);
  }

  async create(job: TransferJob): Promise<TransferJob> {
    assertJobIsLicensed(job, this.features);
    assertEncryptionIsCoherent(job);
    assertConflictNameIsUsable(job);
    assertRemoteConnectionsAreComplete(job);
    assertStagesAreCoherent(job);
    assertAblageorteSindDa(job);
    await this.assertTenantRules(job);

    return this.repository.save(job);
  }

  async update(id: string, patch: Partial<TransferJob>): Promise<TransferJob | undefined> {
    const existing = await this.repository.getById(id);
    if (!existing) {
      return undefined;
    }

    const updated: TransferJob = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };

    // The merged job is what gets checked, not the patch: switching a local
    // job over to SFTP arrives here as a change to two unremarkable fields,
    // and so does moving a destination out of a client's directory.
    assertJobIsLicensed(updated, this.features);
    assertEncryptionIsCoherent(updated);
    assertConflictNameIsUsable(updated);
    assertRemoteConnectionsAreComplete(updated);
    assertStagesAreCoherent(updated);
    assertAblageorteSindDa(updated);
    await this.assertTenantRules(updated);

    return this.repository.save(updated);
  }

  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  /**
   * Jobs that exist but can no longer run because their module is missing.
   * A downgraded licence must not silently turn nightly transfers into
   * nothing — the overview has to be able to name them.
   */
  private async assertTenantRules(job: TransferJob): Promise<void> {
    if (this.tenants && this.credentials) {
      await assertJobStaysWithinItsTenant(job, this.tenants, this.credentials);
    }
  }

  async listUnlicensed(): Promise<{ job: TransferJob; missing: Feature[] }[]> {
    const jobs = await this.repository.list();

    return jobs
      .map((job) => ({
        job,
        missing: requiredFeaturesFor(job).filter((feature) => !this.features.isEnabled(feature)),
      }))
      .filter((entry) => entry.missing.length > 0);
  }
}

/**
 * Two settings that cannot both be true.
 *
 * Encrypting *while fetching* means the bytes go through the cipher on their way
 * in, before anything is written. A source that already delivers ciphertext
 * would then be wrapped a second time, and the content — which the run is
 * supposed to work with — would stay closed. Opening first and locking again is
 * a different order, and that is the one to use here.
 *
 * Refusing at save time rather than at three in the morning.
 */
export function assertEncryptionIsCoherent(job: TransferJob): void {
  const encryptsOnPickup = job.encryptionConfig.onPickup === true;

  if (job.sourceEncryption?.enabled && encryptsOnPickup) {
    throw new Error(
      'Eine Quelle, die verschlüsselte Dateien liefert, kann nicht zusätzlich beim Abholen verschlüsselt werden: ' +
        'Die Datei bekäme eine zweite Hülle, und ihr Inhalt bliebe verschlossen. Stattdessen vor der Ablage ' +
        'verschlüsseln - die Datei wird dann im Arbeitsbereich geöffnet und mit dem Schlüssel des Ziels wieder ' +
        'verschlossen.'
    );
  }

  if (job.sourceEncryption?.enabled && !job.sourceEncryption.keyCredentialId) {
    throw new Error('Eine verschlüsselte Quelle braucht den Schlüssel, der ihre Dateien öffnet.');
  }
}

/**
 * Eine entfernte Verbindung braucht einen Server — auf beiden Seiten.
 *
 * Ohne diese Prüfung ließe sich ein Workflow anlegen, der SFTP als Quelle oder
 * Ziel führt und kein Ziel kennt, an das er sich wenden könnte. Er speichert
 * sich anstandslos, steht in der Liste wie jeder andere, und scheitert das
 * erste Mal um drei Uhr nachts — mit einer Meldung über eine fehlende
 * Servereintragung, die dann niemand liest.
 *
 * Der Zugang wird nicht verlangt: Ein offener FTP-Server ohne Anmeldung ist
 * selten, aber es gibt ihn, und ihn zu verbieten wäre eine Regel, die mehr
 * kostet als sie einbringt. Ein Server ohne Namen dagegen ist in keinem Fall
 * etwas anderes als ein Versehen.
 */
export function assertRemoteConnectionsAreComplete(job: TransferJob): void {
  const benannt = (host: string | undefined): boolean => (host ?? '').trim().length > 0;

  /*
   * Eine Freigabe braucht einen UNC-Pfad und einen Zugang.
   *
   * `D:\Daten` als Freigabe einzutragen ergäbe einen Workflow, der einen Zugang
   * mit sich trägt, den nichts benutzt: Verbunden wird nur, was über das Netz
   * führt. Er liefe scheinbar richtig und griffe die ganze Zeit auf die eigene
   * Platte zu — die Art zu wechseln wäre folgenlos geblieben, und genau das
   * merkt niemand.
   *
   * Und der Zugang: Ohne ihn wird die Freigabe mit dem Konto erreicht, unter
   * dem Unikom gerade läuft. Das ist nicht das Konto dessen, der den Workflow
   * anlegt, und im Betrieb als Windows-Dienst ist es womöglich eines, das im
   * Netz überhaupt nichts darf. Ein Workflow, der beim Einrichten funktioniert
   * und nach der Dienstinstallation nichts mehr findet, ist der teuerste
   * Fehler von allen: Er zeigt sich Monate später und sieht nach einem
   * Netzproblem aus. Deshalb ist der Zugang hier Pflicht und keine
   * Möglichkeit — anders als bei SFTP und FTPS, wo es offene Server ohne
   * Anmeldung wirklich gibt.
   */
  const alsFreigabe = (directory: string, was: string): void => {
    if (!/^\\\\[^\\/]+\\/.test(directory.trim())) {
      throw new Error(
        `${was} ist als Freigabe eingestellt, „${directory}“ ist aber kein Netzwerkpfad. ` +
          'Eine Freigabe wird als \\\\Server\\Freigabe\\Ordner angegeben. Für einen Pfad auf diesem Rechner ' +
          'ist „Lokales Verzeichnis“ die richtige Art.'
      );
    }
  };

  const mitZugang = (credentialId: string | undefined, was: string): void => {
    if (!(credentialId ?? '').trim()) {
      throw new Error(
        `${was} ist als Freigabe eingestellt, es ist aber kein Zugang hinterlegt. Eine Freigabe wird mit ` +
          'Benutzername und Kennwort verbunden - ohne beides würde sie mit dem Konto erreicht, unter dem der ' +
          'Dienst gerade läuft, und das ist nicht Ihres.'
      );
    }
  };

  if (job.sourceType === 'SHARE') {
    alsFreigabe(job.sourceDirectory, 'Die Quelle');
    mitZugang(job.credentialId, 'Die Quelle');

  }

  if (job.destinationType === 'SHARE') {
    alsFreigabe(job.destinationDirectory, 'Das Ziel');
    mitZugang(job.destinationCredentialId, 'Das Ziel');
  }

  if ((job.sourceType === 'SFTP' || job.sourceType === 'FTPS') && !benannt(job.sourceConfig.host)) {
    throw new Error(
      `Die Quelle ist als ${job.sourceType} eingestellt, es ist aber kein Server eingetragen. ` +
        'Ohne Servernamen gibt es niemanden, bei dem die Dateien geholt werden könnten.'
    );
  }

  if (
    (job.destinationType === 'SFTP' || job.destinationType === 'FTPS') &&
    !benannt(job.destinationConfig?.host)
  ) {
    throw new Error(
      `Das Ziel ist als ${job.destinationType} eingestellt, es ist aber kein Server eingetragen. ` +
        'Ohne Servernamen gibt es niemanden, bei dem die Dateien abgelegt werden könnten.'
    );
  }
}

/**
 * A chosen name has to be one, and has to be usable as one.
 *
 * Checked here rather than at run time: a job that promises a name it does not
 * have would fetch its files and then have nowhere to put them — at night,
 * with the source already emptied. And a name with a slash in it would not be
 * a name but a path, which is the one thing a remote-fed filename must never
 * become.
 */
export function assertConflictNameIsUsable(job: TransferJob): void {
  if (job.conflictStrategy !== 'NEW_NAME') {
    return;
  }

  const chosen = job.conflictFilename?.trim() ?? '';

  if (chosen.length === 0) {
    throw new Error('„Unter neuem Namen anlegen“ braucht diesen Namen.');
  }

  if (!isSafeFilename(chosen)) {
    throw new Error(
      `„${chosen}“ lässt sich nicht als Dateiname verwenden. Es muss ein einfacher Name sein - ohne Pfad und ` +
        'ohne Zeichen, die das Dateisystem ablehnt.'
    );
  }
}

/**
 * Every chain link has to read somewhere and write somewhere.
 *
 * Two things can dangle, and both do so silently. A link may only hand its
 * result on if another follows it, and may only inherit its source if another
 * precedes it — neither is guaranteed, because every link is switchable and a
 * workflow may well consist of one.
 *
 * The links are checked by the same rules rather than one by one: they differ in
 * what they do to the records, not in how they are wired.
 */
export function assertStagesAreCoherent(job: TransferJob): void {
  const named = (directory: string | undefined, what: string): void => {
    if (!directory?.trim()) {
      throw new Error(`${what} braucht ein Verzeichnis.`);
    }
  };

  // A job in which nothing is switched on is not an empty job, it is a job that
  // would run every night and do nothing at all.
  if (activeStages(job).length === 0) {
    throw new Error(
      `Im Workflow „${job.name}“ ist kein einziger Schritt eingeschaltet. Mindestens einer muss es sein.`
    );
  }

  for (const stage of activeStages(job)) {
    const config = stageConfig(job, stage);

    if (!config) {
      continue;
    }

    const label = `„${STAGE_LABELS[stage]}“`;

    if (config.input.from === 'PRECEDING') {
      // Nothing to inherit from means the link has to be told a directory.
      if (!precedingStage(stage, job)) {
        throw new Error(
          `${label} soll übernehmen, was der Schritt davor ablegt - es gibt aber keinen Schritt davor. ` +
            'Entweder ein eigenes Verzeichnis angeben oder einen Schritt davorschalten.'
        );
      }
    } else {
      named(config.input.directory, `Die Quelle von ${label}`);
    }

    if (config.output?.to === 'FOLLOWING') {
      if (!followingStage(stage, job)) {
        throw new Error(
          `${label} soll sein Ergebnis weiterreichen - es folgt aber kein Schritt. Entweder einen Schritt ` +
            'dahinterschalten oder ein eigenes Zielverzeichnis angeben; sonst hätte das Ergebnis keinen Platz.'
        );
      }
    } else if (config.output) {
      named(config.output.directory, `Das Ziel von ${label}`);
    } else if (schreibtDatei(job, stage)) {
      /*
       * Der Datenbankimport schreibt in Tabellen und hat deshalb kein
       * Verzeichnis. Alles andere legt eine Datei ab, und die braucht einen
       * Ort — auch die Konsolidierung, wenn nach ihr nichts mehr kommt: „Wenn
       * Modul 3 nicht ausgeführt werden kann (nicht angehakt, nicht gekauft),
       * dann brauchen wir bei Modul 2 ein Ergebnis-Verzeichnis, das angegeben
       * werden muss."
       *
       * Der Ergebnisbestand aus Etappe 7 ersetzt das nicht. Er ist Unikoms
       * eigene Buchführung — geprüft, freigegeben, mit Geschichte. Der Kunde
       * kommt an seine Daten über ein Verzeichnis, und wer nur Modul 2 gekauft
       * hat, hat kein anderes Glied, das sie ihm hinlegt.
       */
      throw new Error(`Das Ziel von ${label} braucht ein Verzeichnis.`);
    }
  }
}


/**
 * Ein Durchgang, der selbst abholt, braucht seine vier Verzeichnisse.
 *
 * ## Warum hier und nicht erst im Lauf
 *
 * Der Lauf prüft es auch — er muss, denn ein Workflow aus einer älteren Fassung
 * kennt die Pflicht nicht. Aber ein Workflow, der sich speichern lässt und dann
 * nachts nicht anfängt, meldet seinen Einrichtungsfehler an niemanden: Wer ihn
 * angelegt hat, ist längst nach Hause gegangen, und der Fehler zeigt sich als
 * eine ausgebliebene Lieferung.
 *
 * Beide Male derselbe Satz aus derselben Funktion. Zwei Formulierungen für
 * dieselbe Bedingung wären zwei, die auseinanderlaufen.
 *
 * ## Warum nur bei eingeschalteter Konsolidierung
 *
 * Ein abgeschalteter Schritt läuft nicht, und seine halbfertige Einstellung
 * aufzubewahren ist genau das, wofür der Schalter da ist — wer ihn wieder
 * anhakt, bekommt die Meldung dann.
 */
export function assertAblageorteSindDa(job: TransferJob): void {
  if (!stageIsActive(job, 'CONSOLIDATE')) {
    return;
  }

  const folge = durchgaenge(job.consolidation);

  for (const [stelle, durchgang] of folge.entries()) {
    const stand = ablagestand(durchgang, durchgangsname(durchgang, stelle, folge.length));

    if (stand.art === 'UNVOLLSTAENDIG') {
      throw new Error(stand.hinweis);
    }
  }
}
