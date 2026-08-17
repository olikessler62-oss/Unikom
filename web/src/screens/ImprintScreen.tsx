import type { ReactNode } from 'react';

import { Notice } from '../components/Pieces.js';

/**
 * Das Impressum gehört dem Betreiber, nicht dem Hersteller — Unikom läuft auf
 * dem Server des Kunden, und dort ist der Kunde der Anbieter.
 *
 * Deshalb steht hier ein Gerüst mit leeren Feldern statt erfundener Angaben.
 * Ein falscher Name im Impressum wäre schlimmer als gar keiner.
 */
export function ImprintScreen() {
  return (
    <>
      <Notice kind="warn">
        Diese Angaben sind noch nicht ausgefüllt. Sie stammen vom Betreiber dieser Installation und sind nach § 5 DDG
        (früher § 5 TMG) verpflichtend, sobald die Oberfläche über das eigene Unternehmen hinaus erreichbar ist.
      </Notice>

      <section className="card">
        <h2>Anbieter</h2>
        <div className="prose">
          <Line label="Firma">
            <Slot>Firmenname, Rechtsform</Slot>
          </Line>
          <Line label="Anschrift">
            <Slot>Straße und Hausnummer, PLZ, Ort</Slot>
          </Line>
          <Line label="Vertreten durch">
            <Slot>Geschäftsführung oder vertretungsberechtigte Person</Slot>
          </Line>
        </div>
      </section>

      <section className="card">
        <h2>Kontakt</h2>
        <div className="prose">
          <Line label="Telefon">
            <Slot>Rufnummer</Slot>
          </Line>
          <Line label="E-Mail">
            <Slot>E-Mail-Adresse</Slot>
          </Line>
        </div>
      </section>

      <section className="card">
        <h2>Register und Steuer</h2>
        <div className="prose">
          <Line label="Registergericht">
            <Slot>Amtsgericht</Slot>
          </Line>
          <Line label="Registernummer">
            <Slot>HRB / HRA</Slot>
          </Line>
          <Line label="USt-IdNr.">
            <Slot>Umsatzsteuer-Identifikationsnummer nach § 27 a UStG</Slot>
          </Line>
        </div>
      </section>

      <section className="card">
        <h2>Software</h2>
        <div className="prose">
          <p>
            Diese Oberfläche gehört zu <strong>Unikom</strong>, Stand {__UNIKOM_BUILD__}. Die Anwendung läuft auf dem
            Server des oben genannten Anbieters; der Hersteller der Software hat keinen Zugriff auf die hier
            verarbeiteten Daten.
          </p>
        </div>
      </section>
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="legal-line">
      <span className="legal-line__label">{label}</span>
      <span className="legal-line__value">{children}</span>
    </div>
  );
}

/** Eine offene Stelle: sichtbar leer, damit sie nicht übersehen wird. */
function Slot({ children }: { children: ReactNode }) {
  return <span className="slot">{children}</span>;
}
