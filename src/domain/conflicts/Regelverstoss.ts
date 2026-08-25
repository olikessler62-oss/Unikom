import type { Befund, Datensatz } from '../quality/Regeln.js';
import type { Konfliktfall, Streitfeld } from './Konfliktfall.js';

/**
 * Aus einem Regelverstoß wird ein Konfliktfall (SPEC-07).
 *
 * ## Warum das überhaupt eine Übersetzung braucht
 *
 * Ein Konfliktfall war bisher ein **Wertekonflikt**: Zwei Quellen nennen für
 * denselben Datensatz verschiedene Orte, und ein Mensch entscheidet, welcher
 * gilt. Ein Regelverstoß ist etwas anderes — eine Quelle, ein Wert, und der
 * genügt seiner Regel nicht.
 *
 * Trotzdem derselbe Bestand, und das ist keine Sparsamkeit: Für den Menschen
 * ist es dieselbe Arbeit. Er sieht einen Datensatz, der so nicht durchgeht,
 * und trägt ein, was gelten soll. Zwei Bildschirme für dieselbe Handlung wären
 * zwei Orte, an denen etwas liegen bleibt.
 *
 * ## Ein Fall je Zeile, nicht je Befund
 *
 * Eine Zeile kann gegen drei Regeln verstoßen. Drei Fälle daraus zu machen
 * hieße, denselben Datensatz dreimal vorzulegen — und der Mensch entschiede
 * dreimal über dieselbe Zeile, ohne die anderen beiden zu sehen. Ein Fall,
 * darin ein Streitfeld je beanstandetem Feld: So steht die Zeile einmal da und
 * wird einmal entschieden.
 *
 * ## Der vorgefundene Wert ist ein Angebot
 *
 * Er steht als Angebot der Quelle darin, obwohl er gerade der ist, der nicht
 * genügt. Das ist Absicht: Die Oberfläche zeigt Angebote nebeneinander, und
 * ein Feld ohne jedes Angebot sähe aus, als wäre nichts geliefert worden. Wer
 * ihn übernehmen will, kann es — dann greift die Prüfung erneut, denn die
 * Fachregeln gelten auch für eine Eingabe von Hand (Abschnitt 7).
 */
export interface Regelverstoss {
  /** Die Datei, aus der die Zeile stammt. */
  quelle: string;
  /** Die Zeilennummer der Lieferung — nicht die Stelle in einem Block. */
  zeile: number;
  satz: Datensatz;
  /** Nur die Befunde, die einen Menschen verlangen. */
  befunde: readonly Befund[];
}

/** Was der Bestand noch dazutut: Kennung, Zeitpunkte, Fassung. */
export type Fallentwurf = Omit<Konfliktfall, 'id' | 'entstanden' | 'geaendert' | 'fassung'>;

/** Die Art, unter der solche Fälle gruppiert werden. */
export const REGELVERSTOSS = 'REGELVERSTOSS';

/** Was in der Gegenüberstellung steht, wo gar nichts geliefert wurde. */
export const LEER = '(leer)';

export function fallAus(verstoss: Regelverstoss, kopf: { tenantId: string; laufId: string }): Fallentwurf {
  const felder = streitfelder(verstoss);

  return {
    tenantId: kopf.tenantId,
    laufId: kopf.laufId,
    /*
     * Datei und Zeile, denn etwas Besseres gibt es hier nicht. Ein
     * Wertekonflikt kennt seinen Schlüssel; ein Regelverstoß entsteht auch
     * dort, wo gerade der Schlüssel fehlt.
     */
    datensatz: `„${verstoss.quelle}", Zeile ${verstoss.zeile}`,
    art: REGELVERSTOSS,
    /*
     * Immer „Konflikt" und nie „kritisch". Die Schwere der Regel hat den Fall
     * überhaupt erst hierher gebracht: Was „Fehler" heißt, ist gar nicht zur
     * Entscheidung vorgelegt worden, sondern gescheitert.
     */
    kritikalitaet: 'KONFLIKT',
    status: 'OFFEN',
    ursache: verstoss.befunde.map((befund) => befund.ursache).join('; '),
    regel: namen(verstoss.befunde).join(', ') || undefined,
    erwartet: namen(verstoss.befunde).join('; ') || 'Ein Wert, der die Regel erfüllt',
    vorgefunden: felder
      .map((feld) => `${feld.feld}: ${feld.angebote[0].wert === '' ? LEER : `„${feld.angebote[0].wert}"`}`)
      .join('; '),
    naechsteSchritte:
      felder.length === 1
        ? `„${felder[0].feld}" prüfen und den Wert eintragen, der gelten soll`
        : 'Die beanstandeten Felder prüfen und je Feld den Wert eintragen, der gelten soll',
    quellen: [verstoss.quelle],
    felder,
  };
}

/** Je beanstandetem Feld eines — in der Reihenfolge, in der es auffiel. */
function streitfelder(verstoss: Regelverstoss): Streitfeld[] {
  const felder: Streitfeld[] = [];

  for (const befund of verstoss.befunde) {
    /*
     * Ein Befund ohne Feld gehört zur Zeile als Ganzes. Ihm ein Streitfeld zu
     * geben hieße, einen Namen zu erfinden, unter dem der Mensch etwas
     * einträgt, das nirgends ankommt.
     */
    if (!befund.feld || felder.some((feld) => feld.feld === befund.feld)) {
      continue;
    }

    felder.push({
      feld: befund.feld,
      angebote: [
        {
          quelle: verstoss.quelle,
          wert: befund.wert ?? verstoss.satz.get(befund.feld) ?? '',
          metadaten: {
            Zeile: String(verstoss.zeile),
            ...(befund.regel ? { Regel: befund.regel } : {}),
          },
        },
      ],
    });
  }

  return felder;
}

function namen(befunde: readonly Befund[]): string[] {
  return [...new Set(befunde.map((befund) => befund.regel).filter((name): name is string => Boolean(name)))];
}
