import { useState } from 'react';

import { ConflictScreen } from './ConflictScreen.js';
import { ResultScreen } from './ResultScreen.js';
import { Reiter } from '../components/Pieces.js';

/**
 * Der Bereich „Daten konsolidieren" — das, was davon täglich zu tun ist.
 *
 * ## Was hier stand und warum es fort ist
 *
 * Er hatte einmal sechs Reiter: Daten finden, Zuordnungen, Referenzen,
 * Zusammenführen, Konflikte, Ergebnis. Vier davon sind **Einrichtung** — man
 * macht sie einmal, wenn ein Kunde dazukommt: beschreiben, was er liefert,
 * festlegen, wohin die Felder gehören, Referenzlisten hinterlegen, einmal zur
 * Probe rechnen lassen. Alle vier fragten als Erstes „für welchen Kunden?", und
 * genau das war der Hinweis: Sie stehen jetzt als Reiter beim Mandanten.
 *
 * ## Was geblieben ist
 *
 * Zwei Bildschirme, und beide sind Arbeit von heute:
 *
 * ```text
 * Konflikte   ein Fall entsteht nachts, ein Mensch entscheidet ihn morgens
 * Freigaben   darf dieses Ergebnis hinaus?
 * ```
 *
 * Sie tragen ihre Mandantenwahl weiter — aber als **Filter** und nicht als
 * Identität. Wer acht Kunden betreut, arbeitet morgens eine Liste ab und will
 * dafür nicht achtmal einen Kunden aussuchen müssen. Deshalb stehen sie hier
 * und nicht beim Mandanten: Ein offener Konflikt ist keine Einstellung.
 *
 * ## Warum sie unter einem Punkt bleiben
 *
 * Weil sie zusammen das Modul sind, das man kauft. Zwei Menüpunkte für zwei
 * Bildschirme desselben Moduls wären wieder das, was hier schon einmal stand:
 * dasselbe Ding, mehrfach im Menü.
 */
type Teil = 'konflikte' | 'ergebnis';

const TEILE: readonly { id: Teil; text: string }[] = [
  { id: 'konflikte', text: 'Konflikte' },
  { id: 'ergebnis', text: 'Freigaben' },
];

export function ConsolidationScreen() {
  const [teil, setTeil] = useState<Teil>('konflikte');

  return (
    <>
      <Reiter<Teil> stil="pille" reiter={TEILE} offen={teil} onOeffnen={setTeil} />

      {teil === 'konflikte' && <ConflictScreen />}
      {teil === 'ergebnis' && <ResultScreen />}
    </>
  );
}
