import { useState } from 'react';

import { DiscoveryScreen } from './DiscoveryScreen.js';
import { MappingScreen } from './MappingScreen.js';
import { ConflictScreen } from './ConflictScreen.js';
import { MergeScreen } from './MergeScreen.js';
import { ReferenceScreen } from './ReferenceScreen.js';
import { ResultScreen } from './ResultScreen.js';

/**
 * Der Bereich „Daten konsolidieren".
 *
 * Er ist das Modul, nicht eine seiner Funktionen. „Daten finden" und
 * „Zuordnungen" standen eine Weile als eigene Menüpunkte daneben — und damit
 * stand im Menü dreimal dasselbe Modul, ohne dass zu sehen war, dass es
 * zusammengehört. Wer die Konsolidierung nicht gekauft hat, soll einen Punkt
 * vermissen und nicht drei.
 *
 * Die Teile stehen als Reiter darin. Die Reihenfolge ist die der Arbeit:
 * erst sehen, was in den Daten steckt, dann festlegen, wohin es gehört. Was
 * mit den Etappen dazukommt — Konflikte, Referenzdaten, die Freigabe — reiht
 * sich hier ein und bekommt keinen eigenen Menüpunkt.
 */
type Teil = 'finden' | 'zuordnen' | 'referenzen' | 'zusammenfuehren' | 'konflikte' | 'ergebnis';

const TEILE: { id: Teil; label: string }[] = [
  { id: 'finden', label: 'Daten finden' },
  { id: 'zuordnen', label: 'Zuordnungen' },
  { id: 'referenzen', label: 'Referenzen' },
  { id: 'zusammenfuehren', label: 'Zusammenführen' },
  { id: 'konflikte', label: 'Konflikte' },
  { id: 'ergebnis', label: 'Ergebnis' },
];

export function ConsolidationScreen() {
  const [teil, setTeil] = useState<Teil>('finden');

  return (
    <>
      <div className="subnav">
        {TEILE.map((eintrag) => (
          <button
            key={eintrag.id}
            className={teil === eintrag.id ? 'subnav__tab subnav__tab--active' : 'subnav__tab'}
            onClick={() => setTeil(eintrag.id)}
          >
            {eintrag.label}
          </button>
        ))}
      </div>

      {teil === 'finden' && <DiscoveryScreen />}
      {teil === 'zuordnen' && <MappingScreen />}
      {teil === 'referenzen' && <ReferenceScreen />}
      {teil === 'zusammenfuehren' && <MergeScreen />}
      {teil === 'konflikte' && <ConflictScreen />}
      {teil === 'ergebnis' && <ResultScreen />}
    </>
  );
}
