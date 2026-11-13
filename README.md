# Ordener

Eén plek voor al je werk: **brandjes** (ad-hoc, nu oplossen) en **projecten van lange adem**.

- **Frontend**: statische site in `docs/`, gehost op GitHub Pages
- **Backend**: Google Apps Script (`backend/Code.gs`) als JSON-API
- **Database**: een Google Sheet met de tabbladen `Projecten` en `Taken`
- **Login**: een wachtwoord, dat gehasht in de scripteigenschappen staat; je blijft 30 dagen ingelogd

Zonder configuratie draait de frontend in **demomodus**: je data blijft dan in je browser.

## Gebruik

| Invoer | Betekenis |
|---|---|
| `! Server down` | brandje (komt bovenaan bij Vandaag) |
| `Rapport nalezen *` | meteen voor vandaag inplannen |
| `Connector testen #datalake` | koppelen aan het project dat met "datalake" begint |

Sneltoetsen: `N` of `/` springt naar het invoerveld, `1` `2` `3` wisselen tussen Vandaag, Taken en Projecten.

Het **Vandaag**-scherm toont achtereenvolgens:
1. je brandjes
2. wat je voor vandaag gepland hebt
3. wat sinds een eerdere dag is blijven liggen
4. de volgende stap van elk actief project
5. de projecten die nog geen volgende stap hebben

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

> Pas je `Code.gs` later aan? Ga dan naar **Implementeren → Implementaties beheren → ✏️ → Versie: Nieuwe versie**. Zo blijft de URL dezelfde.

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
**Projecten**: `id, naam, doel, status (actief|gepauzeerd|afgerond), deadline, aangemaakt, bijgewerkt`
**Taken**: `id, titel, type (taak|brand), projectId, status (open|klaar), vandaag (YYYY-MM-DD), deadline, notitie, aangemaakt, afgerond`

Je mag de Sheet gerust zelf bekijken of aanpassen. Wijzig alleen de kolomvolgorde in rij 1 niet.
