import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Ein Fenster, das unter der Seitenleiste hervorfährt (FR-011 §9).
 *
 * ## Warum es hervorfährt und nicht aufblendet
 *
 * Es kommt aus dem Menü, und das Menü steht links. Ein Fenster, das in der
 * Mitte erscheint, hat keinen Ort; eines, das unter der Leiste hervorkommt,
 * zeigt, woher es stammt - und wohin es wieder verschwindet.
 *
 * Sein Rang liegt deshalb **unter** der Seitenleiste und **über** dem Kopfband:
 * Während es fährt, liegt es hinter der Leiste, und am Ziel deckt es das Band
 * zu. Läge es über der Leiste, schöbe es sich über das Menü und käme aus dem
 * Nichts; läge es unter dem Band, stünde sein eigener Kopf dahinter.
 *
 * ## Warum es sein Verschwinden selbst zu Ende bringt
 *
 * Wer es schließt, will es hinausfahren sehen. Nähme die Anwendung es sofort
 * aus dem Dokument, wäre es einfach fort. Deshalb schaltet das Bauteil erst
 * seinen Zustand um, wartet die Bewegung ab und meldet dann nach oben, dass es
 * gehen kann.
 */

/** Wie lange es fährt - dieselbe Zahl steht im Erscheinungsbild. */
const FAHRZEIT_MS = 260;

interface Props {
  titel: string;
  /** Eine Zeile unter dem Titel: was hier zu tun ist, nicht was es ist. */
  unterzeile?: string;
  /** Der Hinweis über der Knopfleiste. */
  hinweis?: string;
  onSchliessen(): void;
  children: ReactNode;
}

export function Schiebefenster({ titel, unterzeile, hinweis, onSchliessen, children }: Props) {
  /**
   * Ob es an seinem Platz steht.
   *
   * Beim ersten Bild steht es noch draußen - sonst gäbe es nichts zu fahren:
   * Ein Element, das gleich am Ziel eingesetzt wird, hat keinen Weg, über den
   * ein Übergang laufen könnte.
   */
  const [drin, setDrin] = useState(false);
  const geht = useRef(false);

  useEffect(() => {
    const bild = requestAnimationFrame(() => setDrin(true));

    return () => cancelAnimationFrame(bild);
  }, []);

  function schliesse(): void {
    if (geht.current) {
      return;
    }

    geht.current = true;
    setDrin(false);
    window.setTimeout(onSchliessen, FAHRZEIT_MS);
  }

  /*
   * Kein Portal.
   *
   * Es lag zuerst am Ende des Dokuments, wie die Spec es für Fenster verlangt.
   * Damit war sein Rang aber wertlos: Die Shell macht mit `isolate` eine eigene
   * Ebene auf, und alles darin - auch die Seitenleiste mit ihrem hohen Rang -
   * liegt zusammen auf deren Höhe. Ein Element daneben mit irgendeinem Rang
   * darüber liegt über allem. Das Fenster fuhr über die Leiste statt darunter.
   *
   * Es steht deshalb in der Shell, wo sein Rang mit dem der Leiste und dem des
   * Bandes verglichen wird. `position: fixed` bleibt davon unberührt - kein
   * Vorfahre trägt eine Verschiebung, die daraus etwas anderes machte.
   */
  return (
    <aside
      className={drin ? 'schiebefenster schiebefenster--drin' : 'schiebefenster'}
      role="dialog"
      aria-label={titel}
      onKeyDown={(ereignis) => {
        if (ereignis.key === 'Escape') {
          ereignis.stopPropagation();
          schliesse();
        }
      }}
    >
      <header className="schiebefenster__kopf">
        <div className="schiebefenster__titelblock">
          <h2 className="schiebefenster__titel">{titel}</h2>
          {unterzeile && <p className="schiebefenster__unterzeile">{unterzeile}</p>}
        </div>

        <button type="button" className="schiebefenster__schliessen" aria-label="Schließen" onClick={schliesse}>
          <KreuzStrich />
        </button>
      </header>

      {/*
        * Hinweis und Knopfleiste stehen **im** Körper, nicht darunter.
        *
        * Sie waren einmal am unteren Rand festgemacht, wie es ein Fenster
        * gewohnt ist. Bei einer kurzen Liste stand die Knopfleiste dann allein
        * am Fuß, durch eine handbreite Leere von dem getrennt, worauf sie sich
        * bezieht. Jetzt folgen sie der Liste in gleichbleibendem Abstand und
        * wandern mit ihr nach unten, wenn sie wächst.
        */}
      <div className="schiebefenster__koerper">
        {children}

        {hinweis && <p className="schiebefenster__hinweis">{hinweis}</p>}

        <footer className="schiebefenster__fuss">
          <span className="schiebefenster__luecke" />
          <button type="button" onClick={schliesse}>
            <KreuzStrich />
            Schließen
          </button>
        </footer>
      </div>
    </aside>
  );
}

/** Das Kreuz - als Strichzeichnung und nicht als Buchstabe „x". */
function KreuzStrich() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="kreuzstrich icon--strich">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

interface PanelProps {
  titel: string;
  /** Was rechts im Kopf des Panels steht - meist ein Auswahlfeld. */
  kopfrechts?: ReactNode;
  /** Die Knopfleiste unter der Liste. */
  werkzeuge?: ReactNode;
  children: ReactNode;
}

/**
 * Die Fläche mit Kopf, Liste und Werkzeugleiste (FR-011 §8).
 *
 * Getrennt vom Fenster, weil es zwei verschiedene Dinge sind: Das Fenster sagt,
 * worum es geht und wie man wieder hinauskommt; das Panel zeigt eine Menge und
 * was man mit einem Stück daraus tun kann. In einem Fenster können mehrere
 * davon stehen.
 */
export function Listenpanel({ titel, kopfrechts, werkzeuge, children }: PanelProps) {
  return (
    <section className="listenpanel">
      <div className="listenpanel__kopf">
        <h3 className="listenpanel__titel">{titel}</h3>
        {kopfrechts}
      </div>

      <div className="listenpanel__liste">{children}</div>

      {werkzeuge && <div className="listenpanel__werkzeuge">{werkzeuge}</div>}
    </section>
  );
}
