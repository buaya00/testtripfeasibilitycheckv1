/**
 * Shared Firecrawl scraping utility for regulatory edge functions.
 * Attempts to scrape official eAIP / CAA pages for a given ICAO code.
 */

// Known eAIP / CAA base URLs by ICAO prefix (2-letter)
const EAIP_SOURCES: Record<string, { name: string; urls: string[] }> = {
  // Europe — Eurocontrol EAD covers most
  'EG': { name: 'UK CAA', urls: ['https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP/', 'https://www.caa.co.uk/commercial-industry/airspace/'] },
  'EI': { name: 'Ireland IAA', urls: ['https://www.iaa.ie/commercial-aviation/airspace'] },
  'LF': { name: 'France DGAC', urls: ['https://www.sia.aviation-civile.gouv.fr/'] },
  'ED': { name: 'Germany DFS', urls: ['https://aip.dfs.de/BasicIFR/'] },
  'LI': { name: 'Italy ENAV', urls: ['https://www.enav.it/'] },
  'LE': { name: 'Spain ENAIRE', urls: ['https://aip.enaire.es/AIP/'] },
  'LP': { name: 'Portugal NAV', urls: ['https://www.nav.pt/en/nav/aip'] },
  'EH': { name: 'Netherlands LVNL', urls: ['https://www.lvnl.nl/'] },
  'EB': { name: 'Belgium skeyes', urls: ['https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/'] },
  'LS': { name: 'Switzerland Skyguide', urls: ['https://www.skybriefing.com/o/bul'] },
  'LO': { name: 'Austria Austro Control', urls: ['https://eaip.austrocontrol.at/'] },
  'LK': { name: 'Czech ANS', urls: ['https://aim.rlp.cz/'] },
  'EP': { name: 'Poland PANSA', urls: ['https://www.ais.pansa.pl/aip'] },
  'EN': { name: 'Norway Avinor', urls: ['https://avinor.no/en/corporate/'] },
  'ES': { name: 'Sweden LFV', urls: ['https://aro.lfv.se/Links/Link/ViewLink?TorSession='] },
  'EK': { name: 'Denmark Naviair', urls: ['https://aim.naviair.dk/'] },
  'EF': { name: 'Finland ANS Finland', urls: ['https://ais.fi/'] },
  'LH': { name: 'Hungary HungaroControl', urls: [] },
  'LR': { name: 'Romania ROMATSA', urls: [] },
  'LG': { name: 'Greece HCAA', urls: [] },
  'LT': { name: 'Turkey DHMI', urls: ['http://www.dhmi.gov.tr/'] },
  // Middle East
  'OM': { name: 'UAE GCAA', urls: ['https://www.gcaa.gov.ae/en/epublication/pages/aiponline.aspx'] },
  'OE': { name: 'Saudi Arabia GACA', urls: ['https://gaca.gov.sa/web/en-gb/page/aip'] },
  'OB': { name: 'Bahrain CAA', urls: [] },
  'OK': { name: 'Kuwait DGCA', urls: [] },
  'OT': { name: 'Qatar CAA', urls: ['https://www.caa.gov.qa/'] },
  'OO': { name: 'Oman CAA', urls: ['https://www.paca.gov.om/'] },
  // Asia
  'VH': { name: 'Hong Kong CAD', urls: ['https://www.cad.gov.hk/english/air_information.html'] },
  'WS': { name: 'Singapore CAAS', urls: ['https://www.caas.gov.sg/'] },
  'VT': { name: 'Thailand CAAT', urls: ['https://www.caat.or.th/en/'] },
  'VO': { name: 'India DGCA (South)', urls: ['https://www.dgca.gov.in/'] },
  'VI': { name: 'India DGCA (North)', urls: ['https://www.dgca.gov.in/'] },
  'VA': { name: 'India DGCA (West)', urls: ['https://www.dgca.gov.in/'] },
  'VE': { name: 'India DGCA (East)', urls: ['https://www.dgca.gov.in/'] },
  'ZB': { name: 'China CAAC (North)', urls: [] },
  'ZS': { name: 'China CAAC (East)', urls: [] },
  'ZG': { name: 'China CAAC (South)', urls: [] },
  'RJ': { name: 'Japan JCAB', urls: ['https://aisjapan.mlit.go.jp/'] },
  'RK': { name: 'South Korea MOLIT', urls: [] },
  'WM': { name: 'Malaysia CAAM', urls: ['https://www.caam.gov.my/'] },
  'WI': { name: 'Indonesia DGCA', urls: [] },
  'RP': { name: 'Philippines CAAP', urls: [] },
  // Americas
  'K': { name: 'USA FAA', urls: ['https://www.faa.gov/air_traffic/publications/atpubs/aip_html/'] },
  'C': { name: 'Canada NAV CANADA', urls: ['https://www.navcanada.ca/en/aeronautical-information/'] },
  'MM': { name: 'Mexico SENEAM', urls: [] },
  'SB': { name: 'Brazil DECEA', urls: ['https://aisweb.decea.mil.br/'] },
  // Africa
  'FA': { name: 'South Africa SACAA', urls: ['https://www.caa.co.za/'] },
  'DN': { name: 'Nigeria NCAA', urls: [] },
  'HK': { name: 'Kenya KCAA', urls: [] },
  // Oceania
  'Y': { name: 'Australia Airservices', urls: ['https://www.airservicesaustralia.com/aip/aip.asp'] },
  'NZ': { name: 'New Zealand Airways', urls: ['https://www.aip.net.nz/'] },
  // Caribbean
  'TJ': { name: 'Puerto Rico FAA', urls: ['https://www.faa.gov/air_traffic/publications/atpubs/aip_html/'] },
  'MY': { name: 'Bahamas', urls: [] },
  'MK': { name: 'Jamaica JCAA', urls: [] },
  'TN': { name: 'Caribbean Netherlands', urls: [] },
};

/**
 * Determine the best eAIP/CAA URLs to scrape for a given ICAO code.
 */
function getSourcesForIcao(icao: string): { name: string; urls: string[] } | null {
  // Try 2-char prefix first, then 1-char
  const prefix2 = icao.substring(0, 2);
  if (EAIP_SOURCES[prefix2]) return EAIP_SOURCES[prefix2];
  const prefix1 = icao.substring(0, 1);
  if (EAIP_SOURCES[prefix1]) return EAIP_SOURCES[prefix1];
  return null;
}

interface FirecrawlResult {
  content: string;
  sourceUrl: string;
  sourceName: string;
}

/**
 * Scrape official CAA/eAIP pages using Firecrawl for a given ICAO code.
 * Returns scraped markdown content from up to `maxPages` URLs.
 * Falls back gracefully if Firecrawl is unavailable.
 */
export async function scrapeOfficialSources(
  icao: string,
  context: 'permit' | 'ppr' | 'overflight' | 'charges' | 'ciq',
  opts?: { maxPages?: number; searchQuery?: string }
): Promise<{ results: FirecrawlResult[]; combinedContent: string }> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) {
    console.log('Firecrawl not configured — skipping official source scraping');
    return { results: [], combinedContent: '' };
  }

  const maxPages = opts?.maxPages ?? 2;
  const sources = getSourcesForIcao(icao);

  // Build search queries based on context
  const contextQueries: Record<string, string> = {
    permit: `${icao} landing permit requirements foreign aircraft AIP`,
    ppr: `${icao} PPR prior permission required slot coordination AIP`,
    overflight: `${icao} overflight permit air navigation charges`,
    charges: `${icao} airport charges landing fees parking fees tariff`,
    ciq: `${icao} customs immigration CIQ international port of entry`,
  };

  const searchQuery = opts?.searchQuery || contextQueries[context] || `${icao} AIP requirements`;

  const results: FirecrawlResult[] = [];

  // Strategy 1: Use Firecrawl search to find relevant official pages
  try {
    console.log(`Firecrawl search: "${searchQuery}"`);
    const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: maxPages,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const searchResults = searchData.data || searchData.results || [];
      for (const r of searchResults) {
        if (r.markdown && r.markdown.length > 50) {
          results.push({
            content: r.markdown.substring(0, 3000),
            sourceUrl: r.url || 'search result',
            sourceName: sources?.name || 'Official source',
          });
        }
      }
      console.log(`Firecrawl search returned ${results.length} results with content`);
    } else {
      console.warn('Firecrawl search failed:', searchResponse.status);
    }
  } catch (e) {
    console.warn('Firecrawl search error (non-fatal):', e);
  }

  // Strategy 2: If search didn't yield results and we have known URLs, scrape them directly
  if (results.length === 0 && sources?.urls?.length) {
    const urlsToScrape = sources.urls.slice(0, maxPages);
    for (const url of urlsToScrape) {
      try {
        console.log(`Firecrawl scrape: ${url}`);
        const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['markdown'],
            onlyMainContent: true,
            waitFor: 3000,
          }),
        });

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
          if (markdown.length > 50) {
            results.push({
              content: markdown.substring(0, 3000),
              sourceUrl: url,
              sourceName: sources.name,
            });
          }
        } else {
          console.warn(`Firecrawl scrape failed for ${url}:`, scrapeResponse.status);
        }
      } catch (e) {
        console.warn(`Firecrawl scrape error for ${url} (non-fatal):`, e);
      }
    }
  }

  const combinedContent = results.length > 0
    ? results.map(r => `### Source: ${r.sourceName} (${r.sourceUrl})\n${r.content}`).join('\n\n---\n\n')
    : '';

  return { results, combinedContent };
}
