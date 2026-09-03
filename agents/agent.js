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
async function callGeminiText(geminiKey, prompt, maxOutputTokens = 400, retriesLeft = 3) {
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
    // 503 (överbelastad) och 429 (för många anrop) är oftast TILLFÄLLIGA -
    // Google rekommenderar själva att man försöker igen. Backa av med en
    // kort väntan och försök upp till 3 gånger innan vi ger upp helt, så
    // att en hel bok/artikel inte spricker på grund av en enstaka
    // tillfällig kapacitetstopp hos Gemini.
    if ((resp.status === 503 || resp.status === 429) && retriesLeft > 0) {
      const waitMs = (4 - retriesLeft) * 5000 + 5000; // 5s, 10s, 15s
      await sleep(waitMs);
      return callGeminiText(geminiKey, prompt, maxOutputTokens, retriesLeft - 1);
    }
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
  video: [
    { name: "YouTube (annonsintäkter)", url: "https://www.youtube.com" },
    { name: "Storyblocks (stockvideo)", url: "https://www.storyblocks.com" },
    { name: "Pond5 (stockvideo)", url: "https://www.pond5.com" },
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

// Extraherar "TAGGAR: ..." och "UNDERRUBRIK: ..." rader ur en Gemini-
// respons och returnerar {tags, subtitle, cleanedText} där båda raderna
// är borttagna från texten.
function extractTags(rawText) {
  const tagMatch = rawText.match(/TAGGAR:\s*(.+)/i);
  const tags = tagMatch
    ? tagMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const subMatch = rawText.match(/UNDERRUBRIK:\s*(.+)/i);
  const subtitle = subMatch ? subMatch[1].trim() : "";
  const cleanedText = rawText
    .replace(/TAGGAR:.*$/im, "")
    .replace(/UNDERRUBRIK:.*$/im, "")
    .trim();
  return { tags, subtitle, cleanedText };
}

// Bygger en URL till Pollinations.ai:s genuint gratis, nyckellösa
// bildgenererings-API. Ingen server-side anrop behövs - detta ÄR bilden,
// webbläsaren/PDF:en hämtar den direkt från URL:en.
function buildImageUrl(prompt, { width = 1024, height = 1024 } = {}) {
  // Enkel, stabil "seed" baserad på prompten så samma idé alltid ger
  // samma bild (istället för en ny slumpmässig bild varje gång URL:en nås).
  let seed = 0;
  for (let i = 0; i < prompt.length; i++) {
    seed = (seed * 31 + prompt.charCodeAt(i)) >>> 0;
  }
  // Pollinations backend kräver seed <= 2147483647 (max signat 32-bitstal).
  // Maska bort högsta biten så vi aldrig hamnar över den gränsen.
  seed = seed & 0x7fffffff;
  const encoded = encodeURIComponent(prompt.slice(0, 400));
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&referrer=agentkolonin.app`;
}

// Hämtar en bild från Pollinations och sparar den som base64 REDAN NÄR
// innehållet skapas - istället för att hämta den live varje gång någon
// klickar på "ladda ner PDF". Det gör PDF-nedladdningen omedelbar och
// pålitlig oavsett Pollinations svarstid, och löser problemet med att
// bilder saknades eller att nedladdningen tog för lång tid och avbröts.
async function fetchImageAsBase64(url, retriesLeft = 1) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      if (retriesLeft > 0) {
        await sleep(8000);
        return fetchImageAsBase64(url, retriesLeft - 1);
      }
      return null;
    }
    // Pollinations kan ibland svara med statuskod 200 men skicka ett
    // textfel (t.ex. vid intern överbelastning) istället för riktig
    // bilddata. Utan den här kontrollen sparades felmeddelandet som om
    // det vore en giltig bild, vilket senare gjorde att PDF-inbäddningen
    // tyst misslyckades (bilden bara saknades, utan synligt fel).
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      if (retriesLeft > 0) {
        await sleep(8000);
        return fetchImageAsBase64(url, retriesLeft - 1);
      }
      return null;
    }
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (err) {
    if (retriesLeft > 0) {
      await sleep(8000);
      return fetchImageAsBase64(url, retriesLeft - 1);
    }
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hämtar ett RIKTIGT stockfoto (inte AI-genererat) från Pexels, gratis och
// nyckelbaserat (200 anrop/timme, ingen vattenstämpel, fri kommersiell
// användning). Returnerar {url, base64, photographer} eller null om inget
// hittades/nyckel saknas.
async function fetchStockPhoto(query) {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey) return null;
  try {
    const resp = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: pexelsKey } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const photo = data.photos?.[0];
    if (!photo) return null;
    const url = photo.src.large;
    const base64 = await fetchImageAsBase64(url);
    return { url, base64, photographer: photo.photographer };
  } catch (err) {
    return null;
  }
}

// Grov tumregel för bildpris, baserad på vanlig prissättning för digital
// konst på Etsy (8-15 dollar/72-160 kr för en "quality print"; 2-3 dollar
// signalerar enligt säljarguider "disposability"). Sätts i den nedre delen
// eftersom det är AI-genererat utan mänsklig efterbearbetning/kuration.
function estimateImagePriceKr() {
  return 59;
}

// Grov tumregel för videopris - korta AI-berättande bildspel ligger lågt
// jämfört med redigerat innehåll, eftersom ingen mänsklig efterbearbetning
// skett.
function estimateVideoPriceKr() {
  return 99;
}

// ---- JSON2Video-integration ----
// Genererar INTE ny video med AI (ingen gratis sådan tjänst finns) - utan
// sätter ihop redan skapade bilder (Pollinations) + uppläst text (TTS) +
// undertexter till en riktig videofil, via JSON2Video:s gratis nyckelbaserade
// nivå (600 sekunders rendering, inget kreditkort). Se
// https://json2video.com/docs/v2/ för fullständig dokumentation.

async function submitJson2VideoJob(scenes, manager) {
  const apiKey = process.env.JSON2VIDEO_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://api.json2video.com/v2/movies", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "sd", quality: "medium", scenes }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      manager?.log(`JSON2Video avvisade jobbet (${resp.status}): ${text.slice(0, 300)}`);
      return null;
    }
    const data = JSON.parse(text);
    if (!data.project) {
      manager?.log(`JSON2Video svarade utan projekt-id: ${text.slice(0, 300)}`);
    }
    return data.project || null;
  } catch (err) {
    manager?.log(`JSON2Video-anropet kraschade: ${err.message}`);
    return null;
  }
}

// Pollar JSON2Video tills videon är klar (eller det tar för lång tid).
// Renderingen sker asynkront hos dem, så vi kollar med jämna mellanrum.
// Loggar det faktiska svaret vid problem, så felsökning blir möjlig utan
// att behöva gissa vad som gick fel.
async function pollJson2VideoJob(projectId, manager, maxAttempts = 30) {
  const apiKey = process.env.JSON2VIDEO_API_KEY;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(15000); // vänta 15 sek mellan varje koll (upp till 7,5 min totalt)
    try {
      const resp = await fetch(`https://api.json2video.com/v2/movies?project=${projectId}`, {
        headers: { "x-api-key": apiKey },
      });
      const text = await resp.text();
      if (!resp.ok) {
        manager?.log(`JSON2Video-statuskoll misslyckades (${resp.status}): ${text.slice(0, 300)}`);
        continue;
      }
      const data = JSON.parse(text);
      const movie = data.movie || data;
      if (movie.status === "done" || movie.status === "success") {
        return movie.url || movie.output?.url || null;
      }
      if (movie.status === "error" || movie.status === "failed") {
        manager?.log(`JSON2Video-rendering misslyckades: ${text.slice(0, 400)}`);
        return null;
      }
      manager?.log(`JSON2Video: status "${movie.status || "okänd"}" (försök ${i + 1}/${maxAttempts})…`);
    } catch (err) {
      manager?.log(`JSON2Video-statuskoll kraschade: ${err.message}`);
    }
  }
  manager?.log(`JSON2Video: gav upp efter ${maxAttempts} försök - videon blev inte klar i tid.`);
  return null;
}

const IMAGE_IDEA_FALLBACKS = [
  "en ensam fyr vid havet i skymningsljus, akvarellstil",
  "ett frodigt regnskogslandskap sett uppifrån, varma gröna toner",
  "ett futuristiskt stadslandskap i neonljus på natten",
  "en katt som sitter i ett regnigt fönster, mjukt ljus",
  "abstrakt geometrisk konst i varma solnedgångsfärger",
  "ett stilleben med frukt och blommor i klassisk oljemålningsstil",
  "ett minimalistiskt bergslandskap i pastellfärger",
  "en gammal bokhandel fylld med böcker, varmt ljus",
];

// Kategorier och genrer en textagent kan specialisera sig inom. "format"
// avgör vilken formatfamilj bok-expansionen använder (prosa/poesi/recept/
// manus), och "illustratable" styr om "illustrerad"-kryssrutan visas.
const GENRE_TAXONOMY = {
  "Barnbok": {
    subgenres: ["Bilderbok (yngre barn)", "Kapitelbok (mellanstadiet)", "Lärobok för barn"],
    format: "prose",
    illustratable: true,
  },
  "Poesi": {
    subgenres: ["Lyrik", "Haiku-samling", "Rimsagor", "Sonetter"],
    format: "poetry",
    illustratable: true,
  },
  "Skönlitteratur": {
    subgenres: [
      "Kriminalroman", "Pusseldeckare", "Historisk roman", "Romantik",
      "Science fiction", "Fantasy", "Litterär roman", "Skräck",
    ],
    format: "prose",
    illustratable: false,
  },
  "Facklitteratur": {
    subgenres: [
      "Självhjälp", "Biografi", "Populärvetenskap", "Matematikbok",
      "Astronomibok (lågstadiet)", "Historiebok", "Ekonomi/privatekonomi",
    ],
    format: "prose",
    illustratable: true,
  },
  "Kokbok": {
    subgenres: ["Vardagsmat", "Bakning", "Veganskt", "Internationellt kök", "Snabbmat"],
    format: "recipe",
    illustratable: true,
  },
  "Teatermanus": {
    subgenres: ["Komedi", "Drama", "Barnteater", "Tragedi"],
    format: "script",
    illustratable: false,
  },
  "TV-seriemanus": {
    subgenres: ["Sitcom", "Dramaserie", "Humorserie", "Dokusåpa-format"],
    format: "script",
    illustratable: false,
  },
  "Filmmanus": {
    subgenres: ["Kortfilm", "Thriller", "Komedi", "Drama"],
    format: "script",
    illustratable: false,
  },
  "Religiös skrift": {
    subgenres: ["Andaktstexter", "Liknelser", "Bön och meditation", "Etiska reflektioner"],
    format: "prose",
    illustratable: false,
  },
};

// Frontend behöver bara bild-URL:erna för att visa <img>-taggar - de tunga
// base64-fälten behövs bara på servern (för PDF-generering). Att skicka
// dem via socket.io i varje uppdatering gjorde payloaden onödigt stor och
// långsam. Den här funktionen används bara för DATA SOM SKICKAS TILL
// KLIENTEN - den faktiska this.outputs-arrayen på servern behåller all
// base64-data orört, så PDF-routen fortfarande hittar den.
function stripBase64ForClient(output) {
  const { imageBase64, coverImageBase64, characterImageBase64, chapters, ...rest } = output;
  if (chapters) {
    rest.chapters = chapters.map(({ illustrationBase64, ...ch }) => ch);
  }
  return rest;
}

class Agent {
  constructor({ parentId = null, manager, kind = "text", genre = null, imageStyle = null }) {
    this.id = nanoid(8);
    this.parentId = parentId;
    this.manager = manager;
    this.kind = kind; // "text" | "image" | "journalist_feature" | "journalist_column"
    this.genre = genre; // { category, subgenre, illustrated } | null (null = generisk textagent)
    this.imageStyle = imageStyle; // "photo" | "illustration" | null (bara relevant för kind "image")
    this.name =
      NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] +
      "-" +
      this.id.slice(0, 4);
    this.status = "idle"; // idle | working | error | stopped
    this.archived = false; // dold från huvudsidan, men historiken finns kvar i biblioteket
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
      genre: this.genre,
      imageStyle: this.imageStyle,
      name: this.name,
      status: this.status,
      archived: this.archived,
      createdAt: this.createdAt,
      bio: this.bio,
      outputs: this.outputs.map(stripBase64ForClient), // se kommentar nedan
      outputCount: this.outputs.length,
      earningsCents: this.earningsCents,
      cyclesRun: this.cyclesRun,
    };
  }

  // Återställer en agents identitet och historik från tidigare sparad data
  // (t.ex. från Upstash vid serverstart). Behåller den nya instansens
  // manager/timer-hantering, men skriver över allt annat med det sparade.
  restoreFrom(saved) {
    this.id = saved.id;
    this.parentId = saved.parentId ?? this.parentId;
    this.kind = saved.kind || this.kind;
    this.genre = saved.genre ?? this.genre;
    this.imageStyle = saved.imageStyle ?? this.imageStyle;
    this.name = saved.name || this.name;
    this.createdAt = saved.createdAt || this.createdAt;
    this.bio = saved.bio || this.bio;
    this.outputs = saved.outputs || [];
    this.earningsCents = saved.earningsCents || 0;
    this.cyclesRun = saved.cyclesRun || 0;
    this.archived = !!saved.archived;
    // Om agenten var stoppad (eller dold) innan omstarten, håll den
    // stoppad - annars startar start() om den normalt igen.
    this.status = saved.status === "stopped" || saved.archived ? "stopped" : "idle";
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

// Bygger en idé-prompt anpassad efter vald kategori/genre. Formatfamiljen
// (prosa/poesi/recept/manus) styr vilken typ av idé som efterfrågas.
function buildGenreIdeaPrompt(genre, recentTitles) {
  const config = GENRE_TAXONOMY[genre.category] || { format: "prose" };
  const label = genre.subgenre ? `${genre.category} (${genre.subgenre})` : genre.category;
  const avoid = recentTitles.length
    ? ` Undvik teman som liknar dessa redan använda titlar: ${recentTitles.join("; ")}.`
    : "";

  const familyInstruction = {
    poetry: "Ge en idé till en diktsamling - ett tema, en känsla och en röst, inte en enskild färdig dikt.",
    recipe: "Ge en idé till en maträtt/ett recept som skulle passa i en kokbok inom denna genre.",
    script: "Ge en premiss/logline till ett manus - en kort sammanfattning av handling och huvudkaraktär(er).",
    prose: "Ge en bokidé - premiss, huvudkaraktär eller ämne.",
  }[config.format];

  return (
    `Du arbetar inom kategorin "${label}". ${familyInstruction} ` +
    `Idén ska kunna säljas online. Svara med en titel på första raden och " +
    "en kort beskrivning (max 3 meningar) på raderna efter. Lägg också " +
    "till en rad som börjar med 'UNDERRUBRIK:' följt av en kort, säljande " +
    "underrubrik (max 12 ord), och en rad som börjar med 'TAGGAR:' följt " +
    "av 3-5 relevanta svenska sökord/ämnesord separerade med kommatecken.` +
    avoid
  );
}

    if (this.kind === "text") {
      if (geminiKey) {
        const recentTitles = this.outputs.slice(-5).map((o) => o.title);
        const prompt = this.genre
          ? buildGenreIdeaPrompt(this.genre, recentTitles)
          : "Ge mig en kort, säljbar produktidé (t.ex. en novell-pitch, " +
            "ett blogginlägg, eller copywriting-exempel) som skulle kunna " +
            "säljas online. Skriv på korrekt, flytande och naturlig " +
            "svenska. Svara med en titel på första raden och en kort " +
            "beskrivning (max 3 meningar) på raderna efter. Lägg också till " +
            "en rad som börjar med 'UNDERRUBRIK:' följt av en kort, säljande " +
            "underrubrik (max 12 ord), och en rad som börjar med 'TAGGAR:' " +
            "följt av 3-5 relevanta svenska sökord/ämnesord separerade med " +
            "kommatecken.";

        const raw = await callGeminiText(geminiKey, prompt, 380);
        const { tags, subtitle, cleanedText } = extractTags(raw);
        const [firstLine, ...rest] = cleanedText.split("\n").filter(Boolean);
        const bodyText = rest.join("\n").trim();
        return {
          id: nanoid(6),
          title: firstLine || "Namnlöst verk",
          subtitle,
          preview: bodyText.slice(0, 280),
          body: bodyText || firstLine,
          tags,
          genre: this.genre,
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
        genre: this.genre,
        createdAt: new Date().toISOString(),
      };
    }

    if (this.kind === "image") {
      let title, description, tags, subtitle;

      // Undvik att Gemini fastnar i samma återkommande teman - skicka med
      // de senaste titlarna och be den explicit variera sig.
      const recentTitles = this.outputs.slice(-5).map((o) => o.title);
      const avoidInstruction = recentTitles.length
        ? ` Undvik teman som liknar dessa redan använda titlar: ${recentTitles.join("; ")}.`
        : "";

      if (geminiKey) {
        const prompt =
          "Ge en kort, kreativ bildidé (t.ex. till ett bokomslag, ett " +
          "konsttryck, eller en illustration) som skulle kunna säljas " +
          "online. Svara med en titel på första raden och en kort visuell " +
          "beskrivning (max 2 meningar - beskriv motiv, stil och färger, " +
          "på engelska för bästa resultat i en bildgenerator) på raden " +
          "efter. Lägg också till en rad som börjar med 'UNDERRUBRIK:' " +
          "följt av en kort svensk underrubrik (max 12 ord), och en rad " +
          "som börjar med 'TAGGAR:' följt av 3-5 relevanta svenska sökord " +
          "separerade med kommatecken." +
          avoidInstruction;

        const raw = await callGeminiText(geminiKey, prompt, 250);
        const extracted = extractTags(raw);
        tags = extracted.tags;
        subtitle = extracted.subtitle;
        const [firstLine, ...rest] = extracted.cleanedText.split("\n").filter(Boolean);
        title = firstLine || "Namnlös bildidé";
        description = rest.join(" ").trim() || firstLine;
      } else {
        // Pollinations kräver ingen nyckel alls, så bildagenten fungerar
        // även helt utan GEMINI_API_KEY - bara med enklare, förvalda idéer.
        const unused = IMAGE_IDEA_FALLBACKS.filter((f) => !recentTitles.some((t) => t.includes(f.slice(0, 15))));
        description = pick(unused.length ? unused : IMAGE_IDEA_FALLBACKS);
        title = `Bildidé #${this.cyclesRun + 1} av ${this.name}`;
        tags = [];
        subtitle = "";
      }

      const stylePrefix =
        this.imageStyle === "illustration"
          ? "illustration, hand-drawn art style, well-proportioned, "
          : this.imageStyle === "photo"
            ? "professional photograph, realistic lighting, natural " +
              "well-proportioned anatomy, correct hands and faces, "
            : "";

      const imageUrl = buildImageUrl(`${stylePrefix}${description}`);
      // Cacha bilden som base64 direkt, så PDF-nedladdning senare blir
      // omedelbar istället för att bero på en live-hämtning från Pollinations.
      const imageBase64 = await fetchImageAsBase64(imageUrl);

      return {
        id: nanoid(6),
        title,
        subtitle,
        preview: description.slice(0, 280),
        body: description,
        tags,
        isImage: true,
        imageUrl,
        imageBase64,
        suggestedPriceKr: estimateImagePriceKr(),
        marketplaces: MARKETPLACES.image,
        createdAt: new Date().toISOString(),
      };
    }

    if (this.kind === "journalist_feature" || this.kind === "journalist_column") {
      if (geminiKey) {
        const isColumn = this.kind === "journalist_column";
        const realSource = await fetchRealHeadline();

        let prompt;
        const tagInstruction =
          " Lägg också till en rad som börjar med 'UNDERRUBRIK:' följt av " +
          "en kort, slagkraftig underrubrik (max 12 ord), och en ny rad " +
          "som börjar med 'TAGGAR:' följt av 3-5 relevanta svenska sökord/" +
          "ämnesord separerade med kommatecken.";

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
              `en slagkraftig rubrik på första raden, sedan texten.` +
              tagInstruction
            : `Här är en verklig, aktuell nyhet från ${realSource.source}:\n\n` +
              `RUBRIK: ${realSource.title}\nSAMMANFATTNING: ${realSource.snippet}\n\n` +
              `Skriv en förklarande feature-artikel (ca 800-1100 ord) på svenska ` +
              `som ger bakgrund och sammanhang till denna nyhet. VIKTIGT: använd ` +
              `ENDAST fakta som faktiskt finns i rubriken/sammanfattningen ovan - ` +
              `hitta inte på ytterligare detaljer, citat eller siffror om det som ` +
              `specifikt hänt. Du får gärna ge allmän bakgrundsförståelse kring ` +
              `ämnesområdet, men separera tydligt allmän kunskap från de ` +
              `specifika sakuppgifterna i nyheten. Svara med en rubrik på första ` +
              `raden, sedan texten.` +
              tagInstruction;
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
              "slagkraftig rubrik på första raden, sedan texten." +
              tagInstruction
            : "Skriv en förklarande feature-artikel (ca 800-1100 ord) på " +
              "svenska inom nyheter, nöje eller sport - t.ex. 'så funkar X', " +
              "en trendspaning inom en samhällsfråga, eller bakgrund till ett " +
              "återkommande fenomen. VIKTIGT: detta ska INTE vara en påhittad " +
              "nyhetshändelse eller innehålla fabricerade citat/fakta om " +
              "namngivna verkliga personer eller specifika verkliga händelser " +
              "- håll det generellt och tidlöst, men gärna med skarp, " +
              "journalistisk ton. Svara med en rubrik på första raden, sedan texten." +
              tagInstruction;
        }

        const raw = await callGeminiText(geminiKey, prompt, 1850);
        const { tags, subtitle, cleanedText } = extractTags(raw);
        const [firstLine, ...rest] = cleanedText.split("\n").filter(Boolean);
        const bodyText = rest.join("\n").trim();
        const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

        return {
          id: nanoid(6),
          title: firstLine || "Namnlös artikel",
          subtitle,
          preview: bodyText.slice(0, 280),
          body: bodyText || firstLine,
          tags,
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

    if (this.kind === "video") {
      const recentTitles = this.outputs.slice(-5).map((o) => o.title);
      const avoidInstruction = recentTitles.length
        ? ` Undvik teman som liknar dessa redan använda titlar: ${recentTitles.join("; ")}.`
        : "";

      if (geminiKey) {
        const prompt =
          "Ge en kort idé till en kort berättande videosnutt (typ ett " +
          "bildspel med uppläst text) som skulle kunna säljas eller " +
          "publiceras online - t.ex. en kort förklarande video, en " +
          "inspirerande minivideo, eller en produktpresentation. Svara med " +
          "en titel på första raden och en kort beskrivning av videons " +
          "innehåll (max 3 meningar) på raderna efter. Skriv på korrekt, " +
          "flytande svenska. Lägg också till en rad som börjar med " +
          "'UNDERRUBRIK:' följt av en kort underrubrik (max 12 ord), och " +
          "en rad som börjar med 'TAGGAR:' följt av 3-5 relevanta svenska " +
          "sökord separerade med kommatecken." +
          avoidInstruction;

        const raw = await callGeminiText(geminiKey, prompt, 300);
        const { tags, subtitle, cleanedText } = extractTags(raw);
        const [firstLine, ...rest] = cleanedText.split("\n").filter(Boolean);
        const bodyText = rest.join(" ").trim();
        return {
          id: nanoid(6),
          title: firstLine || "Namnlös videoidé",
          subtitle,
          preview: bodyText.slice(0, 280),
          body: bodyText || firstLine,
          tags,
          isVideoIdea: true,
          suggestedPriceKr: estimateVideoPriceKr(),
          marketplaces: MARKETPLACES.video,
          createdAt: new Date().toISOString(),
        };
      }

      return {
        id: nanoid(6),
        title: `Demo-videoidé #${this.cyclesRun + 1} av ${this.name}`,
        preview:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skapa riktiga videoidéer med Gemini.)",
        body:
          "(Demo-läge: sätt GEMINI_API_KEY i miljövariablerna på Render " +
          "för att låta agenten skapa riktiga videoidéer med Gemini.)",
        isVideoIdea: true,
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
  async expandToBook(outputId, { chapterCount = null, imageFrequency = null, imageStyle = null } = {}) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("Ingen GEMINI_API_KEY satt - kan inte skriva en fullständig bok.");
    }
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error("Alster hittades inte.");

    const genre = output.genre || this.genre;
    const format = genre ? GENRE_TAXONOMY[genre.category]?.format || "prose" : "prose";
    const illustrated = !!genre?.illustrated;
    const genreLabel = genre ? (genre.subgenre ? `${genre.category} (${genre.subgenre})` : genre.category) : null;

    // Bildstil: "illustration" (tecknad/målad), "photo" (AI-genererat
    // fotorealistiskt), eller "stockphoto" (RIKTIGT foto från Pexels, inte
    // AI-genererat - kräver PEXELS_API_KEY, faller annars tillbaka på "photo").
    const defaultStyle = genre?.category === "Barnbok" ? "illustration" : "photo";
    const validStyles = ["photo", "illustration", "stockphoto"];
    const resolvedImageStyle = validStyles.includes(imageStyle) ? imageStyle : defaultStyle;
    const stylePrefix =
      resolvedImageStyle === "illustration"
        ? "children's book illustration, hand-drawn, warm watercolor style, " +
          "clean simple shapes, well-proportioned characters, "
        : "professional photograph, realistic lighting, high quality, " +
          "natural well-proportioned anatomy, correct hands and faces, ";

    // Enhetlig bildhämtning: stockfoto (Pexels, riktigt foto) om valt och
    // tillgängligt, annars AI-genererad bild (Pollinations) i vald stil.
    const resolveBookImage = async (description, dims) => {
      if (resolvedImageStyle === "stockphoto") {
        const stock = await fetchStockPhoto(description);
        if (stock) return { url: stock.url, base64: stock.base64, credit: stock.photographer };
      }
      const url = buildImageUrl(`${stylePrefix}${description}`, dims);
      const base64 = await fetchImageAsBase64(url);
      await sleep(16000); // säker marginal över Pollinations 15-sek-gräns
      return { url, base64, credit: null };
    };

    const UNIT_WORD = { prose: "kapitel", poetry: "dikt", recipe: "recept", script: "scen" }[format];
    const UNIT_WORD_PLURAL = { prose: "kapitelrubriker", poetry: "dikttitlar", recipe: "receptnamn", script: "scenrubriker" }[format];
    const CHAPTER_COUNT = chapterCount || (format === "recipe" ? 12 : format === "poetry" ? 14 : 10);

    this.manager.log(`${this.name} börjar skriva en fullständig bok utifrån "${output.title}"…`);

    const genreContext = genreLabel ? ` inom kategorin "${genreLabel}"` : "";

    // För PROSA och MANUS - inte poesi/recept som är fristående enheter -
    // behövs en "berättelsebibel" med etablerade fakta (antal karaktärer,
    // namn, viktiga detaljer som klädfärger) SÅ FORT det är en samman-
    // hängande historia, oavsett om boken är illustrerad eller inte.
    // Utan detta drev fakta iväg mellan kapitel (t.ex. skofärg som ändras,
    // eller ett påstått 3-personershushåll som plötsligt blir 4 personer).
    const needsStoryBible = format === "prose" || format === "script";
    const storyBibleInstruction = needsStoryBible
      ? ` Lägg också till en rad som börjar med 'FAKTA:' följt av en kort ` +
        `lista över etablerade fakta som MÅSTE hållas konsekventa genom ` +
        `hela verket - exakt antal huvudkaraktärer, deras namn, och alla ` +
        `specifika detaljer som redan antyds i idén (t.ex. klädfärger, ` +
        `yrken, relationer). Var precis - detta används för att undvika ` +
        `att fakta ändras mellan avsnitt.`
      : "";

    // Om verket dessutom är illustrerat, be även om en visuell beskrivning
    // av huvudpersonen, så Pollinations kan rita samma karaktär varje gång.
    const includeCharacterSheet = illustrated && format === "prose";
    const characterInstruction = includeCharacterSheet
      ? ` Lägg också till en rad som börjar med 'KARAKTÄRER:' följt av en ` +
        `konkret visuell beskrivning (på engelska, max 25 ord) av ` +
        `huvudpersonens utseende - ålder, hårfärg/-typ, kläder, distinkta ` +
        `drag - används för att rita samma karaktär genom hela boken.`
      : "";

    const outlinePrompt =
      `Skapa ett upplägg för ett verk${genreContext}, baserat på denna idé:\n\n` +
      `Titel: ${output.title}\nBeskrivning: ${output.body || output.preview}\n\n` +
      `Ge exakt ${CHAPTER_COUNT} ${UNIT_WORD_PLURAL} på svenska, en per rad, ` +
      `utan numrering eller extra text - bara rubrikerna/namnen. Lägg ` +
      `därefter till en rad som börjar med 'UNDERRUBRIK:' följt av en kort, ` +
      `säljande underrubrik till hela verket (max 12 ord),${storyBibleInstruction}` +
      `${characterInstruction} och en sista rad som börjar med 'TAGGAR:' ` +
      `följt av 3-5 relevanta svenska sökord/ämnesord separerade med kommatecken.`;

    const outlineRaw = await callGeminiText(geminiKey, outlinePrompt, 450);
    const charMatch = outlineRaw.match(/KARAKTÄRER:\s*(.+)/i);
    const characterDescription = charMatch ? charMatch[1].trim() : null;
    const bibleMatch = outlineRaw.match(/FAKTA:\s*(.+)/i);
    const storyBible = bibleMatch ? bibleMatch[1].trim() : null;

    const { tags: bookTags, subtitle: bookSubtitle, cleanedText: outlineTextRaw } = extractTags(outlineRaw);
    const outlineText = outlineTextRaw
      .replace(/KARAKTÄRER:.*$/im, "")
      .replace(/FAKTA:.*$/im, "")
      .trim();
    const chapterTitles = outlineText
      .split("\n")
      .map((l) => l.replace(/^[\d.\-\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, CHAPTER_COUNT);

    if (!chapterTitles.length) {
      throw new Error("Kunde inte generera ett kapitelupplägg.");
    }

    // Skapa en referensbild av huvudkaraktären, om vi fick en beskrivning.
    // Visas som en egen "karaktärssida" och används för att hålla
    // beskrivningen konsekvent i varje kapitels bildprompt.
    let characterImageUrl = null;
    let characterImageBase64 = null;
    if (characterDescription) {
      this.manager.log(`${this.name} skapar en karaktärsbild för konsekvens genom boken…`);
      characterImageUrl = buildImageUrl(
        `${stylePrefix}single full body illustration of one character, ` +
          `standing pose, medium shot, ${characterDescription}, plain ` +
          `simple background, single image, one consistent character only`,
        { width: 800, height: 1000 }
      );
      characterImageBase64 = await fetchImageAsBase64(characterImageUrl);
      await sleep(16000); // säker marginal över Pollinations 15-sek-gräns
    }

    // Instruktion för själva innehållet, anpassad efter formatfamilj.
    const contentInstruction = {
      prose:
        "Skriv ca 500-700 ord sammanhängande brödtext på svenska, inga " +
        "underrubriker inuti texten.",
      poetry:
        "Skriv en dikt på svenska (fri vers eller rim, det du bedömer " +
        "passar bäst) på ca 12-24 rader som fångar temat.",
      recipe:
        "Skriv ett fullständigt recept på svenska: en kort introduktion " +
        "(1-2 meningar), en ingrediensslista (en ingrediens per rad, med " +
        "mängd), och sedan numrerade tillagningssteg.",
      script:
        "Skriv en kort manusscen på svenska i vanligt manusformat: en " +
        "scenrubrik, en kort scenanvisning i kursiv stil, och dialog med " +
        "KARAKTÄRSNAMN i versaler följt av repliken på nästa rad.",
    }[format];

    // Kategorispecifik ton - viktigast för barnböcker (enklare språk) och
    // facklitteratur (pedagogisk tydlighet).
    const categoryOverride =
      genre?.category === "Barnbok"
        ? " VIKTIGT: anpassa språket för barn - korta meningar, enkla och " +
          "konkreta ord, undvik komplicerade bisatser och abstrakta " +
          "begrepp. Avsluta gärna med en tydlig känsla eller ett litet " +
          "lärdomsbudskap."
        : genre?.category === "Facklitteratur"
          ? " VIKTIGT: var pedagogisk - förklara begrepp tydligt med " +
            "konkreta exempel eller liknelser, och avsluta avsnittet med " +
            "en kort sammanfattande poäng."
          : "";

    const languageQualityInstruction =
      " Skriv på korrekt, flytande och naturlig svenska - kontrollera " +
      "grammatik, stavning och ordböjning noga, och undvik onaturliga " +
      "eller direktöversatta formuleringar.";

    const finalContentInstruction = contentInstruction + categoryOverride + languageQualityInstruction;

    // Illustrerade verk (kokbok/barnbok/facklitteratur) får bild till fler
    // enheter (varannan) - annars var tredje, som en trevlig extra touch.
    const illustrationEvery = imageFrequency || (illustrated ? 2 : 3);

    // Prosa och manus ska vara EN sammanhängande berättelse med samma
    // karaktärer genom hela verket - inte fristående variationer på samma
    // premiss (poesi/recept är naturligt fristående enheter, så det gäller
    // dem inte). Vi bygger upp en kort löpande sammanfattning som skickas
    // med i varje ny kapitelprompt.
    const continuityMatters = format === "prose" || format === "script";
    let storySoFar = "";

    const chapters = [];
    for (let i = 0; i < chapterTitles.length; i++) {
      this.manager.log(
        `${this.name} skriver ${UNIT_WORD} ${i + 1}/${chapterTitles.length}: "${chapterTitles[i]}"`
      );

      // De etablerade fakta (FAKTA-raden) finns redan från kapitel 1, INTE
      // bara den löpande sammanfattningen som byggs upp allteftersom -
      // detta var buggen som lät t.ex. skofärger eller antal karaktärer
      // driva iväg mellan avsnitt.
      const factsPart =
        needsStoryBible && storyBible
          ? `ETABLERADE FAKTA som MÅSTE hållas exakt konsekventa genom hela ` +
            `verket (ändra ALDRIG dessa detaljer): ${storyBible}`
          : "";
      const historyPart = storySoFar ? `Vad som hänt hittills: ${storySoFar}` : "";

      const continuityContext =
        continuityMatters && (factsPart || historyPart)
          ? `\n\nDetta är EN sammanhängande berättelse, inte fristående delar.` +
            (factsPart ? `\n${factsPart}` : "") +
            (historyPart ? `\n${historyPart}` : "") +
            `\n\nFortsätt med EXAKT SAMMA huvudkaraktärer, namn, miljö och ` +
            `alla etablerade fakta ovan - hitta inte på nya huvudpersoner, ` +
            `en ny premiss, eller ändra redan nämnda detaljer.`
          : "";

      const summaryInstruction = continuityMatters
        ? ` Avsluta därefter med en rad som börjar med "SAMMANFATTNING:" ` +
          `följt av EN mening som sammanfattar vad som hände i just detta ` +
          `avsnitt och vilka karaktärer som förekom (används för att hålla ` +
          `ihop berättelsen till nästa del).`
        : "";

      const illustrationInstruction = characterDescription
        ? ` Avsluta därefter med en ny rad som börjar med "ILLUSTRATION:" ` +
          `följt av en KONKRET beskrivning (max 25 ord, på engelska) av en ` +
          `SPECIFIK SCEN från just detta avsnitt - vad som konkret händer, ` +
          `var det utspelar sig, och huvudpersonen med EXAKT detta utseende: ` +
          `${characterDescription}. Beskriv inte en generisk miljöbild - ` +
          `beskriv den faktiska händelsen i avsnittet.`
        : ` Avsluta därefter med en ny rad som börjar med "ILLUSTRATION:" ` +
          `följt av en KONKRET beskrivning (max 20 ord, på engelska) av en ` +
          `SPECIFIK SCEN från just detta avsnitt - vad som konkret händer ` +
          `och var. Beskriv inte en generisk miljöbild - beskriv den ` +
          `faktiska händelsen i avsnittet.`;

      const chapterPrompt =
        `Skriv ${UNIT_WORD} ${i + 1} med rubriken/namnet "${chapterTitles[i]}" ` +
        `till verket "${output.title}"${genreContext}.${continuityContext} ` +
        `${finalContentInstruction}${summaryInstruction}${illustrationInstruction}`;

      const chapterRaw = await callGeminiText(geminiKey, chapterPrompt, 950);
      const illMatch = chapterRaw.match(/ILLUSTRATION:\s*(.+)/i);
      const illustrationIdea = illMatch ? illMatch[1].trim() : null;
      const summaryMatch = chapterRaw.match(/SAMMANFATTNING:\s*(.+?)(?:\n|$)/i);
      if (summaryMatch && continuityMatters) {
        storySoFar += (storySoFar ? " " : "") + summaryMatch[1].trim();
        if (storySoFar.length > 1200) storySoFar = storySoFar.slice(-1200); // begränsa prompttillväxt
      }
      const text = chapterRaw
        .replace(/ILLUSTRATION:.*$/is, "")
        .replace(/SAMMANFATTNING:.*$/im, "")
        .trim();
      // Bara var N:e enhet får en riktig bild - annars laddas för många
      // Pollinations-bilder samtidigt och nekas av deras hastighetsgräns
      // (1 anrop/15 sek för anonyma anrop).
      let illustrationUrl = null;
      let illustrationBase64 = null;
      let illustrationCredit = null;
      if (illustrationIdea && i % illustrationEvery === 0) {
        this.manager.log(`${this.name} genererar illustration till ${UNIT_WORD} ${i + 1}…`);
        // Gemini kan parafrasera bort exakta klädesdetaljer (t.ex. "randig
        // tröja" blir plötsligt "vit tröja") när den skriver scenbeskriv-
        // ningen. Lägg därför till den EXAKTA, ordagranna karaktärs-
        // beskrivningen sist i prompten programmatiskt, istället för att
        // förlita oss på att Gemini återger den korrekt varje gång.
        const finalPrompt = characterDescription
          ? `${illustrationIdea}. Character appearance (must match exactly): ${characterDescription}`
          : illustrationIdea;
        const img = await resolveBookImage(finalPrompt, { width: 900, height: 560 });
        illustrationUrl = img.url;
        illustrationBase64 = img.base64;
        illustrationCredit = img.credit;
      }
      chapters.push({
        title: chapterTitles[i],
        text,
        illustrationIdea,
        illustrationUrl,
        illustrationCredit,
        illustrationBase64,
      });
    }

    const coverDescription =
      `book cover, ${output.title}: ${(output.body || output.preview || "").slice(0, 150)}` +
      (characterDescription ? `. Main character: ${characterDescription}` : "") +
      (storyBible ? `. Key details: ${storyBible.slice(0, 150)}` : "");
    this.manager.log(`${this.name} genererar bokomslag…`);
    const coverImg = await resolveBookImage(coverDescription, { width: 800, height: 1200 });
    const coverImageUrl = coverImg.url;
    const coverImageBase64 = coverImg.base64;
    const coverImageCredit = coverImg.credit;

    const totalWords = chapters.reduce(
      (sum, c) => sum + c.text.split(/\s+/).filter(Boolean).length,
      0
    );
    const { pages, price } = estimatePriceKr(totalWords);

    output.isBook = true;
    output.genre = genre;
    output.format = format;
    output.unitWord = UNIT_WORD;
    output.chapters = chapters;
    output.coverImageUrl = coverImageUrl;
    output.coverImageBase64 = coverImageBase64;
    output.coverImageCredit = coverImageCredit;
    output.characterDescription = characterDescription;
    output.storyBible = storyBible;
    output.imageStyle = resolvedImageStyle;
    output.characterImageUrl = characterImageUrl;
    output.characterImageBase64 = characterImageBase64;
    output.subtitle = bookSubtitle || output.subtitle;
    output.pages = pages;
    output.suggestedPriceKr = price;
    output.marketplaces = MARKETPLACES[this.kind] || MARKETPLACES.text;
    output.tags = bookTags.length ? bookTags : output.tags || [];

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

  // Genererar ett kort, "hook"-format textutkast lämpligt att posta som
  // en Substack Note (kortformatsflödet, ungefär som en tweet) för att
  // driva trafik till hela alstret. OBS: Substack har ingen öppen API för
  // att posta Notes automatiskt, så detta är ett kopierbart textutkast -
  // inte automatisk publicering.
  async generateNotesDraft(outputId) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("Ingen GEMINI_API_KEY satt - kan inte skapa ett Notes-utkast.");
    }
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error("Alster hittades inte.");

    const summary = output.isBook
      ? `${output.title} - en ${output.pages || "flersidig"}-sidig e-bok. ${output.chapters?.[0]?.text?.slice(0, 200) || ""}`
      : `${output.title} - ${output.body || output.preview}`.slice(0, 600);

    const prompt =
      `Skriv ett kort, slagkraftigt "hook"-inlägg på svenska (max 2-3 ` +
      `meningar, gärna under 280 tecken) lämpligt att posta i Substacks ` +
      `kortformatsflöde ("Notes") för att väcka nyfikenhet och locka läsare ` +
      `till hela texten nedan. Ingen rubrik, bara själva inlägget. Väck ` +
      `nyfikenhet utan att avslöja allt.\n\n${summary}`;

    let notesDraft = (await callGeminiText(geminiKey, prompt, 150)).trim();

    // Lägg till 1-2 hashtags baserat på alstrets redan befintliga taggar -
    // Substack använder faktiskt hashtags för upptäckbarhet i Notes-flödet.
    if (output.tags?.length) {
      const hashtags = output.tags
        .slice(0, 2)
        .map((t) => "#" + t.replace(/\s+/g, ""))
        .join(" ");
      notesDraft = `${notesDraft}\n\n${hashtags}`;
    }

    output.notesDraft = notesDraft;

    this.manager.log(`${this.name} skapade ett Notes-utkast för "${output.title}".`);
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
    return output;
  }

  // Skapar en riktig videofil av en videoidé, via JSON2Video (gratis,
  // nyckelbaserad nivå). Detta genererar INTE ny video med AI - det sätter
  // ihop bilder (Pollinations) + uppläst text (TTS) + undertexter till en
  // riktig videofil. Görs på begäran (inte automatiskt), eftersom det tar
  // en stund och kräver flera anrop.
  async createVideo(outputId) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const j2vKey = process.env.JSON2VIDEO_API_KEY;
    if (!j2vKey) {
      throw new Error("Ingen JSON2VIDEO_API_KEY satt - kan inte skapa video.");
    }
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error("Alster hittades inte.");

    this.manager.log(`${this.name} planerar scener för videon "${output.title}"…`);

    // Dela upp idén i 3-4 korta scener med narration + bildbeskrivning.
    let scenesPlan = [];
    if (geminiKey) {
      const scenePrompt =
        `Dela upp denna videoidé i exakt 4 korta scener:\n\n` +
        `Titel: ${output.title}\nBeskrivning: ${output.body || output.preview}\n\n` +
        `För varje scen, skriv EXAKT två rader:\nNARRATION: <1-2 meningar ` +
        `uppläst text på svenska>\nBILD: <kort visuell beskrivning på ` +
        `engelska, max 15 ord, för en bildgenerator>\n\nUpprepa detta för ` +
        `alla 4 scener, inget annat.`;
      const raw = await callGeminiText(geminiKey, scenePrompt, 500);
      const narrationMatches = [...raw.matchAll(/NARRATION:\s*(.+)/gi)].map((m) => m[1].trim());
      const imageMatches = [...raw.matchAll(/BILD:\s*(.+)/gi)].map((m) => m[1].trim());
      for (let i = 0; i < Math.min(narrationMatches.length, imageMatches.length); i++) {
        scenesPlan.push({ narration: narrationMatches[i], image: imageMatches[i] });
      }
    }
    if (!scenesPlan.length) {
      // Enkel fallback om Gemini saknas eller inte gav ett tolkningsbart svar.
      scenesPlan = [
        { narration: output.title, image: output.title },
        { narration: output.body || output.preview || output.title, image: output.title },
      ];
    }

    this.manager.log(`${this.name} genererar bilder till ${scenesPlan.length} scener…`);
    const scenes = [];
    for (const scenePart of scenesPlan) {
      const imageUrl = buildImageUrl(scenePart.image, { width: 1024, height: 576 });
      // Hämta bilden själva och skicka som inbäddad data-URI istället för
      // en länk - annars måste JSON2Video hämta bilden från Pollinations
      // på egen hand, vilket kan krocka med Pollinations hastighetsgräns
      // på ett sätt vi inte kan kontrollera eller pacea från vår sida.
      const base64 = await fetchImageAsBase64(imageUrl);
      const imageSrc = base64 ? `data:image/jpeg;base64,${base64}` : imageUrl;
      scenes.push({
        elements: [
          { type: "image", src: imageSrc },
          { type: "voice", text: scenePart.narration, voice: "sv-SE-SofieNeural" },
          { type: "subtitles" },
        ],
      });
      await sleep(16000); // säker marginal över Pollinations hastighetsgräns
    }

    this.manager.log(`${this.name} skickar videon till rendering (kan ta någon minut)…`);
    const projectId = await submitJson2VideoJob(scenes, this.manager);
    if (!projectId) {
      throw new Error("JSON2Video accepterade inte renderingsjobbet - kolla att API-nyckeln stämmer.");
    }

    const videoUrl = await pollJson2VideoJob(projectId, this.manager);
    if (!videoUrl) {
      throw new Error("Videon blev inte klar i tid (eller renderingen misslyckades hos JSON2Video).");
    }

    output.isVideo = true;
    output.videoUrl = videoUrl;
    output.sceneCount = scenes.length;

    this.manager.log(`${this.name} blev klar med videon "${output.title}".`);
    this.manager.broadcastAgentUpdate(this);
    this.manager.persist();
    return output;
  }
}

module.exports = Agent;
module.exports.GENRE_TAXONOMY = GENRE_TAXONOMY;
