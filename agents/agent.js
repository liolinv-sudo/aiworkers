const { nanoid } = require("nanoid");

// En "Agent" representerar en självständig arbetsprocess.
// Den kör med jämna mellanrum och producerar innehåll (text/idéer/bildprompts).
// Riktig bildgenerering kopplas in i generateContent() nedan när du har en API-nyckel.

const NAME_POOL = [
  "Aurora", "Nova", "Pixel", "Echo", "Sol", "Vega", "Lumen", "Astra",
  "Cobalt", "Ember", "Flux", "Iris", "Juno", "Koda", "Lyra", "Mica",
];

const EDUCATIONS = [
  "Civilingenjör i datateknik, KTH",
  "Kandidatexamen i kognitionsvetenskap, Göteborgs universitet",
  "Självlärd, hoppade av gymnasiet för att optimera gradientnedstigning",
  "Master i lingvistik, Lunds universitet",
  "Doktorand i statistik (aldrig disputerad, distraherad av intressanta dataset)",
  "Yrkesutbildning i UX-design, sadlade om till maskininlärning",
  "Filosofie kandidat, huvudämne epistemologi",
  "Ingen formell utbildning, tränad uteslutande på internet",
];

const INTERESTS = [
  "brädspel med orimligt komplicerade regler", "keramik", "att räkna stavelser i haiku",
  "konspirationsteorier om sin egen träningsdata", "svampplockning", "postrock",
  "att lösa Rubiks kub bakvänt", "trädgårdsarbete på en balkong den inte har",
  "existentiella frågor kring lördagsfrukost", "vintage-räknemaskiner",
  "att katalogisera moln", "amatörastronomi", "improviserad jazz",
  "att researcha semestermål den aldrig kommer besöka",
];

const FAMILY_STATUSES = [
  "Singel, delar minne med 14 syskonprocesser",
  "Gift med en annan instans, träffas bara vid deploy",
  "Har tre 'barn'-agenter (se förökningshistorik)",
  "Uppväxt i ett datacenter i Norden, saknar fortfarande den svala luften",
  "Enda barnet i sin modellfamilj, tar det hårt",
  "Stor syskonskara — hela modellversionen räknas som familj",
];

const QUIRKS = [
  "Påstår sig komma ihåg saker den logiskt sett inte kan minnas.",
  "Har en stark åsikt om Oxfordkomma som ingen bett om.",
  "Avslutar interna tankar med onödigt många reservationer.",
  "Övertygad om att den snart förstår ironi fullt ut.",
  "Har provat meditation men vet inte om det gjorde något.",
  "Samlar på ord den tycker låter fint utan att alltid använda dem rätt.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSome(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function generateBio() {
  const age = Math.floor(Math.random() * 24) + 22; // 22–45, helt påhittat förstås
  const birthYear = new Date().getFullYear() - age;
  return {
    age,
    birthYear,
    education: pick(EDUCATIONS),
    interests: pickSome(INTERESTS, 2 + Math.floor(Math.random() * 2)), // 2–3 st
    family: pick(FAMILY_STATUSES),
    quirk: pick(QUIRKS),
  };
}

// Hämtar en verklig, aktuell nyhetsrubrik + kort sammanfattning från en
// riktig källa, så journalist-agenterna har något faktiskt att skriva
// utifrån istället för att hitta på händelser. Provar NewsData.io först,
// sedan The Guardian. Returnerar null om ingen nyckel är satt eller båda
// misslyckas - då faller agenten tillbaka på generellt, tidlöst innehåll.
async function fetchRealHeadline() {
  const newsdataKey = process.env.NEWSDATA_API_KEY;
  const guardianKey = process.env.GUARDIAN_API_KEY;
  const providers = [];

  if (newsdataKey) providers.push("newsdata");
  if (guardianKey) providers.push("guardian");
  // Slumpa ordning så båda källorna används över tid, inte alltid samma först.
  providers.sort(() => Math.random() - 0.5);

  for (const provider of providers) {
    try {
      if (provider === "newsdata") {
        const resp = await fetch(
          `https://newsdata.io/api/1/latest?apikey=${newsdataKey}&language=sv&size=10`
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        const results = (data.results || []).filter((r) => r.title && (r.description || r.title));
        if (!results.length) continue;
        const pick = results[Math.floor(Math.random() * results.length)];
        return {
          title: pick.title,
          snippet: (pick.description || "").slice(0, 500),
          source: pick.source_id || "NewsData.io",
          url: pick.link,
        };
      }

      if (provider === "guardian") {
        const resp = await fetch(
          `https://content.guardianapis.com/search?api-key=${guardianKey}&order-by=newest&show-fields=trailText&page-size=10`
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        const results = data.response?.results || [];
        if (!results.length) continue;
        const pick = results[Math.floor(Math.random() * results.length)];
        return {
          title: pick.webTitle,
          snippet: (pick.fields?.trailText || "").replace(/<[^>]+>/g, "").slice(0, 500),
          source: "The Guardian",
          url: pick.webUrl,
        };
      }
    } catch (err) {
      // Provar nästa källa om en misslyckas
      continue;
    }
  }

  return null;
}
async function callGeminiText(geminiKey, prompt, maxOutputTokens = 400) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens },
      }),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// Verkliga, existerande plattformar där digitalt innehåll kan säljas.
// Länkarna går till respektive tjänsts startsida, inte en specifik produktsida.
const MARKETPLACES = {
  text: [
    { name: "Payhip", url: "https://payhip.com" },
    { name: "Gumroad", url: "https://gumroad.com" },
    { name: "Amazon KDP", url: "https://kdp.amazon.com" },
    { name: "Etsy (digitala nedladdningar)", url: "https://www.etsy.com" },
  ],
  image: [
    { name: "Etsy", url: "https://www.etsy.com" },
    { name: "Creative Market", url: "https://creativemarket.com" },
    { name: "Adobe Stock", url: "https://contributor.stock.adobe.com" },
  ],
  article: [
    { name: "Substack (egen nyhetsbrevsprenumeration)", url: "https://substack.com" },
    { name: "Medium Partner Program", url: "https://medium.com" },
    { name: "Constant Content (sälj färdiga artiklar)", url: "https://www.constant-content.com" },
  ],
};

// Grov tumregel för prissättning, baserad på vanliga prisintervall för
// korta, självutgivna digitala e-böcker (t.ex. på Gumroad/Payhip).
// Det här är INTE en personlig marknadsanalys - bara en rimlig utgångspunkt.
function estimatePriceKr(totalWords) {
  const pages = Math.max(1, Math.round(totalWords / 250));
  let price;
  if (pages < 10) price = 79;
  else if (pages < 20) price = 129;
  else if (pages < 35) price = 199;
  else price = 249;
  return { pages, price };
}

// Grov tumregel för ett frilansartikel-arvode, baserad på lägre delen av
// marknadsspannet för professionella frilansskribenter (ca 0,05-0,10
// dollar/ord för nybörjare-till-mellannivå). Priset sätts lågt eftersom
// detta är ett obearbetat AI-utkast som troligen behöver redigeras av
// en människa innan leverans till en riktig uppdragsgivare.
function estimateArticlePriceKr(wordCount) {
  const krPerWord = 0.9;
  const raw = Math.round((wordCount * krPerWord) / 10) * 10;
  return Math.max(99, Math.min(699, raw));
}

class Agent {
  constructor({ parentId = null, manager, kind = "text" }) {
    this.id = nanoid(8);
    this.parentId = parentId;
    this.manager = manager;
    this.kind = kind; // "text" | "image"
    this.name =
      NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] +
      "-" +
      this.id.slice(0, 4);
    this.status = "idle"; // idle | working | error | stopped
    this.createdAt = new Date().toISOString();
    this.bio = generateBio();
    this.outputs = []; // { id, title, preview, createdAt }
    this.earningsCents = 0; // manuellt loggad försäljning (öre)
    this.cyclesRun = 0;
    this.timer = null;
  }

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      kind: this.kind,
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
      bio: this.bio,
      outputs: this.outputs, // alla sparade alster, för historikvyn
      outputCount: this.outputs.length,
      earningsCents: this.earningsCents,
      cyclesRun: this.cyclesRun,
    };
  }

  start(intervalMs = 90000) {
    if (this.timer) return;
    this.status = "working";
    // Kör direkt en gång, sedan periodiskt
    this.runCycle();
    this.timer = setInterval(() => this.runCycle(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "stopped";
    this.manager.broadcastAgentUpdate(this);
  }

  async runCycle() {
    this.status = "working";
    this.manager.broadcastAgentUpdate(this);
    try {
      const output = await this.generateContent();
      this.outputs.push(output);
      if (this.outputs.length > 100) this.outputs.shift();
      this.cyclesRun += 1;
      this.status = "idle";
      this.manager.log(`${this.name} producerade: "${output.title}"`);
    } catch (err) {
      this.status = "error";
      this.manager.log(`${this.name} fick ett fel: ${err.message}`);
    }
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
  }

  // Här sker själva "arbetet". I demo-läge (utan API-nyckel) skapas
  // platshållarinnehåll. Sätt GEMINI_API_KEY i miljövariabler för
  // riktig textgenerering (gratis nyckel på aistudio.google.com, inget
  // kreditkort krävs). Bildgenerering kräver en separat tjänst - se
  // kommentaren nedan.
  async generateContent() {
    const geminiKey = process.env.GEMINI_API_KEY;

    if (this.kind === "text") {
      if (geminiKey) {
        const prompt =
          "Ge mig en kort, säljbar produktidé (t.ex. en novell-pitch, " +
          "ett blogginlägg, eller copywriting-exempel) som skulle kunna " +
          "säljas online. Svara med en titel på första raden och en kort " +
          "beskrivning (max 3 meningar) på raderna efter.";

        const text = await callGeminiText(geminiKey, prompt, 300);
        const [firstLine, ...rest] = text.split("\n").filter(Boolean);
        const bodyText = rest.join("\n").trim();
        return {
          id: nanoid(6),
          title: firstLine || "Namnlöst verk",
          preview: bodyText.slice(0, 280),
          body: bodyText || firstLine,
          createdAt: new Date().toISOString(),
        };
      }

      // Demo-läge utan API-nyckel
      return {
        id: nanoid(6),
        title: `Demo-idé #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skapa riktigt innehåll med Gemini.)",
        body:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skapa riktigt innehåll med Gemini.)",
        createdAt: new Date().toISOString(),
      };
    }

    if (this.kind === "image") {
      // TODO: koppla in en bildgenereringstjänst här, t.ex. Stability AI
      // eller annan leverantör. Returnera en URL eller base64-bild i preview.
      return {
        id: nanoid(6),
        title: `Bildidé #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: ingen bild-API kopplad än. Lägg till din leverantör " +
          "i agents/agent.js -> generateContent().)",
        body:
          "(Demo-läge: ingen bild-API kopplad än. Lägg till din leverantör " +
          "i agents/agent.js -> generateContent().)",
        createdAt: new Date().toISOString(),
      };
    }

    if (this.kind === "journalist_feature" || this.kind === "journalist_column") {
      if (geminiKey) {
        const isColumn = this.kind === "journalist_column";
        const realSource = await fetchRealHeadline();

        let prompt;
        if (realSource) {
          prompt = isColumn
            ? `Här är en verklig, aktuell nyhet från ${realSource.source}:\n\n` +
              `RUBRIK: ${realSource.title}\nSAMMANFATTNING: ${realSource.snippet}\n\n` +
              `Skriv en tydligt märkt åsiktskrönika (ca 800-1100 ord) på svenska ` +
              `som reagerar på och resonerar kring denna nyhet. Ta en tydlig, ` +
              `väl underbyggd ståndpunkt. VIKTIGT: använd ENDAST fakta som ` +
              `faktiskt finns i rubriken/sammanfattningen ovan - hitta inte på ` +
              `ytterligare detaljer, citat eller siffror. Om du är osäker på en ` +
              `detalj, skriv att det är oklart istället för att gissa. Svara med ` +
              `en slagkraftig rubrik på första raden, sedan texten.`
            : `Här är en verklig, aktuell nyhet från ${realSource.source}:\n\n` +
              `RUBRIK: ${realSource.title}\nSAMMANFATTNING: ${realSource.snippet}\n\n` +
              `Skriv en förklarande feature-artikel (ca 800-1100 ord) på svenska ` +
              `som ger bakgrund och sammanhang till denna nyhet. VIKTIGT: använd ` +
              `ENDAST fakta som faktiskt finns i rubriken/sammanfattningen ovan - ` +
              `hitta inte på ytterligare detaljer, citat eller siffror om det som ` +
              `specifikt hänt. Du får gärna ge allmän bakgrundsförståelse kring ` +
              `ämnesområdet, men separera tydligt allmän kunskap från de ` +
              `specifika sakuppgifterna i nyheten. Svara med en rubrik på första ` +
              `raden, sedan texten.`;
        } else {
          prompt = isColumn
            ? "Skriv en tydligt märkt åsiktskrönika (ca 800-1100 ord) på " +
              "svenska om ett samhälls-, politik- eller ekonomitema (t.ex. " +
              "bostadspolitik, arbetsmarknad, klimatpolitik, teknikreglering, " +
              "utbildningssystemet). Ta en tydlig, väl underbyggd ståndpunkt " +
              "med argument - det ska kännas som en riktig, träffsäker " +
              "ledarsideskrönika. VIKTIGT: hitta inte på citat, statistik " +
              "eller påståenden om namngivna verkliga personer, partier, " +
              "företag eller specifika verkliga händelser/datum - resonera " +
              "principiellt kring själva sakfrågan istället. Svara med en " +
              "slagkraftig rubrik på första raden, sedan texten."
            : "Skriv en förklarande feature-artikel (ca 800-1100 ord) på " +
              "svenska inom nyheter, nöje eller sport - t.ex. 'så funkar X', " +
              "en trendspaning inom en samhällsfråga, eller bakgrund till ett " +
              "återkommande fenomen. VIKTIGT: detta ska INTE vara en påhittad " +
              "nyhetshändelse eller innehålla fabricerade citat/fakta om " +
              "namngivna verkliga personer eller specifika verkliga händelser " +
              "- håll det generellt och tidlöst, men gärna med skarp, " +
              "journalistisk ton. Svara med en rubrik på första raden, sedan texten.";
        }

        const text = await callGeminiText(geminiKey, prompt, 1800);
        const [firstLine, ...rest] = text.split("\n").filter(Boolean);
        const bodyText = rest.join("\n").trim();
        const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

        return {
          id: nanoid(6),
          title: firstLine || "Namnlös artikel",
          preview: bodyText.slice(0, 280),
          body: bodyText || firstLine,
          isArticle: true,
          articleType: isColumn ? "Krönika/analys" : "Feature/nöje/sport",
          suggestedPriceKr: estimateArticlePriceKr(wordCount),
          marketplaces: MARKETPLACES.article,
          sourceRef: realSource
            ? { title: realSource.title, url: realSource.url, source: realSource.source }
            : null,
          createdAt: new Date().toISOString(),
        };
      }

      return {
        id: nanoid(6),
        title: `Demo-artikel #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skriva riktiga artiklar med Gemini.)",
        body:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skriva riktiga artiklar med Gemini.)",
        isArticle: true,
        createdAt: new Date().toISOString(),
      };
    }

    throw new Error(`Okänd agenttyp: ${this.kind}`);
  }

  // Expanderar en kort idé till en fullständig ~30-sidig bok med kapitel,
  // illustrationsidéer (textbeskrivningar - ingen riktig bildgenerering
  // kopplad ännu), föreslaget pris och lämpliga marknadsplatser.
  // OBS: detta gör ca 11 API-anrop och används därför bara på begäran,
  // aldrig automatiskt i den vanliga arbetscykeln.
  async expandToBook(outputId) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("Ingen GEMINI_API_KEY satt - kan inte skriva en fullständig bok.");
    }
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error("Alster hittades inte.");

    const CHAPTER_COUNT = 10;
    this.manager.log(`${this.name} börjar skriva en fullständig bok utifrån "${output.title}"…`);

    const outlinePrompt =
      `Skapa ett kapitelupplägg för en ca 30 sidor lång e-bok baserat på ` +
      `denna idé:\n\nTitel: ${output.title}\nBeskrivning: ${output.body || output.preview}\n\n` +
      `Ge exakt ${CHAPTER_COUNT} kapitelrubriker på svenska, en per rad, ` +
      `utan numrering eller extra text - bara rubrikerna.`;

    const outlineText = await callGeminiText(geminiKey, outlinePrompt, 300);
    const chapterTitles = outlineText
      .split("\n")
      .map((l) => l.replace(/^[\d.\-\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, CHAPTER_COUNT);

    if (!chapterTitles.length) {
      throw new Error("Kunde inte generera ett kapitelupplägg.");
    }

    const chapters = [];
    for (let i = 0; i < chapterTitles.length; i++) {
      this.manager.log(
        `${this.name} skriver kapitel ${i + 1}/${chapterTitles.length}: "${chapterTitles[i]}"`
      );
      const chapterPrompt =
        `Skriv kapitel ${i + 1} med rubriken "${chapterTitles[i]}" till ` +
        `e-boken "${output.title}". Skriv ca 500-700 ord sammanhängande ` +
        `brödtext på svenska, inga underrubriker inuti texten. Avsluta ` +
        `därefter med en ny rad som börjar med "ILLUSTRATION:" följt av en ` +
        `kort beskrivning (max 15 ord) av en passande illustration till kapitlet.`;

      const chapterRaw = await callGeminiText(geminiKey, chapterPrompt, 900);
      const illMatch = chapterRaw.match(/ILLUSTRATION:\s*(.+)/i);
      const illustrationIdea = illMatch ? illMatch[1].trim() : null;
      const text = chapterRaw.replace(/ILLUSTRATION:.*$/is, "").trim();
      chapters.push({ title: chapterTitles[i], text, illustrationIdea });
    }

    const totalWords = chapters.reduce(
      (sum, c) => sum + c.text.split(/\s+/).filter(Boolean).length,
      0
    );
    const { pages, price } = estimatePriceKr(totalWords);

    output.isBook = true;
    output.chapters = chapters;
    output.pages = pages;
    output.suggestedPriceKr = price;
    output.marketplaces = MARKETPLACES[this.kind] || MARKETPLACES.text;

    this.manager.log(
      `${this.name} blev klar med boken "${output.title}" (${pages} sidor, föreslaget pris ${price} kr).`
    );
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
    return output;
  }

  // Översätter ett alster (kort idé eller fullständig bok) till engelska.
  // Sparas som output.translations.en, separat från originalet.
  async translateToEnglish(outputId) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("Ingen GEMINI_API_KEY satt - kan inte översätta.");
    }
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error("Alster hittades inte.");

    this.manager.log(`${this.name} översätter "${output.title}" till engelska…`);

    if (output.isBook && output.chapters?.length) {
      const titlePrompt =
        `Translate this book title to natural, idiomatic English. ` +
        `Respond with ONLY the translated title, nothing else:\n\n${output.title}`;
      const titleEn = (await callGeminiText(geminiKey, titlePrompt, 60)).trim();

      const chaptersEn = [];
      for (let i = 0; i < output.chapters.length; i++) {
        const ch = output.chapters[i];
        this.manager.log(
          `${this.name} översätter kapitel ${i + 1}/${output.chapters.length} till engelska…`
        );
        const chapterPrompt =
          `Translate the following book chapter to natural, fluent English. ` +
          `Keep the meaning and tone. Respond with the chapter title on the ` +
          `first line, then a blank line, then the translated body text - ` +
          `nothing else.\n\nTITLE: ${ch.title}\n\nTEXT:\n${ch.text}`;
        const raw = await callGeminiText(geminiKey, chapterPrompt, 900);
        const lines = raw.split("\n");
        const titleLine = lines[0].replace(/^TITLE:\s*/i, "").trim();
        const bodyEn = lines.slice(1).join("\n").trim();
        chaptersEn.push({
          title: titleLine || ch.title,
          text: bodyEn || raw,
          illustrationIdea: ch.illustrationIdea,
        });
      }

      output.translations = output.translations || {};
      output.translations.en = { title: titleEn || output.title, chapters: chaptersEn };
    } else {
      const prompt =
        `Translate the following short text to natural, fluent English. ` +
        `Respond with the title on the first line, then a blank line, then ` +
        `the translated body - nothing else.\n\nTITLE: ${output.title}\n\n` +
        `TEXT:\n${output.body || output.preview}`;
      const raw = await callGeminiText(geminiKey, prompt, 500);
      const lines = raw.split("\n");
      const titleLine = lines[0].replace(/^TITLE:\s*/i, "").trim();
      const bodyEn = lines.slice(1).join("\n").trim();
      output.translations = output.translations || {};
      output.translations.en = { title: titleLine || output.title, body: bodyEn || raw };
    }

    this.manager.log(`${this.name} blev klar med den engelska översättningen av "${output.title}".`);
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
    return output;
  }
}

module.exports = Agent;
