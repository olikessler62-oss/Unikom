import { Auswahlfeld } from './Auswahlfeld.js';
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

  /*
   * Das Auswahlfeld steht für sich, ohne Hülle.
   *
   * Es stand einmal in einem `<label>`. Das war gedacht als bloße Klammer für
   * die Klasse - aber ein `<label>` ist in dieser Oberfläche ein Bauteil mit
   * eigenem Aussehen: eine kleine helle Fläche mit Rahmen und runder Ecke, auf
   * der sonst die Feldbeschriftung in Versalien steht. Hier stand keine drin,
   * und so saß das Feld in einem leeren Kästchen.
   *
   * Es fehlt dabei nichts: Der Name des Feldes kommt aus `aria-label`. Ein
   * `<label>` ohne Text hätte ohnehin keinen beigesteuert.
   */
  return (
    <Auswahlfeld
      className="sprachwahl"
      value={language}
      aria-label={t('settings.language')}
      onChange={(event) => setLanguage(event.target.value as Language)}
    >
      {LANGUAGES.map((entry) => (
        <option key={entry} value={entry}>
          {t(`settings.language.${entry}`)}
        </option>
      ))}
    </Auswahlfeld>
  );
}
