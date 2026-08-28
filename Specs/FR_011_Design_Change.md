# Schichtwerk Design System — Portier-Spec

> Zweck: Das visuelle Erscheinungsbild von Schichtwerk (App-Shell, Header, Sidebar, Logo, Modale,
> Slide-ins, Bestätigungs-Dialoge) 1:1 in ein anderes Projekt übernehmen — **ohne** die dortige
> Funktionalität anzufassen. Diese Datei beschreibt nur das Design: Tokens + Komponenten-Rezepte
> mit exakten Klassen. Gib sie einem Claude-Code-Agenten im Zielprojekt als Referenz.

---

## 0. Stack-Voraussetzungen (zuerst lesen)

Diese Punkte müssen im Zielprojekt stimmen, sonst sehen die Rezepte anders aus:

1. **Tailwind v4, CSS-first.** Es gibt **keine `tailwind.config.*`**. Alle Tokens leben in `globals.css`
   in einem `@theme { … }`-Block plus `:root`-Variablen. Übernimm das genauso — sonst greifen die
   `bg-surface` / `text-muted` / `--radius-control`-Utilities nicht.
2. **Dark Mode ist der Default.** Der Root-Layout setzt am `<html>` `data-sw-modern="on"`, außer
   `localStorage['sw-dashboard-modern'] === '0'`. Light Mode ist der Opt-out. Fast alle dunklen
   Flächen sind Dark-Mode-Überschreibungen derselben semantischen Tokens.
3. **`cn()`-Helfer** = triviales `.filter(Boolean).join(" ")` (kein `tailwind-merge`). Reicht, weil
   nie widersprüchliche Utilities gemerged werden.
4. **Overlays werden nach `document.body` geportalt** (`createPortal`). Grund: inline gerenderte
   Modale erben im Dark Mode das „Glas"-`bg-surface` (rgba 0.07) und werden durchscheinend. Portal =
   außerhalb der Content-Spalte = eigenes, deckendes Dark-Skin über die Klasse `sw-dark-modal`.
5. **Radius-Regeln sind bewusst uneinheitlich** (siehe §2): Karten/Modale **5px**, Buttons **6px**,
   Inputs/Selects/Alerts **10px** (`--radius-control`).
6. **Font:** Token ist `Inter`, wird aber **nicht gebündelt** (kein `next/font`, kein Google-Fonts-Link).
   Inter greift nur, wenn im OS installiert, sonst `system-ui`-Fallback. Willst du Inter garantiert,
   binde es im Zielprojekt aktiv ein (`next/font/google`).

---

## 1. Design-Tokens (paste-ready)

Kompletter Token-Satz für `globals.css`. Namen sind generisch genug zum direkten Übernehmen; die
`--brand-*`-Werte sind schichtwerk-spezifisch (Logo/Verläufe) — umbenennen oder ersetzen nach Bedarf.

### 1a. `@theme` — Light-Basis

```css
@import "tailwindcss";

@theme {
  /* Primär / Akzent */
  --color-primary:            #0f3558;
  --color-primary-light:      #4a7294;
  --color-primary-dark:       #0a2844;
  --color-primary-foreground: #ffffff;

  /* Flächen & Text */
  --color-background: #f8fafc;
  --color-surface:    #ffffff;
  --color-foreground: #0f172a;
  --color-muted:      #64748b;
  --color-border:     #e2e8f0;
  --color-subtle:     #f1f5f9;
  --color-hover:      #fafafa;

  /* Semantische Status (kein eigenes „warning" — Amber via rohe text-amber-*/bg-amber-50) */
  --color-success:            #ecfdf5;  --color-success-foreground: #065f46;
  --color-danger:             #fef2f2;  --color-danger-foreground:  #b91c1c;
  --color-info:               #e9eef3;  --color-info-foreground:    #0f3558;

  /* Nav-Aktiv-Tint */
  --color-nav-active: color-mix(in srgb, var(--color-primary) 10%, transparent);

  /* Radius */
  --radius-control: 0.625rem; /* 10px — NUR Inputs/Selects/Alerts, NICHT Karten */

  /* Font */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;

  /* Modal-Scrollbar */
  --modal-scrollbar-thumb: var(--color-primary-light);
  --modal-scrollbar-track: var(--color-border);
}
```

### 1b. `:root` — Layout- & Brand-Variablen

```css
:root {
  /* App-Shell-Geometrie (die tragenden Maße) */
  --app-shell-sidebar-width:      15rem;   /* 240px Sidebar */
  --app-shell-brand-band-height:  5.75rem; /* Logo-Band = Toolbar-Höhe; @md → 4.75rem (s.u.) */
  --app-shell-header-panel-color: #14476e; /* flache Basisfarbe für Header/Sidebar-Verlauf */

  /* Panel-Header-Fläche (Modal-/Listen-Kopf) */
  --panel-header-surface-light: #c7d4e5;
  --panel-header-surface-dark:  color-mix(in srgb, #c7d4e5 58%, #92a4b8);

  /* Scrollbars */
  --app-scrollbar-size:      12px;
  --sidebar-scrollbar-size:  8px;

  /* Brand-Palette (Logo/Verläufe — schichtwerk-spezifisch) */
  --brand-void: #061624; --brand-deep: #0c2848; --brand-mid: #154a72;
  --brand-bright: #1c6ba8; --brand-glow: #5c96bc;
  --brand-logo-from: #0284c7; --brand-logo-mid: #0369a1; --brand-logo-to: #7dd3fc;

  /* Header/Sidebar-Verläufe aus der Basisfarbe (dunkel 0% → base 60% → hell 100%) */
  --app-shell-header-panel-gradient-vertical:
    linear-gradient(180deg,
      color-mix(in srgb, var(--app-shell-header-panel-color) 78%, #000) 0%,
      var(--app-shell-header-panel-color) 60%,
      color-mix(in srgb, var(--app-shell-header-panel-color) 82%, #fff) 100%);
  --app-shell-header-panel-gradient-horizontal:
    linear-gradient(90deg,
      color-mix(in srgb, var(--app-shell-header-panel-color) 78%, #000) 0%,
      var(--app-shell-header-panel-color) 60%,
      color-mix(in srgb, var(--app-shell-header-panel-color) 82%, #fff) 100%);
}

@media (min-width: 768px) {
  :root { --app-shell-brand-band-height: 4.75rem; }
}
```

### 1c. Dark Mode (Default-Theme)

Dark überschreibt dieselben semantischen Tokens in mehreren Scopes. Kernstück = die Content-Spalte:

```css
/* Inhaltsbereich: Flächen werden „Glas" (durchscheinend) */
html[data-sw-modern="on"] .app-shell-content-column {
  --color-background: transparent;
  --color-surface:    rgba(255,255,255,0.07);
  --color-foreground: #e9eff7;
  --color-muted:      #a6bad0;
  --color-border:     rgba(255,255,255,0.14);
  --color-subtle:     rgba(255,255,255,0.06);
  --color-hover:      rgba(255,255,255,0.07);
  --color-info:       rgba(255,255,255,0.07);
}

/* Portal-Modale/Auth-Shell: DECKENDES Dark-Skin (nicht Glas!) + Primär heller remappt */
.sw-dark-modal {
  --color-surface:    #1b232d;
  --color-background: #131922;
  --color-foreground: #e9eff7;
  --color-muted:      #a6bad0;
  --color-border:     rgba(255,255,255,0.14);
  --color-subtle:     rgba(255,255,255,0.06);
  --color-primary:            #6ea8e0;  /* heller, damit auf Dunkel sichtbar */
  --color-primary-light:      #9cc6ec;
  --color-primary-dark:       #4a7db5;
  --color-primary-foreground: #10202f;
}

/* Dark-Scrollbars + Header/Sidebar-Basis wird Graustahl */
html[data-sw-modern="on"] {
  --app-scrollbar-track: #434f5f;
  --app-scrollbar-thumb: #1e232a;
  --app-shell-header-panel-color: #434f5f;
}
```

**Wiederkehrende Dark-Akzente** (für Karten/Header/Action-Buttons):
- Stahl-Verlauf (Header-Zeilen, Action-Buttons): `linear-gradient(90deg,#282f38 0%,#3f4a59 45%,#3f4a59 55%,#282f38 100%)`
- Karten-Deckstreifen oben: `linear-gradient(90deg,#6eb0d4 0%,#a9d3ea 48%,#e879f9 100%)`
- Action-Button-Kanon (Dark): flache Füllung `#282e37`, `border-radius:5px`, Schatten `0 2px 7px -1px rgba(0,0,0,0.85)`

---

## 2. Radius & Elevation

### Radius — **merken, weil uneinheitlich**
| Element | Radius | Klasse |
|---|---|---|
| Karten / Panels / **Modale** | **5px** | `rounded-[5px]` (Konstante `MODAL_ROUNDED_CLASS`) |
| Buttons | **6px** | `rounded-[6px]` |
| verschachtelte Toggles | 4px / 3px | `rounded-[4px]`, `rounded-[3px]` |
| Inputs / Selects / Alerts / Header-Controls | **10px** | `rounded-[var(--radius-control)]` |
| Mobile-Menü-Portal | 10px | `rounded-[var(--radius-control)]` |

Dark-Mode erzwingt Karten-Radius hart: `border-radius: 5px !important` (14px erzeugte inkonsistente Ecken).

### Schatten (keine Skala — literale `box-shadow`)
```
Header-Toolbar:        0 12px 18px -10px rgb(2 6 23 / 0.5)
Sidebar (rechts):      12px 0 18px -10px rgb(2 6 23 / 0.5)
Karten-Hover-Lift:     0 12px 24px -8px rgba(15,23,42,0.3)   + translateY(-3px)
Sub-Modal (Container): 0 40px 100px -15px rgba(0,0,0,0.7), 0 16px 44px -12px rgba(0,0,0,0.5)
  → Dark:              0 45px 110px -12px rgba(0,0,0,0.85), 0 18px 50px -10px rgba(0,0,0,0.6)
Dark-Karte (Basis):    0 1px 2px rgba(0,0,0,0.35), 0 18px 42px -16px rgba(0,0,0,0.55)
Slide-in (links):      8px 0 32px -8px rgba(15,23,42,0.28)
Slide-in (rechts):    -8px 0 32px -8px rgba(15,23,42,0.28)
```
Light-Mode-Buttons sind bewusst schattenlos: `html:not([data-sw-modern="on"]) button { box-shadow: none !important; }`

---

## 3. App-Shell-Layout (das tragende Gerüst)

**Grundprinzip: sidebar-first.** Kein separater globaler Top-Header — die „Kopfzeile" ist das
**Logo-Band oben in der Sidebar-Spalte**, und die Seiten-**Toolbar** sitzt oben in der Content-Spalte.
Beide teilen sich `--app-shell-brand-band-height`, damit ihre Unterkanten (Trennlinien) exakt fluchten.

```
┌───────────────────────────────────────────────────────────┐
│ SIDEBAR (15rem)         │ CONTENT-SPALTE (flex-1)           │
│ ┌─────────────────────┐ │ ┌───────────────────────────────┐│
│ │ Logo-Band  (4.75rem)│ │ │ Seiten-Toolbar   (4.75rem)    ││ ← gleiche Höhe,
│ ├─────────────────────┤ │ ├───────────────────────────────┤│   Trennlinie fluchtet
│ │ Nav (scrollbar)     │ │ │                               ││
│ │  …                  │ │ │  main (p-6)                   ││
│ │ Rechtliches (unten) │ │ │                               ││
│ └─────────────────────┘ │ └───────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
   Desktop: md:flex-row, md:h-dvh, md:overflow-hidden (kein Body-Scroll)
   Mobile:  flex-col, Sidebar = volle Breite + border-b, Nav klappt als Portal-Dropdown auf
```

### Layout-Klassenkonstanten (aus `lib/app-shell-layout.ts`)
```ts
APP_SHELL_ROOT_CLASS =
  "app-shell-root relative isolate flex min-h-dvh w-full max-w-full flex-col " +
  "overflow-x-clip overflow-y-auto md:h-dvh md:min-h-0 md:overflow-hidden md:flex-row";

// Sidebar-Spalte
APP_SHELL_SIDEBAR_CLASS = "app-shell-sidebar"; // CSS: vertikaler Brand-Verlauf, z-50, Rechts-Schatten
// im Markup zusätzlich:
"relative z-50 flex w-full shrink-0 flex-col overflow-visible border-b " +
"md:h-full md:min-h-0 md:w-[var(--app-shell-sidebar-width)] md:overflow-hidden md:border-b-0"

// Nav-Slot unter dem Logo
APP_SHELL_SIDEBAR_SLOT_CLASS =
  "app-shell-sidebar-scroll flex w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto " +
  "px-0 pb-3 pt-0 max-md:shrink-0 max-md:flex-none md:min-h-0 md:flex-1";

// Content-Spalte + main
APP_SHELL_CONTENT_COLUMN_CLASS =
  "app-shell-content-column flex min-w-0 flex-col overflow-x-clip max-md:flex-none md:min-h-0 md:flex-1";
APP_SHELL_MAIN_CLASS =
  "flex min-w-0 flex-col overflow-x-clip p-4 max-md:overflow-y-visible " +
  "md:min-h-0 md:flex-1 md:overflow-hidden md:p-6";
```

### Sidebar-Hintergrund (CSS)
```css
.app-shell-sidebar {
  background: var(--app-shell-header-panel-gradient-vertical);
  z-index: 50;
  box-shadow: 12px 0 18px -10px rgb(2 6 23 / 0.5);
  /* alles weiß-auf-blau in diesem Scope: */
  --color-foreground: #fff;
  --color-muted: rgb(255 255 255 / 0.78);
  --color-primary: #fff;
  --color-nav-active: rgb(255 255 255 / 0.18);
}
/* Die Menü-Liste selbst malt sich schwarz (Logo-Band bleibt blau): */
.app-shell-sidebar-nav-menu::before { content:""; position:absolute; inset:0; background:#000; }
html[data-sw-modern="on"] .app-shell-sidebar-nav-menu::before { background:#090b0f; }
```

### Bleed-Trick (Toolbar bündig zum Logo)
Die Toolbar sitzt in einem Negativ-Margin-Wrapper, der das `main`-Padding aufhebt, damit sie
randlos an der Logo-Bandkante klebt:
```css
.planning-toolbar-bleed-shell { margin-top: -1rem; margin-inline: -1rem; }
@media (min-width:768px){ .planning-toolbar-bleed-shell { margin-inline: -1.5rem; } }
```

---

## 4. Sidebar + Menü

### Struktur
```jsx
<div className="app-shell-sidebar relative z-50 flex w-full shrink-0 flex-col overflow-visible border-b
                md:h-full md:w-[var(--app-shell-sidebar-width)] md:overflow-hidden md:border-b-0">
  <BrandHeader />                    {/* Logo-Band, §5 */}
  <div className="app-shell-sidebar-scroll ... md:flex-1 relative z-10 hidden md:flex">
    <nav className="app-shell-sidebar-nav-slot flex min-h-full w-full flex-1 flex-col">
      <div className="app-shell-sidebar-nav-menu shrink-0 py-2">
        <div className="flex flex-col gap-0.5"> {/* Menüpunkte */} </div>
      </div>
      <div className="app-shell-sidebar-nav-underflow min-h-0 flex-1" aria-hidden />
      <div className="app-shell-sidebar-nav-legal shrink-0 space-y-0.5 pb-2"> {/* Impressum etc. */} </div>
    </nav>
  </div>
</div>
```

### Menüpunkt — Kern-Rezept
Top-Level-Item (Funktion `navItemClass(active)`):
```
Basis:   sw-nav-hl block w-full min-w-0 rounded-none border-l-2 py-2 pl-[calc(0.75rem-2px)] pr-3
         text-left text-sm font-medium leading-snug transition-colors
default: border-l-transparent text-foreground hover:bg-white/[0.12]
active:  sw-nav-hl-active border-l-primary bg-white/[0.16] text-foreground
```
Sub-Link (tiefer eingerückt, gemutet):
```
Basis:   sw-nav-hl block w-full min-w-0 rounded-none border-l-2 py-1.5 pl-[calc(2rem-2px)] pr-3
         text-left text-sm font-medium leading-snug transition-colors
default: border-l-transparent text-muted hover:bg-white/[0.12] hover:text-foreground
active:  sw-nav-hl-active border-l-primary bg-white/[0.16] text-foreground
```
Dark-Mode-Hover/Aktiv verstärkt: `.sw-nav-hl:hover, .sw-nav-hl-active { background-color:#2d353f !important; }`

**Wichtig:** Menüpunkte sind **text-only, keine Icons.** Einziges Glyph = rechtsbündiger **Chevron**
bei aufklappbaren Sektionen (14×14 SVG, `text-muted transition-transform duration-200`, `rotate-180` offen).

### Aufklapp-Sektionen (Accordion)
Aufklappbarer Header ist ein Button mit `navItemClass(active)` + `flex items-center justify-between gap-1`.
Der Body animiert per Grid-Rows-Trick:
```jsx
<div className="grid transition-[grid-template-rows] duration-200 ease-out
                ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}">
  <div className="overflow-hidden"> {/* Sub-Links */} </div>
</div>
```
Sektionen öffnen automatisch bei aktiver Route (nur öffnen, nie auto-schließen).

### Sektions-Trenner
```css
.app-shell-sidebar-nav-divider { margin: 0.375rem 0.75rem; border-top: 1px solid #242424; }
```
Zwischen sichtbaren Sektionen (`index > 0`) eingefügt.

### Rechtliches-Block (unten gepinnt)
Eigenes dunkles Overlay + Haarlinie oben; enthält z.B. Datenschutz/Impressum als Buttons mit
`mx-3 border-t border-black`-Trenner. Sign-out = `<form>` mit `Button variant="ghost"` styled als
`navItemClass(false) + "!rounded-none h-auto w-full justify-start font-normal"`.

### Mobile-Menü (Portal-Dropdown)
Öffnet unter dem Hamburger, `position:fixed`, `z-[200]`, Breite `min(224px, 100vw-16px)`:
```
app-shell-sidebar-mobile-panel z-[200] max-h-[min(70vh,calc(100dvh-6rem))] overflow-y-auto
rounded-[var(--radius-control)] border md:hidden  +  APP_SHELL_SIDEBAR_CLASS
```
Schließt bei Outside-Click / Escape / Routenwechsel.

---

## 5. Logo-Bereich

### Brand-Header-Zeile
```jsx
<div className="app-shell-brand-header relative flex shrink-0 items-center gap-2.5 py-0 pl-4 pr-3
                h-[var(--app-shell-brand-band-height)] min-h-[var(--app-shell-brand-band-height)]
                max-h-[var(--app-shell-brand-band-height)]">
  <Logo className="mt-0.5 shrink-0" />                        {/* 28×28 SVG */}
  <div className="min-w-0 flex-1">
    <p className="app-shell-brand-wordmark">Schichtwerk</p>    {/* Wortmarke */}
    <p className="truncate text-xs leading-tight text-muted">{orgName}</p>  {/* optional */}
  </div>
  {trailing}                                                  {/* nur Mobile-Hamburger */}
</div>
```
- **Layout:** horizontaler Flex, vertikal zentriert, `gap-2.5` (10px), Padding `py-0 pl-4 pr-3`.
- **Höhe:** fix auf `--app-shell-brand-band-height` (= identisch zur Toolbar, damit Trennlinie fluchtet).
- **Hintergrund:** transparent (der Sidebar-Verlauf scheint durch); Desktop `border-right: 1px solid rgb(255 255 255/0.12)`.

### Logo-Mark (SVG)
Inline-SVG `viewBox 0 0 36 36`, gerendert `h-7 w-7` (**28×28px**), `shrink-0`, `mt-0.5`. Motiv:
abgerundetes Kalender-Grid-Glyph mit Gradient-Fläche (`--brand-logo-from #0284c7 → mid #0369a1 →
to #7dd3fc`), glühendem Gradient-Ring als Stroke, feinen Grid-Linien und einer weiß hervorgehobenen
Zelle. → Im Zielprojekt durch das eigene Logo-SVG ersetzen; Rahmenmaße (28×28, `mt-0.5`) beibehalten.

### Wortmarke (CSS)
```css
.app-shell-brand-wordmark {
  display: block; margin: 0;
  font-size: 1rem; font-weight: 500; line-height: 1.15;
  letter-spacing: 0.07em; color: rgb(255 255 255 / 0.9);
}
@media (min-width:768px){ .app-shell-brand-wordmark { font-size: 1.0625rem; letter-spacing: 0.08em; } }
```

---

## 6. Header-Bar (Seiten-Toolbar)

Ein dunkler, horizontal scrollbarer Balken oben in der Content-Spalte, in **Segmente** mit
Volllinie-Trennern geteilt. Nicht `sticky/fixed` — bleibt oben, weil die ganze Shell
`md:h-dvh md:overflow-hidden` ist und die Toolbar ein `shrink-0`-Flex-Kind ganz oben ist.

### Outer `<header>`
```jsx
<header className={APP_PAGE_TOOLBAR_HEADER_CLASS + " min-w-0 w-full"}>
  <div className="planning-toolbar-scroll-row"> {/* Segmente */} </div>
</header>
```
```ts
APP_PAGE_TOOLBAR_HEADER_CLASS =
  "app-shell-top-panel app-header-dark-preview app-page-toolbar-header app-shell-top-panel-toolbar " +
  "planning-toolbar-segmented flex h-[var(--app-shell-brand-band-height)] " +
  "max-h-[var(--app-shell-brand-band-height)] min-h-[var(--app-shell-brand-band-height)] " +
  "shrink-0 flex-row items-stretch border-b border-border px-0";
```
```css
/* dunkler Balken + Overflow statt Umbruch */
.app-page-toolbar-header { background: var(--app-shell-header-panel-gradient-horizontal);
  box-shadow: 0 12px 18px -10px rgb(2 6 23 / 0.5); }
.app-page-toolbar-header.app-shell-top-panel-toolbar { overflow-x:auto; overflow-y:hidden; }
.planning-toolbar-segmented { position: relative; z-index: 10; }
.planning-toolbar-scroll-row {
  display:flex; width:max-content; min-width:100%; flex-wrap:nowrap; align-items:stretch;
  height: var(--app-shell-brand-band-height);
}
/* Dark-Skin-Tokens des Balkens */
.app-header-dark-preview {
  --color-foreground: #f1f5f9;
  --color-border: rgb(255 255 255 / 0.22);
  /* Control-Bg im Balken: rgb(0 0 0 / 0.4) */
}
```

### Segmente & Trenner
```
Segment:  flex h-full shrink-0 items-center px-2 md:px-4     (erstes Segment: pl-3 md:pl-6)
Trenner:  planning-toolbar-segment-divider shrink-0 self-stretch
          → CSS: width:2px; align-self:stretch; background:rgb(255 255 255 / 0.22)
Spacer:   planning-toolbar-row-spacer  → flex:1 1 auto  (schiebt Trailing-Controls nach rechts)
```

### Controls im Balken — alle `h-8 min-h-8`, weiß, Hover → Cyan `#9ee8ff`
```
Text-Action-Button (z.B. „Heute", Aktionen):
  inline-flex shrink-0 cursor-pointer select-none items-center gap-1.5 m-0 appearance-none
  border-0 bg-transparent p-0 text-sm font-semibold leading-none text-white shadow-none
  outline-none ring-0 transition-colors duration-150 hover:text-[#9ee8ff]

Chevron/Icon-Button (h-8 w-8, max-md:h-6 max-md:w-6):
  relative inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent text-white
  hover:text-[#9ee8ff]

Dropdown/Select-Trigger (text-only, randlos):
  h-8 header-toolbar-combobox-trigger w-full appearance-none whitespace-nowrap pl-3 pr-8
  text-base font-medium leading-8 text-white rounded-none border-0 bg-transparent
  hover:text-[#9ee8ff] data-[open=true]:text-[#9ee8ff]

Count-Badge:  rounded-full px-1.5 text-[11px] font-bold tabular-nums
              (kritische Variante: pulsierend, violett)
```
> Es gibt auch **bordierte** Control-Varianten (`rounded-[var(--radius-control)]`, `border`,
> Control-Bg `color-mix(... foreground 7% ...)`) für ein helles Theme — im dunklen Balken gewinnt
> aber die randlose Text-Variante (CSS strippt dort den Border).

---

## 7. Modale (zentrierte Dialoge)

Kein einzelnes `<Modal>` — ein Satz komponierbarer Klassen-Fabriken. Geometrie-Quelle:
`components/settings/settings-modal-shell.tsx`; React-Hüllen: `settings-list-ui.tsx`.

### Backdrop / Overlay
Flacher, **unschärfefreier** schwarzer Scrim; unterscheidet sich nur per z-index (Verschachtelungstiefe):
```
Sub-Modal (z-60):    absolute inset-0 z-[60] flex items-center justify-center bg-black/30 p-2 sm:p-4
                     max-sm:items-stretch max-sm:justify-stretch max-sm:p-0
Form-Sub (z-70):     …z-[70]…
Fixed über Shell:    fixed inset-0 z-[125] flex items-center justify-center bg-black/30 p-2 sm:p-4
                     md:left-[var(--app-shell-sidebar-width)]     (Offset an Sidebar vorbei)
```

### Container (Dialog-Panel)
```
relative z-[61] flex w-full min-w-0 flex-col overflow-hidden border border-border bg-surface
shadow-[0_40px_100px_-15px_rgba(0,0,0,0.7),0_16px_44px_-12px_rgba(0,0,0,0.5)]
rounded-[5px]  modal-scrollbar modal-scrollbar-inline
max-w-2xl                              (Größen-Map: md|lg|xl|2xl|3xl|4xl|5xl → max-w-*)
max-h-[min(90dvh,720px)]
max-sm:h-full max-sm:max-h-none max-sm:rounded-none max-sm:border-0   (Vollbild auf Mobile)
sw-dark-modal sw-settings-list-modal
```
- `bg-surface` → im Dark via `.sw-dark-modal` deckend `#1b232d`.
- Radius **5px** (Mobile randlos).

### Modal-Header
```jsx
<div className="flex items-start justify-between gap-3 border-b border-border
                px-4 py-3 sm:px-6 sm:py-4 panel-surface-header-bg">
  <div className="min-w-0 flex-1">
    <h2 className="text-base font-semibold leading-tight text-foreground sm:text-lg md:text-xl">{title}</h2>
    <p className="mt-1 text-sm text-muted">{subtitle}</p>
  </div>
  <IconButton size="sm" onClick={onClose}
    className="shrink-0 border-transparent bg-transparent hover:bg-subtle">
    <CloseIcon className="h-[18px] w-[18px]" />
  </IconButton>
</div>
```
Header-Fläche = Trennlinie (`border-b`) + Verlaufs-Hintergrund:
```css
.panel-surface-header-bg { background: linear-gradient(180deg,
  color-mix(in srgb, var(--panel-header-surface-light) 88%, #000) 0%,
  var(--panel-header-surface-light) 100%); }                 /* light: Stahlblau */
html[data-sw-modern="on"] .panel-surface-header-bg { background:
  linear-gradient(90deg,#282f38,#3f4a59,#3f4a59,#282f38); }  /* dark: Graustahl */
```

### Body & Footer
```
Body:   px-4 py-3 sm:px-5
Footer: flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-5
```
Buttons aus dem gemeinsamen `Button` mit `variant="outline" | "primary" | "danger" | "secondary"`.
Footer stapelt auf Mobile (umgekehrt), rechtsbündige Reihe ab `sm`.

---

## 8. Modale mit Listen

Listen-Zeilen kommen aus Helfern in `settings-list-ui.tsx`. Das Listen-Modal trägt zusätzlich
`sw-settings-list-modal` (flacht `<thead>`-Zellen im Dark auf flaches `#2a3340` ab).

### Scroll-Container & Spaltenköpfe
```
Scroll-Box:   min-h-0 overflow-auto rounded-md border border-border bg-surface
Panel-Kopf:   shrink-0 truncate border-b border-border panel-surface-header-bg
              px-3 py-2.5 text-sm font-medium text-foreground
Spaltenkopf:  panel-surface-header-bg px-2 py-1 pb-1 text-xs font-medium text-muted   (+ text-left/center/right)
Sticky-Kopf:  … + sticky top-0 z-[1]
```
Zeilenhöhe ≈ **1.75rem**. Feste Listenhöhen werden vorab berechnet (kein Layout-Sprung), z.B.
`max-h-[calc(100dvh-16rem)] overflow-auto [scrollbar-gutter:stable]`.

### Zeilen-Styling — Hover / Selektiert / Trenner
```js
settingsDataRowClass(isSelected):
  "cursor-pointer select-none border-b border-border/70 transition-[background-color,box-shadow] last:border-0
   hover:bg-subtle hover:shadow-sm"
  + isSelected && " bg-primary/5 shadow-sm ring-1 ring-inset ring-primary/20"

Indikator-Zelle (links):  w-1 border-l-4 border-l-primary   (transparent wenn nicht selektiert)
Daten-Zelle:              min-h-0 px-2 py-0.5 text-sm leading-tight tabular-nums text-foreground
```
```jsx
<tr onClick={select} onDoubleClick={openEdit} className={settingsDataRowClass(isSelected)}>
  <td className={indicatorCell(isSelected)} aria-hidden />
  <td className="min-h-0 px-2 py-0.5 text-sm leading-tight text-foreground font-medium">{item.name}</td>
  <td className="min-h-0 px-2 py-0.5 text-sm text-muted text-center">…</td>
</tr>
```

### Nicht-Tabellen-Variante (Karten-Zeilen)
Gruppierte `<ul>`-Zeilen: `flex min-h-[1.5rem] items-stretch overflow-hidden bg-white/80 transition-colors`
mit 3px farbigem Strip links; Gruppen-Header `panel-surface-header-bg px-2.5 py-1.5 text-sm
font-semibold leading-tight text-[#273b55]`. Dark: Zeile → `#181d28`, Header-Text → `#e9eff7`.

---

## 9. Slide-ins (Seiten-Panels)

Basis-Engine: `PlanningSidePanel` (`components/planning/planning-side-panel.tsx`), links- oder
rechts-verankert. Wrapper: `SettingsSidePanel` (links, dark) und der **Superadmin-Dark-Slide-in**.

### Seite / Breite / Hintergrund
```
Panel-Element:
  pointer-events-auto absolute top-0 bottom-0 z-[110] flex min-w-0 flex-col bg-surface
  border-x  +  (links ? left-0 : right-0)  +  Schatten  +  Breite  +  transform  +  modal-scrollbar

links:   md:left-[var(--app-shell-sidebar-width)]  border-r  shadow-[8px_0_32px_-8px_rgba(15,23,42,0.28)]
         Breite default: w-full max-w-md
         Breite „wide":  w-full max-w-none md:w-[min(64rem,calc(100vw-var(--app-shell-sidebar-width)))]
rechts:  right-0  border-l  shadow-[-8px_0_32px_-8px_rgba(15,23,42,0.28)]
         Breite default: w-full max-w-md    |    „wide": w-full max-w-[100vw] sm:max-w-6xl
```
Links-Panels starten an der Sidebar-Kante (wirken, als wüchsen sie hinter der Sidebar hervor;
Clip-Fenster per `overflow-hidden`). Volle Höhe (`top-0 bottom-0`).

### Animation
Enter: doppeltes `requestAnimationFrame` → `translate-x-0` mit `transition-transform duration-300 ease-out`;
offscreen `±translate-x-full`. Exit: Keyframe-Klasse, 280ms:
```css
@keyframes planning-side-panel-out-right {
  0%{transform:translateX(0);opacity:1} 82%{transform:translateX(100%);opacity:1}
  100%{transform:translateX(100%);opacity:0} }
.planning-side-panel-out-right { animation: planning-side-panel-out-right 280ms linear forwards; }
```
Backdrop: `fixed inset-0 z-[108] bg-black/25 transition-opacity` (ein `duration-300 ease-out`,
aus `duration-200 ease-in`). **Default: kein Dismiss per Backdrop/Escape** — nur X-Button.
Reduced-Motion: Animation aus, sofortiges Schließen.

### Slide-in-Header (identisch zum Modal-Header)
```jsx
<header className="shrink-0 border-b border-border px-3 py-3 sm:px-5 sm:py-4 panel-surface-header-bg">
  <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-base font-semibold leading-tight text-foreground sm:text-lg md:text-xl break-words">{title}</h2>
        <span className="text-sm font-normal text-muted">{titleMeta}</span>
      </div>
      <p className="mt-0.5 break-words text-xs text-muted sm:text-sm">{subtitle}</p>
    </div>
    <IconButton size="sm" onClick={requestClose}
      className="shrink-0 border-transparent bg-transparent hover:bg-subtle">
      <CloseIcon className="h-[18px] w-[18px]" />
    </IconButton>
  </div>
</header>
```
Footer-Konstante: `flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5 sm:py-4`.

### Superadmin-Dark-Slide-in
Rechts-verankert, `size="wide"`, in Dark gerendert über `panelClassName="app-header-dark-preview
[color-scheme:dark]"`. Dark-Palette aus `.app-header-dark-preview` (`--color-surface: rgb(6 22 39/.92)`,
`--color-background:#0f172a`, `--color-foreground:#f1f5f9`, `--color-border:rgb(255 255 255/.22)`),
plus `[color-scheme:dark]` für native Controls. Tabs im `headerAside`: `border-b-2`, aktiv
`border-primary text-foreground`, inaktiv `border-transparent text-muted`.

### Slide-in vs. zentriertes Modal
| | Slide-in | Zentriertes Modal |
|---|---|---|
| Verankerung | Bildschirmkante, volle Höhe, `absolute top-0 bottom-0`, Offset an Sidebar vorbei | zentriert, `max-h-[min(90dvh,720px)]` |
| Auftritt | horizontale Transform-Animation 280–300ms | erscheint sofort |
| Backdrop | `bg-black/25`, default nicht-dismissend | `bg-black/30` |
| Gemeinsam | gleicher Header-Verlauf, gleicher Close-Button, `border-border`-Trenner, 5px-Body-Geometrie | ← identisch |

---

## 10. Bestätigungs-Modale (Confirm / Alert)

### Container
```
relative z-[71] flex w-full min-w-0 max-w-md flex-col overflow-hidden border border-border bg-surface
shadow-[0_40px_100px_-15px_rgba(0,0,0,0.7),0_16px_44px_-12px_rgba(0,0,0,0.5)]
rounded-[5px]  modal-scrollbar
max-sm:h-auto max-sm:max-h-none max-sm:rounded-none max-sm:border-0
sw-dark-modal sw-confirm-modal
```
- Klein: `max-w-md`.
- `.sw-confirm-modal` (Dark) = dekorativer Vertikal-Verlauf + hellerer Border:
  `background: linear-gradient(180deg,#333e4d 0%,#222b36 48%,#161d25 100%); border-color:#8b99ac;`
  (Footer-Trenner `.border-t` ebenfalls `#8b99ac`).

### Shell
```jsx
<div className="rounded-[5px] ... sw-dark-modal sw-confirm-modal overflow-hidden p-0">
  <ModalHeader title=… subtitle=… onClose=… />          {/* oder nur bare X, s.u. */}
  <div className="px-4 py-3 sm:px-5">
    <p className="text-sm text-foreground" id={descId}>{message}</p>
  </div>
  <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
    {buttons}
  </div>
</div>
```
A11y: `role="alertdialog" aria-modal="true"` + `aria-labelledby`/`aria-describedby`. Variante mit
nur oberrechtem X (ohne farbige Kopfleiste) existiert für destruktive Reset-Dialoge.

### Button-Reihe — Abbrechen vs. destruktiv/primär
```
Löschen (destruktiv):  Abbrechen = variant="outline" (+ CloseIcon)
                       Bestätigen = variant="danger"  (+ TrashIcon, „Ja, löschen")
Ja/Nein (neutral):     Abbrechen = variant="outline" („Nein")
                       Bestätigen = variant="primary" („Ja")
```
Im Dark werden `bg-primary`-Primärbuttons in Alertdialogen auf den Stahl-Verlauf umgeskinnt statt Blau;
innerhalb `sw-dark-modal` gewinnt der Action-Button-Kanon (`#282e37` flache Füllung).

### Einfaches Hinweis-Modal (Sonderfall `MessageModal`)
Eigenes, simpleres Primitive — **stilistischer Ausreißer**: `fixed inset-0 z-[250] … bg-black/30 p-4`,
Panel `w-full max-w-sm overflow-hidden rounded-xl bg-surface shadow-xl`, farbige Kopfleiste per inline
`backgroundColor: var(--app-shell-header-panel-color)` mit `text-white`-Titel, ein `variant="primary"`
OK-Button. Nutzt `rounded-xl` + `#14476e` statt des 5px-/Verlaufs-Systems. → Für Konsistenz im
Zielprojekt besser an das Confirm-System oben angleichen.

---

## 11. z-index-Leiter (bewusst gestaffelt)

```
108  Slide-in-Backdrop
110  Slide-in-Panel  /  Area-Kalender-Modal-Backdrop
115  Superadmin-Nested-Wrapper
116  Area-Kalender-Alertdialog
120  Dropdown-Panels
121  Fixed-Confirm (Portal)
125  App-Shell-Fixed-Modal
130/131  gestapeltes Confirm
200  Mobile-Sidebar-Portal
250  MessageModal (Hinweis)
--- innerhalb Modal-Ebenen ---
50/60/70  Backdrop je Verschachtelung   ·   61/71  Dialog-Panel
```

---

## 12. Porting-Checkliste

1. **`globals.css` aufsetzen:** `@import "tailwindcss"` + `@theme`-Block (§1a) + `:root` (§1b) +
   Dark-Overrides (§1c). Ohne das greifen `bg-surface`/`text-muted`/`--radius-control` nicht.
2. **Dark-Mode-Bootstrap:** am `<html>` `data-sw-modern="on"` als Default setzen (Inline-Script im
   Root-Layout), Opt-out via `localStorage`.
3. **Helfer:** `cn()` (§0.3). Radius-Konstanten `MODAL_ROUNDED_CLASS="rounded-[5px]"` etc.
4. **App-Shell** (§3) als äußeres Gerüst: Sidebar-Spalte (Logo-Band + Nav-Slot) links, Content-Spalte
   (Toolbar + main) rechts. `--app-shell-brand-band-height` für Band-/Toolbar-Höhe teilen.
5. **CSS-Hooks** übernehmen: `.app-shell-sidebar`, `.app-shell-sidebar-nav-menu::before`,
   `.panel-surface-header-bg`, `.app-header-dark-preview`, `.sw-dark-modal`, `.sw-confirm-modal`,
   `.planning-toolbar-*`, die Slide-in-Keyframes.
6. **Overlays immer nach `document.body` portalen** + `sw-dark-modal` am Panel (§0.4). Sonst
   scheinen Dark-Modale durch.
7. **Radius-Regeln beachten** (§2): 5px Karten/Modale, 6px Buttons, 10px Inputs/Selects/Alerts.
8. **Logo** (§5): eigenes SVG einsetzen, Rahmenmaße (28×28, `gap-2.5`, Bandhöhe) beibehalten.
9. **Font:** willst du garantiert Inter, aktiv bündeln (`next/font/google`) — Schichtwerk tut das NICHT.
10. **Farben/Brand** (`--brand-*`, `--app-shell-header-panel-color`) an die eigene Marke anpassen;
    die semantischen Tokens (`--color-surface/foreground/muted/border/primary`) besser generisch lassen.

---

### Quell-Dateien im Schichtwerk-Repo (für tiefere Referenz)
- `apps/web/src/app/globals.css` — alle Tokens, Dark, Schatten, Scrollbars, Keyframes
- `apps/web/src/lib/app-shell-layout.ts` — Layout-Klassenkonstanten
- `apps/web/src/components/areacalendar/app-shell.tsx` — Shell + Sidebar-Rahmen
- `apps/web/src/components/areacalendar/sidebar-nav.tsx` — Menü
- `apps/web/src/components/brand/app-shell-brand-header.tsx` + `schichtwerk-logo.tsx` — Logo-Band
- `apps/web/src/components/planning/planning-page-toolbar.tsx` — Header-Toolbar
- `apps/web/src/lib/header-toolbar-styles.ts` — Header-Control-Klassen
- `apps/web/src/components/settings/settings-modal-shell.tsx` + `settings-list-ui.tsx` — Modal-Fabriken + Listen
- `apps/web/src/components/planning/planning-side-panel.tsx` — Slide-in-Engine
- `apps/web/src/components/settings/superadmin-modal.tsx` — Dark-Slide-in
- `apps/web/src/lib/dashboard-panel-styles.ts` — `rounded-[5px]`
- `apps/web/src/components/ui/button.tsx`, `input.tsx`, `alert.tsx` — Button/Control-Varianten
```
