import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLGEMEIN,
  effektiveEinstellungen,
  einstellungenDesMandanten,
  wirksameEinstellungen,
} from './Einstellungen.js';

test('der Mandant gewinnt vor dem Profil, das Profil vor dem Allgemeinen', () => {
  // Das Beispiel aus SPEC-02, Abschnitt 41, Wort für Wort.
  const effektiv = effektiveEinstellungen({ locale: 'en-US' }, { locale: 'fr-FR' });

  assert.equal(effektiv.locale.wert, 'en-US');
  assert.equal(effektiv.locale.ebene, 'MANDANT');
  assert.deepEqual(effektiv.locale.ebenen, [
    { ebene: 'ALLGEMEIN', wert: 'de-DE' },
    { ebene: 'PROFIL', wert: 'fr-FR' },
    { ebene: 'MANDANT', wert: 'en-US' },
  ]);
});

test('was überstimmt wurde, bleibt sichtbar', () => {
  // Wer „en-US" liest und „fr-FR" eingestellt hat, sucht sonst den Fehler im
  // Profil — und dort ist er nicht.
  const effektiv = effektiveEinstellungen({ locale: 'en-US' }, { locale: 'fr-FR' });

  assert.ok(
    effektiv.locale.ebenen.some((eintrag) => eintrag.ebene === 'PROFIL' && eintrag.wert === 'fr-FR'),
    'die überstimmte Ebene steht weiterhin in der Auskunft'
  );
});

test('ein Profil darf das Allgemeine überschreiben', () => {
  const effektiv = effektiveEinstellungen(undefined, { jahrhundertGrenze: 30 });

  assert.equal(effektiv.jahrhundertGrenze.wert, 30);
  assert.equal(effektiv.jahrhundertGrenze.ebene, 'PROFIL');
});

test('ohne jede Einstellung gilt, was Unikom mitbringt', () => {
  const effektiv = effektiveEinstellungen(undefined, undefined);

  assert.equal(effektiv.locale.ebene, 'ALLGEMEIN');
  assert.deepEqual(wirksameEinstellungen(undefined, undefined), ALLGEMEIN);
});

test('jede Einstellung hat am Ende einen Wert', () => {
  // Eine Vererbung, die ein Feld offen lässt, verschiebt die Entscheidung an
  // die Stelle, die es später liest — und dort steht dann ein zweiter,
  // abweichender Vorgabewert.
  const wirksam = wirksameEinstellungen({ stichprobe: 250 }, undefined);

  for (const [name, wert] of Object.entries(wirksam)) {
    assert.notEqual(wert, undefined, `${name} ist offen geblieben`);
  }

  assert.equal(wirksam.stichprobe, 250);
});

test('die Region des Mandanten ist seine Einstellung, nicht eine zweite', () => {
  const einstellungen = einstellungenDesMandanten({
    region: { locale: 'fr-CH', timeZone: 'Europe/Zurich' },
    consolidation: { stichprobe: 200 },
  });

  assert.deepEqual(einstellungen, { locale: 'fr-CH', timeZone: 'Europe/Zurich', stichprobe: 200 });
});

test('ein Mandant ohne Region überstimmt kein Profil', () => {
  // Der Fehler, den diese Prüfung abfängt: Ein `locale: undefined` sähe für
  // die Vererbung aus wie eine Wahl des Mandanten und schlüge das Profil.
  const einstellungen = einstellungenDesMandanten({});
  const effektiv = effektiveEinstellungen(einstellungen, { locale: 'fr-FR' });

  assert.equal(effektiv.locale.wert, 'fr-FR');
  assert.equal(effektiv.locale.ebene, 'PROFIL');
});
