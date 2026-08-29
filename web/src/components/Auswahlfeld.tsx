import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useSchliesstBeiAbstand } from './Auswahlschliesser.js';

/**
 * Ein Auswahlfeld, dessen Liste wir selbst zeichnen.
 *
 * ## Warum nicht `<select>`
 *
 * Weil die Liste eines `<select>` dem Browser gehört und nicht der Anwendung.
 * Zwei Zusagen lassen sich daran nicht einlösen:
 *
 *   1. **Sie schließt sich nicht.** Die Regel „geht der Zeiger eine Handbreit
 *      fort, klappt die Liste zu" braucht einen Weg, sie zuzuklappen. Chrome
 *      hat keinen: `blur()`, Fokus woandershin, `disabled`, `inert` - nichts
 *      schließt das Popup. Gemessen, nicht vermutet.
 *   2. **Ihre Gestalt ist verhandelbar.** Farben und Maße greifen nur, wo der
 *      Browser sie zulässt, und das ist von Browser zu Browser verschieden.
 *
 * Ein eigenes Bauteil hat beides in der Hand: Zuklappen ist ein Zustand, und
 * die Liste ist gewöhnliches Markup.
 *
 * ## Warum es aussieht wie ein `<select>`
 *
 * Die Schnittstelle ist mit Absicht dieselbe: `value`, `onChange` mit einem
 * Ereignis, das `target.value` trägt, und `<option>`-Elemente als Kinder. So
 * ist der Umbau der bestehenden Felder ein Umbenennen und keine Neufassung -
 * und wo sechsundsiebzig Stellen umzustellen sind, ist das der Unterschied
 * zwischen einem Handgriff und sechsundsiebzig Gelegenheiten für einen Fehler.
 */

/** Ein Eintrag der Liste, aus einem `<option>` gelesen. */
export interface Eintrag {
  wert: string;
  text: string;
  deaktiviert: boolean;
}

/**
 * Die Einträge aus den Kindern lesen.
 *
 * `<option>` und sonst nichts. Ein `<optgroup>` gibt es in dieser Anwendung
 * nirgends; käme eins dazu, fiele es hier stillschweigend heraus - deshalb
 * steht es in der Prüfung, damit der Fall auffällt, wenn er eintritt.
 *
 * Der Wert fällt auf den Text zurück, wenn keiner dasteht: Ein `<option>` ohne
 * `value` trägt seinen Text als Wert, und das gilt hier genauso.
 */
export function eintraegeAus(kinder: ReactNode): Eintrag[] {
  const gelesen: Eintrag[] = [];

  for (const kind of Children.toArray(kinder)) {
    if (!isValidElement(kind) || kind.type !== 'option') {
      continue;
    }

    const eigenschaften = kind.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    const text = textAus(eigenschaften.children);

    gelesen.push({
      wert: eigenschaften.value === undefined ? text : String(eigenschaften.value),
      text,
      deaktiviert: eigenschaften.disabled === true,
    });
  }

  return gelesen;
}

/**
 * Der Text eines Eintrags.
 *
 * Meistens eine Zeichenkette, manchmal aus Stücken zusammengesetzt - ein Name,
 * ein Trennzeichen, eine Zahl. Verschachtelte Elemente kommen in einem
 * `<option>` nicht vor; stünde dort eines, bliebe sein Text hier leer.
 */
function textAus(inhalt: ReactNode): string {
  if (inhalt === null || inhalt === undefined || typeof inhalt === 'boolean') {
    return '';
  }

  if (Array.isArray(inhalt)) {
    return inhalt.map(textAus).join('');
  }

  return typeof inhalt === 'object' ? '' : String(inhalt);
}

/** Wo die Liste steht und wie breit sie ist. */
export interface Platz {
  links: number;
  oben: number;
  breite: number;
  hoehe: number;
}

/** Der Abstand zwischen Feld und Liste, und der Rand zum Fensterrand. */
const LUFT = 4;
const RAND = 8;

/**
 * Wohin die Liste gehört.
 *
 * Unter das Feld, solange sie dort ganz hineinpasst; sonst darüber, wenn oben
 * mehr Platz ist. Bleibt sie auch dann zu hoch, wird sie gestutzt und rollt -
 * eine Liste, die unten aus dem Fenster ragt, hat Einträge, die niemand
 * erreicht.
 *
 * Gerechnet und nicht gemessen: Die Entscheidung hängt an vier Zahlen, und die
 * lassen sich prüfen, ohne ein Fenster zu öffnen.
 */
export function platzierung(feld: { left: number; top: number; bottom: number; width: number }, wunsch: number, fensterHoehe: number): Platz {
  const darunter = fensterHoehe - feld.bottom - LUFT - RAND;
  const darueber = feld.top - LUFT - RAND;

  if (wunsch <= darunter || darunter >= darueber) {
    return { links: feld.left, oben: feld.bottom + LUFT, breite: feld.width, hoehe: Math.min(wunsch, Math.max(darunter, 0)) };
  }

  const hoehe = Math.min(wunsch, Math.max(darueber, 0));

  return { links: feld.left, oben: feld.top - LUFT - hoehe, breite: feld.width, hoehe };
}

interface Props {
  value: string;
  onChange(ereignis: { target: { value: string } }): void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  id?: string;
  title?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function Auswahlfeld({ value, onChange, children, className, style, disabled, ...rest }: Props) {
  const eintraege = eintraegeAus(children);
  const gewaehlt = eintraege.find((eintrag) => eintrag.wert === value);

  const [offen, setOffen] = useState(false);
  /**
   * Welcher Eintrag hervorgehoben ist, während die Liste offen steht.
   *
   * Nicht dasselbe wie der eingestellte: Wer mit den Pfeiltasten durch die
   * Liste geht, verschiebt diese Marke, und erst die Eingabetaste macht daraus
   * eine Einstellung. Sonst stünde nach jedem Tastendruck ein anderer Wert im
   * Formular, und Abbrechen gäbe es nicht.
   */
  const [zeiger, setZeiger] = useState(0);
  const [platz, setPlatz] = useState<Platz>();

  const ausloeser = useRef<HTMLButtonElement>(null);
  const fach = useRef<HTMLDivElement>(null);

  const schliesse = useCallback((zurueckZumFeld: boolean): void => {
    setOffen(false);

    if (zurueckZumFeld) {
      ausloeser.current?.focus();
    }
  }, []);

  /*
   * Die Handbreit: Geht der Zeiger fort, klappt die Liste zu - und der Fokus
   * bleibt, wo er ist. Wer mit der Maus woandershin fährt, will nicht, dass ihm
   * das Feld hinterherspringt.
   */
  useSchliesstBeiAbstand(offen, () => schliesse(false), fach, ausloeser);

  /*
   * Beim Aufklappen steht die Marke auf dem eingestellten Eintrag.
   *
   * Ist keiner eingestellt, auf dem ersten. Nicht auf keinem: Die Liste ist
   * dann mit den Pfeiltasten nicht zu erreichen, ohne dass man vorher rät.
   */
  useEffect(() => {
    if (offen) {
      const stelle = eintraege.findIndex((eintrag) => eintrag.wert === value);

      setZeiger(stelle < 0 ? 0 : stelle);
    }
    // Nur beim Wechsel des Zustands - nicht bei jeder Änderung der Liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  /*
   * Die offene Liste nimmt den Fokus.
   *
   * Sonst liefen Pfeiltasten und Eingabetaste ins Leere: Sie hängen an der
   * Liste, und die steht in einem Portal am Ende des Dokuments - dorthin fällt
   * kein Tastendruck von selbst.
   */
  useEffect(() => {
    if (offen) {
      fach.current?.focus();
    }
  }, [offen]);

  /*
   * Die Liste wird erst gemessen und dann gestellt.
   *
   * `useLayoutEffect` und nicht `useEffect`: Dazwischen liegt kein Bild. Mit
   * dem gewöhnlichen Effekt stünde die Liste für einen Bildaufbau an der
   * falschen Stelle, und man sähe sie springen.
   */
  useLayoutEffect(() => {
    if (!offen || !ausloeser.current || !fach.current) {
      return;
    }

    const feld = ausloeser.current.getBoundingClientRect();

    setPlatz(platzierung(feld, fach.current.scrollHeight, window.innerHeight));
  }, [offen, eintraege.length]);

  /*
   * Rollt die Seite oder ändert sich das Fenster, klappt die Liste zu.
   *
   * Sie steht an einer gerechneten Stelle und wandert nicht mit. Mitwandern
   * hieße, bei jedem Rollen neu zu messen und zu stellen - für eine Liste, die
   * ohnehin gleich wieder zugeht. Ein natives Auswahlfeld macht es genauso.
   */
  useEffect(() => {
    if (!offen) {
      return;
    }

    const zu = (): void => schliesse(false);

    window.addEventListener('scroll', zu, true);
    window.addEventListener('resize', zu);

    return () => {
      window.removeEventListener('scroll', zu, true);
      window.removeEventListener('resize', zu);
    };
  }, [offen, schliesse]);

  function waehle(eintrag: Eintrag): void {
    if (eintrag.deaktiviert) {
      return;
    }

    onChange({ target: { value: eintrag.wert } });
    schliesse(true);
  }

  function rueckeAuf(schritt: number): void {
    setZeiger((stand) => {
      const naechster = stand + schritt;

      return naechster < 0 || naechster >= eintraege.length ? stand : naechster;
    });
  }

  function taste(ereignis: KeyboardEvent): void {
    if (ereignis.key === 'Escape') {
      // Escape gehört der Liste, nicht dem Fenster darunter.
      ereignis.stopPropagation();
      ereignis.preventDefault();
      schliesse(true);

      return;
    }

    if (ereignis.key === 'ArrowDown' || ereignis.key === 'ArrowUp') {
      ereignis.preventDefault();

      if (!offen) {
        setOffen(true);
      } else {
        rueckeAuf(ereignis.key === 'ArrowDown' ? 1 : -1);
      }

      return;
    }

    if (ereignis.key === 'Home' || ereignis.key === 'End') {
      ereignis.preventDefault();
      setZeiger(ereignis.key === 'Home' ? 0 : eintraege.length - 1);

      return;
    }

    if (ereignis.key === 'Enter' || ereignis.key === ' ') {
      ereignis.preventDefault();

      if (!offen) {
        setOffen(true);
      } else if (eintraege[zeiger]) {
        waehle(eintraege[zeiger]);
      }

      return;
    }

    if (ereignis.key === 'Tab' && offen) {
      schliesse(false);
    }
  }

  return (
    <>
      <button
        {...rest}
        ref={ausloeser}
        type="button"
        role="combobox"
        aria-expanded={offen}
        aria-haspopup="listbox"
        className={className ? `auswahlfeld ${className}` : 'auswahlfeld'}
        style={style}
        disabled={disabled}
        onClick={() => (offen ? schliesse(false) : setOffen(true))}
        onKeyDown={taste}
      >
        <span className="auswahlfeld__wert">{gewaehlt?.text ?? ''}</span>
        <span className="auswahlfeld__pfeil" aria-hidden="true">
          ▾
        </span>
      </button>

      {offen &&
        createPortal(
          <div
            ref={fach}
            role="listbox"
            tabIndex={-1}
            className="auswahlfeld__liste"
            /*
             * Die Maße stehen am Element und nicht im Erscheinungsbild: Sie
             * werden bei jedem Aufklappen gerechnet. Solange noch nicht
             * gemessen ist, steht die Liste unsichtbar an ihrem Platz - sonst
             * blitzte sie für einen Bildaufbau oben links auf.
             */
            style={
              platz
                ? { left: platz.links, top: platz.oben, minWidth: platz.breite, maxHeight: platz.hoehe }
                : { visibility: 'hidden' }
            }
            onKeyDown={taste}
          >
            {eintraege.map((eintrag, stelle) => (
              <div
                key={eintrag.wert}
                role="option"
                aria-selected={eintrag.wert === value}
                aria-disabled={eintrag.deaktiviert || undefined}
                className={
                  'auswahlfeld__eintrag' +
                  (eintrag.wert === value ? ' auswahlfeld__eintrag--gewaehlt' : '') +
                  (stelle === zeiger ? ' auswahlfeld__eintrag--zeiger' : '')
                }
                onPointerEnter={() => setZeiger(stelle)}
                onClick={() => waehle(eintrag)}
              >
                {eintrag.text}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
