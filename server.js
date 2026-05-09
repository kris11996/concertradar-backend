// ============================================================
//  ConcertRadar — Backend
//  Wgraj ten folder na Railway.app (przez GitHub)
//  Ustaw zmienną środowiskową: SERP_API_KEY = twój klucz z serpapi.com
// ============================================================

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Klucz SerpAPI — ustaw w Railway jako zmienną środowiskową ──
const SERP_API_KEY = process.env.SERP_API_KEY || 'WKLEJ_TUTAJ_KLUCZ_NA_TESTY';

// ── Pomocnicze: wywołanie SerpAPI ──────────────────────────────
async function serpSearch(query, extraParams = {}) {
  const params = new URLSearchParams({
    q: query,
    api_key: SERP_API_KEY,
    hl: 'pl',
    gl: 'pl',
    num: '10',
    ...extraParams,
  });
  const url = `https://serpapi.com/search?${params}`;
  const res  = await fetch(url);
  return res.json();
}

// ── Parsowanie wyników organicznych ───────────────────────────
function parseOrganicResults(data, source) {
  const results = data.organic_results || [];
  return results.slice(0, 5).map(r => ({
    title:     r.title   || '',
    snippet:   r.snippet || '',
    link:      r.link    || '',
    source:    source,
    rawDate:   r.date    || null,
  }));
}

// ── Parsowanie Google Events ───────────────────────────────────
function parseEvents(data) {
  const events = data.events_results || [];
  return events.map(e => ({
    title:   e.title       || '',
    date:    e.date?.start_date || e.date?.when || '',
    venue:   e.venue       || '',
    address: e.address?.[0] || '',
    link:    e.link        || '',
    source:  'Google Events',
  }));
}

// ── Główny endpoint wyszukiwania ───────────────────────────────
app.get('/api/concerts/:artist', async (req, res) => {
  const artist = decodeURIComponent(req.params.artist).trim();

  if (!artist) {
    return res.status(400).json({ error: 'Podaj nazwę artysty' });
  }

  try {
    // Równoległe zapytania do różnych źródeł
    const [
      generalData,
      eventsData,
      facebookData,
      polishData,
      globalData,
    ] = await Promise.allSettled([

      // 1. Ogólne Google po polsku
      serpSearch(`${artist} koncert 2025 2026 bilety`),

      // 2. Google Events (wyciąga daty automatycznie)
      serpSearch(`${artist} concert 2025 2026`, { tbm: 'evn' }),

      // 3. Facebook Events
      serpSearch(`"${artist}" concert event site:facebook.com`),

      // 4. Polskie bileterie
      serpSearch(`${artist} bilety koncert going.pl OR ebilet.pl OR ticketmaster.pl OR eventim.pl`),

      // 5. Globalne strony muzyczne
      serpSearch(`${artist} tour dates 2025 2026 songkick OR bandsintown`),
    ]);

    const concerts = [];
    const rawResults = [];

    // Zbierz Google Events (najbardziej ustrukturyzowane)
    if (eventsData.status === 'fulfilled') {
      const events = parseEvents(eventsData.value);
      events.forEach(e => concerts.push(e));
    }

    // Zbierz wyniki organiczne
    if (generalData.status === 'fulfilled') {
      parseOrganicResults(generalData.value, 'Google').forEach(r => rawResults.push(r));
    }
    if (facebookData.status === 'fulfilled') {
      parseOrganicResults(facebookData.value, 'Facebook').forEach(r => rawResults.push(r));
    }
    if (polishData.status === 'fulfilled') {
      parseOrganicResults(polishData.value, 'Bileteria PL').forEach(r => rawResults.push(r));
    }
    if (globalData.status === 'fulfilled') {
      parseOrganicResults(globalData.value, 'Songkick/Bandsintown').forEach(r => rawResults.push(r));
    }

    res.json({
      artist,
      searchedAt:  new Date().toISOString(),
      events:      concerts,      // ustrukturyzowane Google Events
      rawResults,                 // linki ze snippetami do dalszego przeglądania
      totalFound:  concerts.length + rawResults.length,
    });

  } catch (err) {
    console.error('Błąd wyszukiwania:', err);
    res.status(500).json({ error: 'Błąd serwera', details: err.message });
  }
});

// ── Health check ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ConcertRadar API działa ✅', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`✅ ConcertRadar Backend uruchomiony na porcie ${PORT}`);
});
