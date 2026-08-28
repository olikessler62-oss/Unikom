import { useLanguage } from '../i18n/useText.js';
import { LANGUAGES, type Language } from '../settings/preferences.js';

/**
 * Die Sprache, oben rechts im Kopfband.
 *
 * Sie stand einmal in den Einstellungen, als Kachelreihe neben der Wahl des
 * Erscheinungsbilds. Dort ist sie falsch aufgehoben: Wer die Sprache sucht,
 * sucht sie nicht in einem Bildschirm, den nur Verwalter öffnen dürfen — er
 * sucht sie da, wo sie in jeder anderen Anwendung steht, nämlich oben rechts.
 * Und wer sie braucht, versteht die Beschriftung des Menüpunkts, unter dem sie
 * bisher lag, womöglich gerade nicht.
 *
 * Ein Auswahlfeld und keine Kachelreihe: Im Band ist kein Platz für drei
 * Kacheln nebeneinander, und die Wahl fällt einmal und dann lange nicht wieder.
 *
 * Die Wirkung tritt sofort ein — es gibt nichts zu speichern, was man vergessen
 * könnte. Gemerkt wird sie im Browser; das entscheidet `preferences`.
 */
export function Sprachwahl() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <label className="sprachwahl">
      <select
        value={language}
        aria-label={t('settings.language')}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {LANGUAGES.map((entry) => (
          <option key={entry} value={entry}>
            {t(`settings.language.${entry}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
