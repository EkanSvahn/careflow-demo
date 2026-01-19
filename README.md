# Careflow – ärendeflöde i KnockoutJS

En liten demo‑app för att visa MVVM‑tänk, observables och computed i KnockoutJS. UI:t simulerar ett generiskt ärendeflöde för kund- eller internsupport, med SLA‑indikatorer och filtrering.

## Varför?
Det här projektet är byggt för att kunna användas i CV/portfolio och visa att du kan:
- förstå KnockoutJS och MVVM
- arbeta med observableArray, computed och subscriptions
- hantera validering, loading‑state och fel
- koppla mot ett (mockat) API

## Funktioner
- Ärendelista med filtrering, sortering och sök
- SLA‑beräkningar per ärende (computed)
- ObservableArray för listan
- Subscriptions som sparar filter i `localStorage`
- Mockad API‑inläsning från `public/mock/cases.json`
- “Simulera fel” för att visa felhantering
- Sidopanel för ärenden med redigering, kommentarer och historik
- Autosparar ändringar i `localStorage`

## Kom igång

```bash
npm install
npm run dev
```

Öppna den URL som Vite visar i terminalen.

## Bygg & preview

```bash
npm run build
npm run preview
```

## GitHub Pages
Vite är konfigurerat med `base: './'` så att `dist/` fungerar i GitHub Pages.

**Enkel publicering (manual):**
1. Kör `npm run build`
2. Publicera `dist/` via GitHub Pages (t.ex. Actions eller en `gh-pages`‑branch)

## Struktur
- `src/main.js` – startpunkt och binding
- `src/viewmodel.js` – AppViewModel + computed
- `src/api.js` – mockad API‑klient
- `src/utils.js` – format och SLA‑helpers
- `public/mock/cases.json` – fiktiv data

## Notiser
All data är fiktiv. Inga riktiga personuppgifter används.
