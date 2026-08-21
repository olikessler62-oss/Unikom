import { useState, type ReactNode } from 'react';

import { api } from '../api/client.js';
import { messageOf, useResource } from '../api/useResource.js';
import type { Feature, Licence, LicenceState } from '../api/types.js';
import { Field, Loading, Notice } from '../components/Pieces.js';
import { useLanguage } from '../i18n/useText.js';
import {
  LANGUAGES,
  saveTheme,
  storedTheme,
  THEMES,
  type Theme,
} from '../settings/preferences.js';
import { locale } from '../i18n/texts.js';

const FEATURE_LABELS: Record<Feature, string> = {
  TRANSFER: 'Daten übertragen',
  REMOTE_SOURCES: 'Entfernte Quellen (SFTP, FTPS)',
  ENCRYPTION: 'Verschlüsselte Ablage',
  CONSOLIDATION: 'Daten konsolidieren',
  CONVERSION: 'Daten konvertieren',
  DATA_IMPORT: 'Daten importieren',
};

const STATE_LABELS: Record<LicenceState, { text: string; tone: 'good' | 'warn' | 'bad' | 'muted' }> = {
  ACTIVE: { text: 'Gültig', tone: 'good' },
  EXPIRING: { text: 'Läuft bald ab', tone: 'warn' },
  EXPIRED: { text: 'Abgelaufen', tone: 'bad' },
  MISSING: { text: 'Keine Lizenz', tone: 'bad' },
  INVALID: { text: 'Ungültig', tone: 'bad' },
  UNLICENSED: { text: 'Ohne Lizenzprüfung', tone: 'muted' },
};

interface Props {
  /** Einspielen darf nur, wer die Installation verwaltet. */
  canManage: boolean;
  /** Nach dem Einspielen gilt ein neuer Zeitraum — die Sitzung holt ihn nach. */
  onLicenceChanged(): void;
}

export function SettingsScreen({ canManage, onLicenceChanged }: Props) {
  const licence = useResource<Licence>('/api/licence');
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  async function install(): Promise<void> {
    setBusy(true);
    setMessage(undefined);

    try {
      await api.post('/api/licence', { licence: text });
      setText('');
      await licence.reload();
      onLicenceChanged();
      setMessage({ kind: 'info', text: 'Die Lizenz wurde übernommen.' });
    } catch (error) {
      // Der Server sagt genau, woran es lag — Signatur, Format oder Zeitraum.
      setMessage({ kind: 'error', text: messageOf(error, 'Die Lizenz konnte nicht übernommen werden') });
    } finally {
      setBusy(false);
    }
  }

  if (licence.error) {
    return <Notice kind="error">{licence.error}</Notice>;
  }

  if (!licence.data) {
    return <Loading />;
  }

  const status = licence.data;
  const label = STATE_LABELS[status.state] ?? { text: status.state, tone: 'muted' as const };

  return (
    <>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <AppearanceCard />

      <section className="card">
        <h2>Lizenz</h2>

        <div className="prose">
          <p>
            <span className={`badge badge--${label.tone}`}>{label.text}</span>
          </p>
        </div>

        {status.problem && (
          <Notice kind={status.mayRun ? 'warn' : 'error'}>{status.problem}</Notice>
        )}

        {status.state === 'UNLICENSED' ? (
          <div className="prose">
            <p>
              Diese Installation prüft keinen Zeitraum. Sie läuft mit allen Modulen — der Zustand einer
              Entwicklungs- oder Demo-Installation.
            </p>
          </div>
        ) : (
          <div>
            <Line label="Kunde">{status.customer ?? '—'}</Line>
            <Line label="Bezahlt bis">{formatDay(status.validUntil)}</Line>
            <Line label="Verbleibend">
              {status.daysRemaining === undefined
                ? '—'
                : status.daysRemaining >= 0
                  ? `${status.daysRemaining} Tage`
                  : `seit ${Math.abs(status.daysRemaining)} Tagen abgelaufen`}
            </Line>
            <Line label="Übertragungen">{status.mayRun ? 'laufen' : 'gestoppt'}</Line>
            <Line label="Lizenznummer">{status.licenceId ?? '—'}</Line>
            <Line label="Module">
              {status.features && status.features.length > 0
                ? status.features.map((feature) => FEATURE_LABELS[feature] ?? feature).join(', ')
                : 'nur Grundprodukt'}
            </Line>
          </div>
        )}
      </section>

      {canManage && status.state !== 'UNLICENSED' && (
        <section className="card">
          <h2>Lizenz einspielen</h2>

          <Field
            label="Lizenztext"
            explain="Eine Zeile, beginnend mit UNIKOM-LICENCE-1. Zeilenumbrüche aus einer E-Mail stören nicht."
          >
            <textarea
              rows={4}
              value={text}
              spellCheck={false}
              placeholder="UNIKOM-LICENCE-1…"
              onChange={(event) => setText(event.target.value)}
            />
          </Field>

          <button disabled={busy || text.trim() === ''} onClick={() => void install()}>
            {busy ? 'Wird geprüft …' : 'Übernehmen'}
          </button>
        </section>
      )}
    </>
  );
}

/** Dieselben Zeilen wie im Impressum: Beschriftung links, Wert rechts. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="legal-line">
      <span className="legal-line__label">{label}</span>
      <span className="legal-line__value">{children}</span>
    </div>
  );
}

function formatDay(iso?: string): string {
  if (!iso) {
    return '—';
  }

  return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Erscheinungsbild und Sprache.
 *
 * Beides sind Kacheln zum Anklicken und keine Auswahlliste: Ein Design wählt
 * man danach, wie es aussieht, und der Unterschied gehört daneben geschrieben,
 * nicht in ein Klappmenü versteckt. Die Wirkung tritt sofort ein — es gibt
 * nichts zu speichern, was man vergessen könnte.
 */
function AppearanceCard() {
  const { language, setLanguage, t } = useLanguage();
  const [theme, setTheme] = useState<Theme>(() => storedTheme());

  function chooseTheme(next: Theme): void {
    saveTheme(next);
    setTheme(next);
  }

  return (
    <section className="card">
      <h2>{t('settings.appearance')}</h2>

      <Field label={t('settings.appearance')}>
        <div className="choices">
          {THEMES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`choice choice--narrow${entry === theme ? ' choice--picked' : ''}`}
              onClick={() => chooseTheme(entry)}
            >
              <span className="choice__name">{t(`settings.theme.${entry}`)}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('settings.language')}>
        <div className="choices">
          {LANGUAGES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`choice choice--narrow${entry === language ? ' choice--picked' : ''}`}
              onClick={() => setLanguage(entry)}
            >
              <span className="choice__name">{t(`settings.language.${entry}`)}</span>
            </button>
          ))}
        </div>
      </Field>
    </section>
  );
}
