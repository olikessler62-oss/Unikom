import { Notice } from '../components/Pieces.js';

/**
 * Was diese Installation mit personenbezogenen Daten macht — beschrieben aus
 * dem, was die Anwendung tatsächlich tut.
 *
 * Wer der Verantwortliche ist und wie er zu erreichen ist, steht hier
 * absichtlich nicht: Unikom läuft beim Kunden, und der Kunde ist der
 * Verantwortliche. Diese Angaben kommen aus dem Impressum.
 */
export function PrivacyScreen() {
  return (
    <>
      <Notice kind="info">
        Unikom läuft auf dem Server Ihres Unternehmens. Es meldet nichts an den Hersteller und ruft nichts von einem
        fremden Dienst ab — auch keine Schriftarten. Was hier beschrieben ist, bleibt auf diesem Server.
      </Notice>

      <section className="card">
        <h2>Verantwortlich</h2>
        <div className="prose">
          <p>
            Verantwortlich im Sinne der DSGVO ist, wer diese Installation betreibt. Die vollständigen Angaben dazu
            stehen im <strong>Impressum</strong>.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Was gespeichert wird</h2>
        <div className="prose">
          <p>
            <strong>Benutzerkonten.</strong> Anmeldename, Anzeigename und Rolle. Das Passwort wird nicht gespeichert,
            sondern nur sein Hash — aus ihm lässt sich das Passwort nicht zurückrechnen.
          </p>
          <p>
            <strong>Anmeldungen.</strong> Eine Sitzung wird als Cookie geführt, das der Browser nicht auslesen kann
            (<code>httpOnly</code>). Sie endet nach 12 Stunden ohne Aktivität, spätestens nach 7 Tagen.
          </p>
          <p>
            <strong>Jobs und Verlauf.</strong> Zu jedem Lauf werden Zeitpunkt, Ergebnis und die Namen der übertragenen
            Dateien festgehalten. Dateinamen sind regelmäßig personenbezogen — deshalb werden sie wie personenbezogene
            Daten behandelt und nicht unbegrenzt aufbewahrt.
          </p>
          <p>
            <strong>Zugänge und Schlüssel.</strong> Passwörter für Quellserver und Verschlüsselungsschlüssel liegen
            verschlüsselt in der Datenbank. Der Hauptschlüssel dafür steht in einer Umgebungsvariablen, also außerhalb
            der Datenbank, die er schützt. Ansehen lassen sie sich auch mit Verwaltungsrechten nicht — nur ersetzen.
          </p>
          <p>
            <strong>Inhalte der übertragenen Dateien</strong> werden nicht ausgewertet und nicht dauerhaft abgelegt.
            Unikom transportiert sie, es liest sie nicht.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Wie lange</h2>
        <div className="prose">
          <p>
            Protokolleinträge werden nach <strong>90 Tagen</strong> gelöscht, wenn der Job nichts anderes festlegt. Für
            jeden Job lässt sich eine kürzere oder längere Frist einstellen.
          </p>
          <p>
            Der Dateiverlauf ist zugleich die Liste dessen, was bereits übernommen wurde. Er wird deshalb nur dann
            automatisch gelöscht, wenn für den Job ausdrücklich eine Frist gesetzt ist — sonst würden bereits
            übertragene Dateien wieder als unbekannt gelten.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Wer es sieht</h2>
        <div className="prose">
          <p>
            Nur angemeldete Benutzer dieser Installation, und auch die nur im Rahmen ihrer Rolle. Es findet keine
            Übermittlung an Dritte statt — außer an die Ziele, die in den Jobs selbst eingetragen sind. Wohin ein Job
            liefert, bestimmt der Betreiber.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Was nicht stattfindet</h2>
        <div className="prose">
          <p>
            Keine Analyse des Nutzungsverhaltens, keine Zählpixel, keine Werbe- oder Wiedererkennungs-Cookies. Das
            Sitzungs-Cookie ist das einzige und für den Betrieb notwendig — ohne es gäbe es keine Anmeldung.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Ihre Rechte</h2>
        <div className="prose">
          <p>
            Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
            Datenübertragbarkeit und Widerspruch, außerdem das Recht auf Beschwerde bei einer Aufsichtsbehörde.
          </p>
          <p>
            Wenden Sie sich dafür an die im Impressum genannte Stelle. Bei Daten, die im Auftrag eines Kunden
            verarbeitet werden, leitet der Betreiber die Anfrage an den jeweiligen Verantwortlichen weiter.
          </p>
        </div>
      </section>
    </>
  );
}
