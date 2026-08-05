# Agentkolonin

En dashboard där AI-agenter producerar innehåll (text/idéer, bilder som nästa steg),
kan "föröka sig" (starta fler parallella agenter) och där du kan följa allt i realtid.

## Vad den här versionen gör

- Startar och kör flera AI-agenter parallellt, var och en med egen status (arbetar/vilar/fel).
- Agenter producerar innehåll med jämna mellanrum (text via Claude, bild är förberedd men
  kräver att du kopplar in en bildgenereringstjänst).
- En agent kan "föröka sig" och starta en till agent — visas som en linje i dashboarden
  mellan förälder och barn.
- All aktivitet syns i realtid via en aktivitetslogg och en dashboard (Socket.io).
- Max 20 agenter samtidigt som standard, för att undvika skenande API-kostnader.

## Vad den här versionen INTE gör (och varför)

- **Säljer inte innehåll automatiskt.** De flesta marknadsplatser kräver ett mänskligt
  konto och godkänner sällan helt autonom publicering. Just nu loggar du försäljning
  manuellt i dashboarden ("Logga försäljning") när du själv sålt något, t.ex. via Etsy,
  Fiverr eller din egen sida.
- **Betalar inte ut pengar automatiskt.** Ett riktigt utbetalningsflöde kräver en
  betaltjänst (t.ex. Stripe) och att du är registrerad som säljare (i Sverige normalt
  enskild firma eller aktiebolag beroende på volym). Det är inget jag kan skapa åt dig,
  men koden är byggd så att det går att koppla in när du har det på plats.
- **Garanterar ingen inkomst.** Dashboarden visar mål och framsteg mot 200 kr/dygn,
  men det är upp till dig om/var innehållet faktiskt säljs.

## Kom igång lokalt

```bash
npm install
cp .env.example .env   # lägg in din ANTHROPIC_API_KEY
npm start
```

Öppna http://localhost:3000

Utan API-nyckel körs agenterna i **demo-läge** och producerar platshållartext,
så du kan testa hela flödet innan du kopplar in en riktig nyckel.

## Deploy till GitHub + Render

1. **Skapa ett GitHub-repo:**
   ```bash
   git init
   git add .
   git commit -m "Första versionen av Agentkolonin"
   git branch -M main
   git remote add origin https://github.com/DITT-ANVANDARNAMN/agent-farm.git
   git push -u origin main
   ```

2. **Skapa en Web Service på Render:**
   - Gå till https://render.com och skapa konto (kan kopplas direkt till GitHub).
   - "New +" → "Web Service" → välj ditt repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Lägg till miljövariabel `ANTHROPIC_API_KEY` under "Environment" med din nyckel.
   - Render sätter automatiskt `PORT`, ingen ändring behövs där.

3. Efter deploy får du en publik URL, t.ex. `https://agent-farm.onrender.com`,
   där dashboarden är tillgänglig för dig (och alla med länken — lägg till inloggning
   om du vill begränsa åtkomsten, se nästa steg).

## Rimliga nästa steg

- **Lägg till inloggning** innan du delar länken, annars kan vem som helst styra dina
  agenter (och dra din API-kostnad).
- **Koppla in en bildgenereringstjänst** i `agents/agent.js` → `generateContent()`.
- **Koppla in Stripe** för riktiga betalningar när du har ett säljarkonto på plats.
- **Byt JSON-filen mot en riktig databas** (t.ex. Postgres på Render) om du vill
  spara historik längre än en session.

## Teknisk uppbyggnad

```
server.js            Express + Socket.io, REST-API
agents/manager.js     Håller koll på alla agenter, förökning, intäkter
agents/agent.js       En enskild agents livscykel och innehållsproduktion
public/               Dashboard (HTML/CSS/JS, ingen build-process behövs)
data/state.json       Enkel filbaserad persistens (skapas automatiskt)
```
