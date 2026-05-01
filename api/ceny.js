// api/ceny.js — Vercel Serverless Function
// Scrappuje gov.pl i cache'uje wynik na 30 minut

let cache = { data: null, ts: 0 };
const CACHE_MS = 30 * 60 * 1000; // 30 minut

// Wzorce URL na gov.pl — ceny ogłaszane dzień wcześniej
function buildGovUrls(date) {
  const d   = date;
  const dd  = String(d.getDate()).padStart(2, "0");
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const miesiac = ["stycznia","lutego","marca","kwietnia","maja","czerwca",
                   "lipca","sierpnia","wrzesnia","pazdziernika","listopada","grudnia"][d.getMonth()];
  // gov.pl używa różnych formatów URL — próbujemy kilku
  return [
    `https://www.gov.pl/web/energia/maksymalna-cena-detaliczna-paliw-obowiazujaca-${dd}-${miesiac}-${yyyy}-r`,
    `https://www.gov.pl/web/energia/maksymalna-cena-detaliczna-paliw-obowiazujaca-${dd}.${mm}.${yyyy}-r`,
  ];
}

function parseGovHtml(html) {
  const result = {};
  // Wzorce dopasowujące ceny z tekstu strony
  const patterns = {
    pb95:   /benzyna\s*(?:bezołowiowa\s*)?95[^0-9]*(\d+)[,.](\d+)\s*zł/i,
    pb98:   /benzyna\s*(?:bezołowiowa\s*)?98[^0-9]*(\d+)[,.](\d+)\s*zł/i,
    diesel: /olej\s*napędowy[^0-9]*(\d+)[,.](\d+)\s*zł/i,
  };
  for (const [key, pat] of Object.entries(patterns)) {
    const m = html.match(pat);
    if (m) result[key] = `${m[1]}.${m[2]}`;
  }
  return result;
}

async function scrapeGov(date) {
  const urls = buildGovUrls(date);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CenyPaliw/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const prices = parseGovHtml(html);
      if (prices.pb95 || prices.diesel) {
        return { prices, date: `${String(date.getDate()).padStart(2,"0")}.${String(date.getMonth()+1).padStart(2,"0")}.${date.getFullYear()}`, source: url };
      }
    } catch { /* próbuj kolejny URL */ }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS — pozwól na dostęp z dowolnej domeny
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");

  // Zwróć cache jeśli świeży
  if (cache.data && Date.now() - cache.ts < CACHE_MS) {
    return res.json({ ...cache.data, cached: true });
  }

  // Próbuj dzisiaj, wczoraj i przedwczoraj (weekend/święta)
  const today = new Date();
  let found = null;
  for (let offset = 0; offset <= 3; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    found = await scrapeGov(d);
    if (found) break;
  }

  if (!found) {
    // Fallback — ostatnie znane ceny hardkodowane
    found = {
      prices: { pb95: "6.46", pb98: "6.96", diesel: "7.31" },
      date: "01.05.2026",
      source: "fallback",
    };
  }

  cache = { data: found, ts: Date.now() };
  return res.json({ ...found, cached: false });
}
