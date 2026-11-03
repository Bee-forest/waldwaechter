# Waldwächter – PWA für Waldbesitzer

Mobile Web-App (Progressive Web App) ohne App-Store: Karte mit Flurstücken, persönliche Flächenverwaltung, Maßnahmen und eine geführte Durchforstung per GPS-Raster.

## 1. Gewählter Stack

| Baustein | Wahl | Begründung |
|---|---|---|
| Sprache | **Vanilla JavaScript (ES-Module)** | Kein Build-Schritt, läuft direkt in Safari/Chrome, wenig Ballast für schwaches Netz im Wald |
| Karte | **Leaflet 1.9.4** (lokal unter `vendor/`) | Leicht, mobilfähig, OSM- und WMS-tauglich; lokal eingebunden, damit die App offline startet |
| Basiskarten | **Luftbild Thüringen** (DOP 20 cm, Geoproxy `DOP`, Layer `th_dop`/`th_dop200rgb`), OpenStreetMap, TopPlusOpen (BKG) | Amtliche Daten, frei nutzbar (© GDI-Th, dl-de/by-2-0) |
| Flurstücke | **ALKIS Thüringen**: WMS `adv_alkis_wms_th` bzw. `…_gelb` (Grenzen), WFS `adv_alkis_wfs` (`ave:Flurstueck`) für Antippen und Suche | `js/map/thueringen.js` |
| Objektlayer | Overpass API (OSM) | Gebäude, Wasser, Wald, Landwirtschaft ab Zoom 15 |
| Styling | Eigenes CSS mit Design-Tokens, Hell/Dunkel | Hohe Kontraste, große Schrift (Atkinson Hyperlegible), Touch-Ziele ≥ 48 px |
| Speicher | `localStorage` (`js/store.js`) | Für den Prototyp; später gegen Backend/IndexedDB austauschbar |
| Hardware | Geolocation API, Vibration API, Screen Wake Lock, DeviceOrientation (Kompass) | Reine Web-Standards |

Tailwind wurde bewusst nicht verwendet: Ohne Build-Schritt müsste es per CDN geladen werden, und das funktioniert offline nicht zuverlässig.

## 2. Starten

Die App muss über **HTTPS** ausgeliefert werden (Ausnahme: `localhost`), sonst funktionieren Service Worker und GPS nicht.

```bash
cd waldwaechter
python3 -m http.server 8080      # oder: npx serve .
# → http://localhost:8080
```

**Auf dem Handy testen:** Ordner auf einen beliebigen statischen Host mit HTTPS legen (z. B. Netlify, GitHub Pages, eigener Webserver) oder lokal per Tunnel (`npx localtunnel --port 8080`, `cloudflared tunnel`).

**Installieren („Zum Startbildschirm“):**
- Android/Chrome: Menü → „App installieren“ (oder Button im Profil)
- iPhone/Safari: Teilen → „Zum Home-Bildschirm“

**Am Schreibtisch testen:** Profil → Einstellungen → „GPS simulieren“ einschalten. In der Durchforstung kannst du dann in die Karte tippen, um deinen Standort zu setzen, oder „Zum Punkt gehen (Simulation)“ nutzen.

## 3. Projektstruktur

```
index.html              App-Hülle, PWA-Meta-Tags (inkl. iOS)
manifest.json           Web-App-Manifest (Name, Icons, standalone, Shortcuts)
sw.js                   Service Worker: App-Shell offline, Kartenkacheln cachen
css/app.css             Gestaltung, Hell/Dunkel, Animationen
js/app.js               Einstieg, Bottom-Navigation, Theme, Installation, SW-Registrierung
js/home.js              Reiter 1: Karte, Layer, Flurstücksauswahl, Suche, Infobox, i-Punkte
js/profile.js           Profil: Flächenübersicht, Flurstücksliste (Lupe/Mülleimer), Konto, FBG, Einstellungen
js/measures.js          Reiter 2: Maßnahmenliste, „Neue Maßnahme beginnen“
js/thinning/wizard.js   Durchforstungs-Workflow (4 Schritte inkl. Navigation)
js/thinning/plan.js     Rechenkern: Raster + Entnahme je Punkt (ohne UI, testbar)
js/thinning/gps.js      Standortquelle: echtes GPS oder Simulation
js/thinning/feedback.js Vibration, Ersatzton, Wake Lock
js/map/basemap.js       Basiskarten, Kategoriefarben, OSM-Objektlayer
js/data/source.js       Datenadapter (einzige Stelle für externe Daten)
js/data/demo-data.js    Demo-Flurstücke, Bestände, Rettungspunkte (frei erfunden)
js/mascot.js            Die Waldwächter-Wanze (SVG), Sprechblasen, Einführung
js/placeholders.js      Reiter 3–5 (Finanzen, Aktuelles, KI-Assistent)
```

## 4. Durchforstungsmethode – Logik

1. **Bestandsauswahl:** ganzes Flurstück, Bestand aus der Baumartenkarte oder selbst eingezeichnetes Polygon.
2. **Angaben:** Haupt- und Mischbaumart mit mittlerem BHD, Alter, Stammzahl vorher/nachher je ha, Durchforstungsart, Rasterweite.
3. **Raster:** `generateGrid()` legt ein Quadratraster (lokal metrisch projiziert) über die Fläche und sortiert die Punkte als Schlangenlinie (kurzer Laufweg).
   Entnahme gesamt = (N vorher − N nachher) × Fläche. Sie wird je Baumart nach Anteil aufgeteilt und gleichmäßig auf die Punkte verteilt; die Summen bleiben exakt.
   Ziel-BHD je Punkt: Niederdurchforstung 0,6–0,9 × dg, Hochdurchforstung 0,9–1,25 × dg, Auslese 1,0–1,4 × dg (Faktoren in `plan.js` anpassbar).
4. **Im Bestand:** `watchPosition` mit hoher Genauigkeit. Unterschreitet die Entfernung zum Zielpunkt den Ankunftsradius (Standard 8 m, im Profil einstellbar), vibriert das Gerät und es erscheint die Frage „Befindest du dich am ersten Rasterpunkt und möchtest starten?“. Danach zählt man die markierten Bäume je Baumart; ist der Punkt abgeschlossen, wird er **grün** und die App führt zum nächsten Punkt. Fortschritt wird nach jedem Schritt gespeichert.

## 5. Wichtige Plattform-Hinweise

- **iPhone vibriert nicht:** Safari unterstützt die Vibration API nicht. Die App spielt dort einen Signalton und lässt den Bildschirm orange aufblitzen. Der Ton wird beim Tippen auf „Durchforstung starten“ freigeschaltet (iOS-Vorgabe).
- **GPS nur bei aktivem Bildschirm:** Web-Apps erhalten im Hintergrund keine Standortdaten. Deshalb hält die App den Bildschirm während der Navigation per Wake Lock an (iOS ab 16.4).
- **GPS-Genauigkeit unter Kronendach:** typischerweise 5–15 m. Die App zeigt die Genauigkeit an und bietet „Ich bin am Punkt“ als manuelle Bestätigung.
- **Kompass:** Auf iOS wird die Freigabe beim Start der Durchforstung abgefragt. Ohne Kompass zeigt der Pfeil mit Norden oben.
- **Offline:** App-Shell läuft offline. Kartenkacheln eines Bestands können vor dem Waldgang mit „Karte für offline speichern“ geladen werden (max. 400 Kacheln, Zoom 15–18).

## 6. Für den Echtbetrieb anzubinden

Alles läuft über `js/data/source.js`. Dort die Demo-Funktionen ersetzen:

- **Flurstücke:** bereits angebunden (ALKIS-WFS Geoproxy Thüringen). Falls der Browser die Abfrage wegen fehlender CORS-Freigabe blockiert, einen kleinen Proxy (z. B. Cloudflare Worker) davorschalten und die URL in `js/map/thueringen.js` ändern.
- **Schutzgebiete, Biotope, Waldfunktionen:** Dienste der TLUBN bzw. von ThüringenForst.
- **Rettungspunkte:** KWF-Rettungspunkte als GeoJSON vorhalten.
- **Baumartenkarte/Bestände:** Forsteinrichtung oder eigene Erfassung.
- **Kacheln:** Die OSM-Kachelserver erlauben keine Massendownloads. Für viele Nutzer eigenen Kachelserver oder kommerziellen Anbieter nutzen; Esri-Nutzungsbedingungen prüfen.
- **Konto/Sync:** `store.js` gegen ein Backend mit Login tauschen; IBAN nicht unverschlüsselt im Browser halten.

Bei jeder Änderung an App-Dateien `VERSION` in `sw.js` erhöhen, damit Nutzer das Update erhalten.

## Lizenzen

Leaflet: BSD-2-Clause (`vendor/leaflet/LICENSE`). Atkinson Hyperlegible: SIL OFL 1.1 (`fonts/OFL.txt`). Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Wanzen-Maskottchen: eigener Entwurf für dieses Projekt.
