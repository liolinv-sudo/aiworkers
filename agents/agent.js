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

// Delad hjälpfunktion för att anropa Gemini med valfri prompt och maxlängd.
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
    { name: "Contena (frilansuppdrag)", url: "https://www.contena.co" },
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
        const prompt = isColumn
          ? "Skriv en kort, tydligt märkt åsiktskrönika (ca 500-700 ord) på " +
            "svenska om ett allmänt, tidlöst samhälls- eller politiskt tema " +
            "(t.ex. arbetsliv, teknik, stadsplanering, utbildning). Ta gärna " +
            "en tydlig ståndpunkt, men VIKTIGT: hitta inte på citat, siffror " +
            "eller påståenden om namngivna verkliga personer, företag eller " +
            "specifika verkliga händelser - håll resonemanget generellt och " +
            "principiellt. Svara med en rubrik på första raden, sedan texten."
          : "Skriv en kort förklarande feature-artikel (ca 500-700 ord) på " +
            "svenska inom nyheter, nöje eller sport - t.ex. 'så funkar X', " +
            "en trendspaning, eller bakgrund till ett återkommande fenomen. " +
            "VIKTIGT: detta ska INTE vara en påhittad nyhetshändelse eller " +
            "innehålla fabricerade citat/fakta om namngivna verkliga " +
            "personer eller specifika verkliga händelser - håll det generellt " +
            "och tidlöst. Svara med en rubrik på första raden, sedan texten.";

        const text = await callGeminiText(geminiKey, prompt, 1100);
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
