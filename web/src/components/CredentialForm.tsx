import { useState } from 'react';

import { api } from '../api/client.js';
import { messageOf } from '../api/useResource.js';
import type { Credential, Tenant } from '../api/types.js';
import { Field, Notice } from './Pieces.js';

/**
 * Benannt nach dem Zweck, nicht nach der Technik. „Zugangsdaten" allein ließ
 * jeden fragen: Zugang wozu — und beim Verschlüsselungsschlüssel lautet die
 * Antwort „zu nichts": er öffnet keine Tür, er verschließt eine Datei.
 */
export const CREDENTIAL_TYPE_LABELS: Record<Credential['type'], string> = {
  USERNAME_PASSWORD: 'Anmeldung am Quellserver — Passwort (SFTP/FTPS)',
  SSH_PRIVATE_KEY: 'Anmeldung am Quellserver — SSH-Schlüssel (SFTP)',
  ENCRYPTION_KEY: 'Schlüssel zum Verschlüsseln von Dateien',
};

interface Draft {
  name: string;
  type: Credential['type'];
  username: string;
  secret: string;
  tenantId: string;
  /** Beim Schlüssel: erzeugen lassen, statt einen auszudenken. */
  generate: boolean;
  /** Nur beim SSH-Schlüssel: öffnet die hochgeladene Datei, wird nicht gespeichert. */
  passphrase: string;
}

/** Die Zeile für die `authorized_keys` des Quellservers. */
interface PublicKey {
  algorithm: string;
  publicKey: string;
}

interface Props {
  /**
   * Welche Arten zur Wahl stehen. Der Job-Editor weiß, was er braucht, und
   * bietet dort nur das an — eine Anmeldung im Feld für den Schlüssel wäre
   * eine Wahl, die anschließend nicht funktioniert.
   */
  types?: Credential['type'][];
  /** Vorbelegter Mandant; im Job-Editor der des Jobs. */
  tenantId?: string;
  tenants: Tenant[];
  /** Ob der Mandant hier überhaupt zur Wahl steht. */
  chooseTenant?: boolean;
  onCreated(credential: Credential): void;
  onCancel(): void;
}

/**
 * Das Anlegen eines Schlüssels oder Zugangs — im Workflow, an der Stelle, an der
 * beim Einrichten auffällt, dass etwas fehlt.
 *
 * Nur dort. Eine Verwaltung unter Einstellungen gab es und ist wieder
 * verschwunden: Beim Kunden ändert sich ein Zugang im Takt des Auftrags, nicht
 * im Takt der Installation.
 */
export function CredentialForm({
  types = ['USERNAME_PASSWORD', 'SSH_PRIVATE_KEY', 'ENCRYPTION_KEY'],
  tenantId = '',
  tenants,
  chooseTenant = true,
  onCreated,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<Draft>({
    name: '',
    type: types[0],
    username: '',
    secret: '',
    tenantId,
    generate: true,
    passphrase: '',
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /*
   * Nach dem Anlegen eines SSH-Schlüssels bleibt das Formular noch einen
   * Schritt stehen: Der öffentliche Teil muss auf den Quellserver, und wer die
   * Maske sofort schließt, hat ihn nicht. Nachschlagen lässt er sich später im
   * Workflow neben dem gewählten Zugang — aber der naheliegende Moment ist
   * dieser.
   */
  const [handover, setHandover] = useState<{ credential: Credential; key?: PublicKey; problem?: string }>();

  const sshKey = draft.type === 'SSH_PRIVATE_KEY';
  const generating = draft.generate && (draft.type === 'ENCRYPTION_KEY' || sshKey);
  const ready = draft.name.trim() !== '' && (generating || draft.secret.trim() !== '');

  async function create(): Promise<void> {
    setBusy(true);
    setError(undefined);

    try {
      const credential = await api.post<Credential>('/api/credentials', {
        name: draft.name,
        type: draft.type,
        username: draft.username || undefined,
        tenantId: draft.tenantId || undefined,
        // Ohne Geheimnis erzeugt der Server einen Schlüssel.
        secret: generating ? undefined : draft.secret,
        // Öffnet die hochgeladene Schlüsseldatei; gespeichert wird sie ohne.
        passphrase: sshKey && !generating && draft.passphrase ? draft.passphrase : undefined,
      });

      if (!sshKey) {
        onCreated(credential);
        return;
      }

      /*
       * Der Schlüssel liegt jetzt. Ob der öffentliche Teil abrufbar ist, ist
       * eine zweite Frage — und schlägt sie fehl, ist das kein Grund, das
       * Anlegen rückgängig erscheinen zu lassen.
       */
      try {
        const key = await api.get<PublicKey>(`/api/credentials/${credential.id}/public-key`);
        setHandover({ credential, key });
      } catch (failure) {
        setHandover({ credential, problem: messageOf(failure, 'Der öffentliche Schlüssel ist nicht abrufbar') });
      }
    } catch (failure) {
      setError(messageOf(failure, 'Der Eintrag konnte nicht angelegt werden'));
    } finally {
      setBusy(false);
    }
  }

  if (handover) {
    return (
      <KeyHandover
        name={handover.credential.name}
        publicKey={handover.key?.publicKey}
        problem={handover.problem}
        onDone={() => onCreated(handover.credential)}
      />
    );
  }

  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}

      {/*
       * Nicht „Zugangs-Name": Dasselbe Formular legt auch Verschlüsselungs-
       * schlüssel an — die Art wird gleich darunter gewählt. „Eintrag" ist das
       * Wort, mit dem das Formular sich ohnehin selbst bezeichnet.
       */}
      <Field label="Name des Eintrags">
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
      </Field>

      {types.length > 1 && (
        <Field label="Art">
          <select
            value={draft.type}
            onChange={(event) => setDraft({ ...draft, type: event.target.value as Credential['type'] })}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {CREDENTIAL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {chooseTenant && (
        <Field label="Mandant" hint="Ohne Zuordnung steht der Eintrag allen Mandanten zur Verfügung.">
          <select value={draft.tenantId} onChange={(event) => setDraft({ ...draft, tenantId: event.target.value })}>
            <option value="">Übergreifend</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {draft.type !== 'ENCRYPTION_KEY' && (
        <Field label="Benutzername">
          <input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
        </Field>
      )}

      {draft.type === 'ENCRYPTION_KEY' && (
        <>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={draft.generate}
                onChange={(event) => setDraft({ ...draft, generate: event.target.checked })}
              />
              Schlüssel erzeugen lassen
            </label>
            <div className="field__hint">
              Empfohlen. Ein selbst ausgedachtes Passwort ist selten so stark, wie es aussieht.
            </div>
          </div>

          {!draft.generate && (
            <Field label="Schlüssel">
              <input
                type="password"
                value={draft.secret}
                onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
              />
            </Field>
          )}
        </>
      )}

      {sshKey && (
        <>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={draft.generate}
                onChange={(event) => setDraft({ ...draft, generate: event.target.checked })}
              />
              Schlüsselpaar erzeugen lassen
            </label>
            <div className="field__hint">
              Für den Fall, dass es noch keinen Schlüssel gibt. Unikom behält den privaten Teil und zeigt
              anschließend den öffentlichen — der wird beim Betreiber des Quellservers hinterlegt.
            </div>
          </div>

          {!draft.generate && (
            <>
              <Field
                label="Schlüsseldatei"
                hint="OpenSSH oder PuTTY (.ppk in Version 2). Die Datei wird hier gelesen, nicht irgendwohin geladen."
              >
                <input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                      // Eine Schlüsseldatei ist Text; `text()` bewahrt die
                      // Zeilenumbrüche, an denen das Format hängt.
                      void file.text().then((material) => setDraft((was) => ({ ...was, secret: material })));
                    }
                  }}
                />
              </Field>

              {/*
               * Mehrzeilig, weil ein Schlüssel mehrzeilig ist. Im einzeiligen
               * Feld verlor das Einfügen die Umbrüche, und die Datei war danach
               * unlesbar — ohne dass jemand sah, warum.
               */}
              <Field label="Oder eingefügt">
                <textarea
                  rows={6}
                  spellCheck={false}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={draft.secret}
                  onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
                />
              </Field>

              <Field
                label="Passphrase der Datei"
                hint="Nur falls der Schlüssel eine hat. Sie öffnet die Datei einmal und wird nicht gespeichert — der Eintrag selbst liegt ohnehin verschlüsselt."
              >
                <input
                  type="password"
                  value={draft.passphrase}
                  onChange={(event) => setDraft({ ...draft, passphrase: event.target.value })}
                />
              </Field>
            </>
          )}
        </>
      )}

      {draft.type === 'USERNAME_PASSWORD' && (
        <Field label="Passwort">
          <input
            type="password"
            value={draft.secret}
            onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
          />
        </Field>
      )}

      <div className="row">
        <button disabled={busy || !ready} onClick={() => void create()}>
          {busy ? 'Wird angelegt …' : 'Anlegen'}
        </button>
        <button className="secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </>
  );
}

/**
 * Der öffentliche Teil, nach dem Anlegen.
 *
 * Er ist die eine Hälfte der Einrichtung, die Unikom nicht selbst erledigen
 * kann: Diese Zeile muss in die `authorized_keys` des Quellservers, und das tut
 * der, dem der Server gehört. Deshalb steht sie hier zum Mitnehmen, statt still
 * in der Datenbank zu liegen — nachschlagen lässt sie sich später im Workflow,
 * neben dem gewählten Zugang.
 */
function KeyHandover({
  name,
  publicKey,
  problem,
  onDone,
}: {
  name: string;
  publicKey?: string;
  problem?: string;
  onDone(): void;
}) {
  return (
    <>
      <h2>„{name}" ist angelegt</h2>

      <PublicKeyPanel publicKey={publicKey} problem={problem} />

      <div className="row" style={{ marginTop: '1.2rem' }}>
        <button onClick={onDone}>Fertig</button>
      </div>
    </>
  );
}

/**
 * Die Zeile für die `authorized_keys` des Quellservers.
 *
 * Eigenständig, weil sie an zwei Stellen gebraucht wird: gleich nach dem
 * Anlegen, und später im Workflow beim Nachsehen. Es gibt keine dritte Stelle —
 * eine Verwaltung unter Einstellungen wäre die Liste, in der die alten Einträge
 * liegen bleiben.
 */
export function PublicKeyPanel({ publicKey, problem }: { publicKey?: string; problem?: string }) {
  const [copied, setCopied] = useState(false);

  if (problem) {
    return <Notice kind="warn">{problem}</Notice>;
  }

  return (
    <>
      <div className="prose">
        <p>
          Damit die Anmeldung funktioniert, muss diese Zeile beim Betreiber des Quellservers in die Datei{' '}
          <strong>authorized_keys</strong> des SFTP-Benutzers eingetragen werden. Sie ist der öffentliche Teil
          und darf offen verschickt werden.
        </p>
      </div>

      <Field label="Öffentlicher Schlüssel">
        <textarea readOnly rows={4} spellCheck={false} value={publicKey ?? ''} />
      </Field>

      <div className="row">
        <button
          className="secondary"
          onClick={() => void navigator.clipboard.writeText(publicKey ?? '').then(() => setCopied(true))}
        >
          {copied ? 'Kopiert' : 'In die Zwischenablage'}
        </button>
      </div>
    </>
  );
}
