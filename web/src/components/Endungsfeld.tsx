import { useState, type ReactNode } from 'react';

import { Field, FieldButton, ListIcon, WF_Modal, listentasten } from './Pieces.js';

/**
 * Ein Feld für Dateiendungen — mit einer Liste zum Anhaken daneben.
 *
 * ## Warum ein eigenes Bedienelement
 *
 * Es steht inzwischen an drei Stellen: welche Dateitypen eine Übertragung
 * übernimmt, welche Endungen unfertige Uploads tragen, und welche Typen ein
 * Konsolidierungsdurchgang aus seinem Abholverzeichnis nimmt. Dreimal
 * dasselbe Fenster nachzubauen hieße, jede spätere Änderung dreimal zu
 * machen — und die dritte Stelle dabei zu vergessen.
 *
 * ## Das Komma trennt, und Leerzeichen auch
 *
 * `csv, xml` und `csv xml` sind dieselbe Angabe. In einer Dateiendung hat
 * beides nichts verloren, also ist beides als Trenner frei.
 *
 * ## Die Liste ist eine Abkürzung, keine Schranke
 *
 * Getippt werden darf weiterhin, was nicht angeboten wird. Kein Kunde der Welt
 * lässt sich seine Hausendung ausreden — und ein Fenster, das nur zehn Werte
 * kennt, wäre an der ersten Stelle im Weg, an der es darauf ankommt.
 */
export function Endungsfeld({
  label,
  explain,
  platzhalter,
  vorschlaege,
  werte,
  onChange,
}: {
  label: string;
  explain?: ReactNode;
  platzhalter?: string;
  /** Was die Liste anbietet — die häufigen Fälle, nicht die erlaubten. */
  vorschlaege: readonly string[];
  werte: string[];
  onChange(next: string[]): void;
}) {
  const [offen, setOffen] = useState(false);

  return (
    <>
      <Field
        label={label}
        explain={explain}
        action={
          <FieldButton title={`${label} aussuchen`} onClick={() => setOffen(true)}>
            <ListIcon />
          </FieldButton>
        }
      >
        <input
          value={werte.join(', ')}
          placeholder={platzhalter}
          spellCheck={false}
          onChange={(event) => onChange(alsListe(event.target.value))}
        />
      </Field>

      {/*
        * Das Häkchen wirkt sofort auf das Feld, ohne „Übernehmen": Es gibt
        * nichts zu bestätigen — man sieht die Endung im Feld erscheinen und
        * verschwinden, und ein zweites Anklicken nimmt sie zurück. Ein
        * Bestätigungsknopf wäre ein Schritt, der nichts entscheidet.
        */}
      {offen && (
        <WF_Modal schmal title={label} onClose={() => setOffen(false)}>
          {/*
            * Die Pfeiltasten bewegen den Fokus, nicht die Seite. Eine Liste,
            * die nur mit der Maus zu bedienen ist, zwingt zum Wechseln der
            * Hand — und wer die Tabulatortaste benutzt, springt sonst durch
            * jede einzelne Zeile bis zum Schließen-Knopf.
            */}
          <ul className="browse pick" onKeyDown={listentasten}>
            {vorschlaege.map((endung) => {
              const gewaehlt = werte.some((eintrag) => gleicheEndung(eintrag, endung));

              return (
                <li key={endung}>
                  <button
                    type="button"
                    className={gewaehlt ? 'pick__row pick__row--an' : 'pick__row'}
                    aria-pressed={gewaehlt}
                    onClick={() =>
                      onChange(
                        gewaehlt
                          ? werte.filter((eintrag) => !gleicheEndung(eintrag, endung))
                          : [...werte, endung]
                      )
                    }
                  >
                    <span className="pick__mark">{gewaehlt ? '✓' : ''}</span>
                    <span className="pick__ext">{endung}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </WF_Modal>
      )}
    </>
  );
}

/** Ein Eingabefeld in seine Endungen zerlegt — Komma und Leerzeichen trennen. */
export function alsListe(wert: string): string[] {
  return wert
    .split(/[,\s]+/)
    .map((eintrag) => eintrag.trim())
    .filter((eintrag) => eintrag.length > 0);
}

/**
 * Vergleicht Endungen so, wie ein Anwender sie meint.
 *
 * `csv`, `.csv` und `.CSV` sind dieselbe Endung. Ohne diesen Vergleich stünde
 * eine Endung zweimal im Feld, sobald jemand sie erst tippt und dann anhakt —
 * und das Häkchen wäre bei einer schon eingetragenen Endung nicht gesetzt.
 */
export function gleicheEndung(links: string, rechts: string): boolean {
  const bloss = (wert: string): string => wert.trim().replace(/^\.+/, '').toLowerCase();

  return bloss(links) === bloss(rechts);
}
