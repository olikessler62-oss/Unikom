import { useEffect, useRef } from 'react';

/**
 * Eine offene Auswahlliste schließt sich, wenn der Mauszeiger fortgeht.
 *
 * ```text
 * ┌─────────────┐
 * │ Deutschland │ ← das geschlossene Feld
 * ├─────────────┤
 * │ Belgien     │
 * │ Dänemark    │   die offene Liste
 * │ Frankreich  │
 * └─────────────┘
 *  ← 20 px →      bis hierher passiert nichts
 * ```
 *
 * ## Warum überhaupt
 *
 * Eine aufgeklappte Liste liegt über der Fläche und verdeckt, was darunter
 * steht. Wer sie geöffnet hat und dann woanders hinsieht, muss sie sonst erst
 * wegklicken — und ein Klick daneben ist beim ersten Mal ein Klick auf etwas
 * anderes. Der Zeiger sagt bereits, dass die Liste nicht mehr gebraucht wird.
 *
 * ## Der Rand von zwanzig Pixeln
 *
 * Nicht null: Die Kante ist keine Wand, und wer am Rand der Liste entlangfährt,
 * verlöre sie bei jedem Zittern. Zwanzig Pixel sind eine Handbreit am
 * Bildschirm — weit genug, dass es Absicht war, und nah genug, dass es nicht
 * wie ein Versehen wirkt.
 *
 * Gemessen wird **je Achse** und nicht in der Luftlinie. Ein Zeiger, der
 * seitlich neben der Liste steht, ist fort, auch wenn er auf ihrer Höhe
 * geblieben ist; die Luftlinie ließe eine schräge Ecke zu, in der die Liste
 * stehen bliebe, obwohl der Zeiger längst woanders ist.
 *
 * ## Warum die Tastatur davon nichts merken sollte — und doch merkt
 *
 * Wer die Liste mit der Tastatur öffnet, hat den Zeiger irgendwo stehen, und
 * die erste Mausbewegung schließt sie. Das ist die Kehrseite einer Regel, die
 * am Zeiger hängt; sie greift aber nur bei **Bewegung**. Eine ruhende Maus
 * schließt nichts, und wer mit der Tastatur arbeitet, bewegt sie nicht.
 */
export const ABSTAND = 20;

export interface Rechteck {
  links: number;
  oben: number;
  rechts: number;
  unten: number;
}

/**
 * Ob der Zeiger weit genug fort ist.
 *
 * Je Achse, nicht in der Luftlinie — siehe oben.
 */
export function zuWeitFort(rahmen: Rechteck, zeiger: { x: number; y: number }, abstand = ABSTAND): boolean {
  return (
    zeiger.x < rahmen.links - abstand ||
    zeiger.x > rahmen.rechts + abstand ||
    zeiger.y < rahmen.oben - abstand ||
    zeiger.y > rahmen.unten + abstand
  );
}

/** Der kleinste Rahmen, der alle diese Rechtecke enthält. */
export function umschliesst(teile: readonly Rechteck[]): Rechteck | undefined {
  if (teile.length === 0) {
    return undefined;
  }

  return {
    links: Math.min(...teile.map((teil) => teil.links)),
    oben: Math.min(...teile.map((teil) => teil.oben)),
    rechts: Math.max(...teile.map((teil) => teil.rechts)),
    unten: Math.max(...teile.map((teil) => teil.unten)),
  };
}

/** Ein Rechteck, wie der Browser es angibt — auf unsere Namen gebracht. */
export function alsRechteck(kasten: { left: number; top: number; right: number; bottom: number }): Rechteck {
  return { links: kasten.left, oben: kasten.top, rechts: kasten.right, unten: kasten.bottom };
}

/**
 * Was gemessen werden kann.
 *
 * Nicht `Element`, sondern nur die eine Fähigkeit, auf die es ankommt. So lässt
 * sich die Rechnung prüfen, ohne einen Browser zu starten - und der Prüfling
 * ist dann die Rechnung und nicht die Fähigkeit des Testrahmens, ein Fenster
 * nachzustellen.
 */
export interface Messbar {
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

/**
 * Der Rahmen um mehrere Teile, die zusammen ein Aufklappendes bilden.
 *
 * Teile ohne Ausdehnung fallen heraus. Das ist der Aus-Zustand: Ein Fach, das
 * nicht im Dokument steht, meldet ein Rechteck von null mal null an der Stelle
 * 0,0 - nähme man es mit, spannte sich der Rahmen bis in die linke obere Ecke
 * des Bildschirms, und der Zeiger wäre nie weit genug fort.
 */
export function rahmenUm(teile: readonly (Messbar | null | undefined)[]): Rechteck | undefined {
  const kaesten = teile
    .filter((teil): teil is Messbar => teil !== null && teil !== undefined)
    .map((teil) => teil.getBoundingClientRect())
    .filter((kasten) => kasten.width > 0 && kasten.height > 0)
    .map(alsRechteck);

  return umschliesst(kaesten);
}

/**
 * Wie viel Platz ein offenes Auswahlfeld einnimmt: Feld **und** Liste.
 *
 * Die Liste ist ein Pseudo-Element (`::picker(select)`) und lässt sich nicht
 * messen. Ihre Einträge dagegen sind gewöhnliche `option`-Elemente mit eigener
 * Geometrie — und der Rahmen um sie herum ist die Liste. Ein leerer Rahmen
 * (kein Eintrag hat Ausdehnung) heißt: geschlossen, und dann gibt es nichts zu
 * schließen.
 *
 * Das geschlossene Feld gehört mit dazu. Ohne es läge die Grenze mitten auf dem
 * Feld, sobald die Liste nach unten aufklappt, und ein Zeiger auf dem Feld
 * selbst schlösse die Liste, die er gerade geöffnet hat.
 */
export function rahmenVon(feld: HTMLSelectElement): Rechteck | undefined {
  return rahmenUm([feld, ...feld.querySelectorAll('option')]);
}

/**
 * Ob dieser Browser sagen kann, welche Liste offen ist.
 *
 * `:open` an einem Auswahlfeld gibt es erst mit dem neuen Bauteil. Wo es fehlt,
 * wirft `querySelector` — und eine Regel, die bei jeder Mausbewegung wirft,
 * legt die Oberfläche lahm. Gefragt wird deshalb einmal.
 */
function kannOffeneFinden(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports?.('selector(select:open)') === true;
}

/**
 * Installiert die Regel für die ganze Anwendung.
 *
 * An einer Stelle und nicht an jedem Auswahlfeld: Es ist eine Regel über
 * Auswahlfelder und keine Eigenschaft eines einzelnen. Wer ein neues Feld
 * einbaut, soll nichts anhängen müssen — sonst gilt sie für neunzehn von zwanzig.
 */
export function useAuswahlschliesser(abstand = ABSTAND): void {
  useEffect(() => {
    if (!kannOffeneFinden()) {
      return;
    }

    const bewegt = (ereignis: PointerEvent): void => {
      const offen = document.querySelector('select:open');

      if (!(offen instanceof HTMLSelectElement)) {
        return;
      }

      const rahmen = rahmenVon(offen);

      if (rahmen && zuWeitFort(rahmen, { x: ereignis.clientX, y: ereignis.clientY }, abstand)) {
        /*
         * Es gibt keinen Weg, eine Auswahlliste zu schließen — nur einen, ihr
         * den Anlass zu nehmen. Das Bauteil schließt sich, wenn es den Fokus
         * verliert.
         */
        offen.blur();
      }
    };

    document.addEventListener('pointermove', bewegt);

    return () => document.removeEventListener('pointermove', bewegt);
  }, [abstand]);
}

/**
 * Dieselbe Regel für alles andere, was aufklappt.
 *
 * Fächer, Kontextmenüs, Vorschlagslisten - alles, was über der Fläche hängt und
 * verdeckt, was darunter steht. Der Zeiger sagt bereits, dass es nicht mehr
 * gebraucht wird; ein Klick daneben wäre beim ersten Mal ein Klick auf etwas
 * anderes.
 *
 * ## Warum mehrere Teile und nicht das Fach allein
 *
 * Ein Fach hängt an einem Knopf, und der Knopf gehört dazu. Sonst läge die
 * Grenze mitten auf ihm, sobald das Fach darunter aufklappt - und der Zeiger,
 * der noch auf dem Knopf steht, schlösse, was er gerade geöffnet hat.
 *
 * Der Rahmen wird bei **jeder Bewegung** neu gemessen und nicht einmal beim
 * Öffnen. Ein Fach wächst, während man es benutzt: Ein Abschnitt klappt auf,
 * eine Zeile kommt hinzu. Ein Rahmen von vorhin schlösse es dann, obwohl der
 * Zeiger noch darin steht.
 *
 * ## Was hier **nicht** hineingehört
 *
 * Alles, worin etwas Ungesichertes steht. Das Memo an einem Feld sieht aus wie
 * ein Fach, hält aber einen Entwurf und hat OK und Abbrechen - eine Regel, die
 * am Zeiger hängt, würde dort Tippen verwerfen. Was der Benutzer geschrieben
 * hat, verschwindet nicht, weil er die Maus bewegt.
 */
export function useSchliesstBeiAbstand(
  offen: boolean,
  schliessen: () => void,
  teile: readonly { readonly current: Messbar | null }[],
  abstand = ABSTAND,
): void {
  /*
   * Beide Angaben liegen in einer Ref, und der Effekt hängt nur am Zustand.
   *
   * Sonst hinge er an einer Funktion und einem Feld, die beide bei jedem
   * Rendern neu entstehen - der Zuhörer würde dutzendfach ab- und wieder
   * angemeldet, für nichts. Refs bleiben dieselben; nur ihr Inhalt wechselt.
   */
  const stand = useRef({ schliessen, teile });

  stand.current = { schliessen, teile };

  useEffect(() => {
    if (!offen) {
      return;
    }

    const bewegt = (ereignis: PointerEvent): void => {
      const rahmen = rahmenUm(stand.current.teile.map((teil) => teil.current));

      if (rahmen && zuWeitFort(rahmen, { x: ereignis.clientX, y: ereignis.clientY }, abstand)) {
        stand.current.schliessen();
      }
    };

    document.addEventListener('pointermove', bewegt);

    return () => document.removeEventListener('pointermove', bewegt);
  }, [offen, abstand]);
}
