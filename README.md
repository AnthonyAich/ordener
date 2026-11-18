# Ordener

Eén plek voor al je werk: **brandjes** (ad-hoc, nu oplossen) en **projecten van lange adem**.

- **Frontend**: statische site in `docs/`, gehost op GitHub Pages
- **Backend**: Google Apps Script (`backend/Code.gs`) als JSON-API
- **Database**: een Google Sheet met de tabbladen `Projecten`, `Taken` en `Dagnotities`
- **Login**: een wachtwoord, dat gehasht in de scripteigenschappen staat; je blijft 30 dagen ingelogd
- **Installeerbaar als app** (PWA) op je gsm en je computer

Zonder configuratie draait de frontend in **demomodus**: je data blijft dan in je browser.

## Gebruik

| Invoer | Betekenis |
|---|---|
| `! Server down` | brandje (komt bovenaan bij Vandaag) |
| `Rapport nalezen *` | meteen voor vandaag inplannen |
| `Connector testen #datalake` | koppelen aan het project dat met "datalake" begint |
| `Scope herstellen /hw` | soort werk: Hardware Assistent (`/ip` = Improvement Projects) |

Sneltoetsen: `N` of `/` springt naar het invoerveld, `1` tot `5` wisselen tussen Vandaag, Taken, Projecten, Agenda en Dashboard.

Het **Vandaag**-scherm toont achtereenvolgens:
1. je brandjes
2. wat je voor vandaag gepland hebt
3. wat sinds een eerdere dag is blijven liggen
4. de volgende stap van elk actief project
5. de projecten die nog geen volgende stap hebben

### Soort werk en tijd
- Elk project krijgt een **soort werk**: *Hardware Assistent* of *Improvement Projects*. De taken van dat project erven die keuze. Een losse taak of een brandje deel je zelf in, met `/hw` of `/ip` of bij het afvinken.
- Bij het **afvinken** vraagt Ordener hoe lang je eraan gewerkt hebt. Daarvoor zijn er snelknoppen, of je typt zelf iets als `45m`, `1u30` of `2u`. Hier kun je ook het soort werk kiezen of aanpassen.
- Een fout gemaakt? Open de afgeronde taak. Daar kun je de tijd, het soort werk en de datum van afronden nog aanpassen.

### Agenda
Per dag zie je automatisch wat je afgerond hebt, gegroepeerd per soort werk, met de totale tijd. Onderaan elke dag kun je een notitie typen, die vanzelf bewaard wordt. Met ‹ › blader je door de weken.

### Dashboard
- **Periode**: deze week, vorige week, deze maand, vorige maand, dit jaar, of een eigen periode.
- **Inhoud**:
  - de totale uren per soort werk, met de procentuele verdeling;
  - een grafiek per dag, week of maand;
  - de tijd per project.
- **Nog aan te vullen**: taken zonder tijd of zonder soort werk. Die tellen pas mee als je ze aanvult.
- **Delen met je baas**:
  - **Print / PDF** geeft een nette afdruk van het rapport;
  - **Exporteer naar Excel** maakt een CSV-bestand dat met Belgische instellingen goed opent in Excel. De dagnotities staan onderaan.

### Als app installeren
- **iPhone/iPad**: open de site in **Safari** en kies **Deel (□↑) → Zet op beginscherm**.
- **Android**: open de site in **Chrome** en tik op **Installeren** bovenaan in Ordener, of kies **⋮ → App installeren**.
- **Computer** (Chrome of Edge): klik op **Installeren** bovenaan in Ordener, of op het installatie-icoontje in de adresbalk.

Een geïnstalleerde Ordener opent in een eigen venster, zonder adresbalk, en start ook op als je geen netwerk hebt. Je data heb je dan wel niet, want die staat in de Google Sheet. Een houd-ingedrukt op het icoon geeft snelkoppelingen naar Vandaag, Agenda en Dashboard.

> **Bij een nieuwe frontend-versie**: verhoog `?v=` in `docs/index.html` en `VERSION` in `docs/sw.js` naar hetzelfde getal. Zo krijgt iedereen meteen de nieuwe versie.

## Setup (ongeveer 10 minuten)

### 1. Sheet en script
1. Maak een nieuwe Google Sheet aan, bijvoorbeeld "Ordener DB".
2. Ga naar **Extensies → Apps Script**, verwijder de voorbeeldcode en plak de inhoud van `backend/Code.gs`.
3. Kies de functie `setup` en klik op **Uitvoeren**. Geef de gevraagde rechten.
   Dit maakt de tabbladen aan.

### 2. Wachtwoord instellen
1. Ga in Apps Script naar **Projectinstellingen (⚙) → Scripteigenschappen → Scripteigenschap toevoegen**.
2. Gebruik als eigenschap `PASSWORD` en als waarde je wachtwoord. Kies een lang wachtwoord: de app is publiek bereikbaar.
3. Bij je eerste login wordt het wachtwoord gehasht opgeslagen (`PASSWORD_HASH` en `PASSWORD_SALT`) en verdwijnt `PASSWORD` vanzelf.

Wil je je wachtwoord wijzigen? Voeg dan opnieuw `PASSWORD` toe. Bij de volgende login wordt het nieuwe wachtwoord actief en worden alle oude sessies uitgelogd.

Na 5 foute pogingen is inloggen 15 minuten geblokkeerd.

### 3. Script deployen
1. Klik in Apps Script op **Implementeren → Nieuwe implementatie → Web-app**, met deze instellingen:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
2. Kopieer de URL die eindigt op `/exec`.

> "Iedereen" is nodig zodat de frontend de API kan bereiken. Elke aanvraag wordt gecontroleerd met een sessietoken dat je alleen krijgt na een login met het juiste wachtwoord.

> Pas je `Code.gs` later aan? Plak dan de nieuwe code, sla op en ga naar **Implementeren → Implementaties beheren → ✏️ → Versie: Nieuwe versie → Implementeren**. Zo blijft de URL dezelfde. Ontbrekende kolommen en tabbladen worden automatisch toegevoegd, en je bestaande data blijft staan.

### 4. Frontend configureren en publiceren
1. Vul in `docs/config.js` de `API_URL` in: dat is de `/exec`-URL.
2. Zet de map op GitHub:
   ```bash
   git init && git add . && git commit -m "Ordener"
   gh repo create ordener --public --source=. --push
   ```
3. Ga op GitHub naar **Settings → Pages**. Kies Source *Deploy from a branch*, branch `main` en map `/docs`.
4. Na een minuut staat Ordener op `https://<gebruikersnaam>.github.io/ordener/`.

> In `config.js` staan geen geheimen: alleen de script-URL. Je data staat in je Sheet en is alleen bereikbaar na het inloggen.

## Lokaal draaien
```bash
python3 -m http.server 8765 --directory docs
```
Open daarna <http://localhost:8765>.

## Datamodel
**Projecten**: `id, naam, doel, status (actief|gepauzeerd|afgerond), deadline, aangemaakt, bijgewerkt, werktype (hw|ip)`
**Taken**: `id, titel, type (taak|brand), projectId, status (open|klaar), vandaag (YYYY-MM-DD), deadline, notitie, aangemaakt, afgerond, werktype (hw|ip, leeg = volgens project), duur (minuten)`
**Dagnotities**: `id (datum YYYY-MM-DD), notitie, aangemaakt, bijgewerkt`

Je mag de Sheet gerust zelf bekijken of aanpassen. Wijzig alleen de kolomvolgorde in rij 1 niet.
