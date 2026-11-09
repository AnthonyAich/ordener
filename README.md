# Ordener

Eén plek voor al je werk: **brandjes** (ad-hoc, nu oplossen) en **projecten van lange adem**.

- **Frontend**: statische site in `docs/`, gehost op GitHub Pages
- **Backend**: Google Apps Script (`backend/Code.gs`) als JSON-API
- **Database**: een Google Sheet met de tabbladen `Projecten` en `Taken`
- **Login**: Google Sign-In; alleen e-mailadressen in `ALLOWED_EMAILS` komen binnen

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

## Setup (ongeveer 15 minuten)

### 1. Sheet en script
1. Maak een nieuwe Google Sheet aan, bijvoorbeeld "Ordener DB".
2. Ga naar **Extensies → Apps Script**, verwijder de voorbeeldcode en plak de inhoud van `backend/Code.gs`.
3. Kies de functie `setup` en klik op **Uitvoeren**. Geef de gevraagde rechten.
   Dit maakt de tabbladen aan en zet je eigen e-mailadres in `ALLOWED_EMAILS`.

### 2. Google OAuth Client ID (voor de login)
1. Ga naar <https://console.cloud.google.com/> en maak een nieuw project aan, bijvoorbeeld "Ordener".
2. Ga naar **APIs & Services → OAuth consent screen**. Kies *External*, vul een naam en je e-mailadres in en voeg jezelf toe als test user.
3. Ga naar **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: *Web application*
   - **Authorized JavaScript origins**:
     - `https://<jouw-github-gebruikersnaam>.github.io`
     - `http://localhost:8765` (om lokaal te testen)
4. Kopieer de **Client ID**.
5. Ga in Apps Script naar **Projectinstellingen (⚙) → Scripteigenschappen** en zet `CLIENT_ID` op die waarde.
   Wil je extra accounts toelaten? Voeg ze dan komma-gescheiden toe aan `ALLOWED_EMAILS`.

### 3. Script deployen
1. Klik in Apps Script op **Implementeren → Nieuwe implementatie → Web-app**, met deze instellingen:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
2. Kopieer de URL die eindigt op `/exec`.

> "Iedereen" is nodig zodat de frontend de API kan bereiken. Elke aanvraag wordt gecontroleerd met een sessietoken dat alleen na een geldige Google-login van een toegelaten account wordt uitgegeven.

> Pas je `Code.gs` later aan? Ga dan naar **Implementeren → Implementaties beheren → ✏️ → Versie: Nieuwe versie**. Zo blijft de URL dezelfde.

### 4. Frontend configureren en publiceren
1. Vul in `docs/config.js` de `API_URL` (de `/exec`-URL) en de `GOOGLE_CLIENT_ID` in.
2. Zet de map op GitHub:
   ```bash
   git init && git add . && git commit -m "Ordener"
   gh repo create ordener --public --source=. --push
   ```
3. Ga op GitHub naar **Settings → Pages**. Kies Source *Deploy from a branch*, branch `main` en map `/docs`.
4. Na een minuut staat Ordener op `https://<gebruikersnaam>.github.io/ordener/`.

> In `config.js` staan geen geheimen: de Client ID en de script-URL zijn publiek. Je data staat in je Sheet en is alleen bereikbaar na het inloggen.

## Lokaal draaien
```bash
python3 -m http.server 8765 --directory docs
```
Open daarna <http://localhost:8765>.

## Datamodel
**Projecten**: `id, naam, doel, status (actief|gepauzeerd|afgerond), deadline, aangemaakt, bijgewerkt`
**Taken**: `id, titel, type (taak|brand), projectId, status (open|klaar), vandaag (YYYY-MM-DD), deadline, notitie, aangemaakt, afgerond`

Je mag de Sheet gerust zelf bekijken of aanpassen. Wijzig alleen de kolomvolgorde in rij 1 niet.
