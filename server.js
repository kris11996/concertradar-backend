// ============================================================
//  ConcertRadar — Backend
//  Wgraj ten plik na GitHub (zastąp poprzedni server.js)
//  Zmienna środowiskowa na Railway: SERP_API_KEY
// ============================================================

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SERP_API_KEY = process.env.SERP_API_KEY || 'WKLEJ_TUTAJ_KLUCZ_NA_TESTY';

// ── Pomocnicze: aktualna data do filtrowania ───────────────────
function getDateFilter() {
  const today = new Date();
  const year  = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day   = String(today.getDate()).padStart(2, '0');
  return { year, month, day, filter: `after:${year}-${month}-${day}` };
}

// ── Pomocnicze: wywołanie SerpAPI ──────────────────────────────
async function serpFetch(query, extra = {}) {
  const params = new URLSearchParams({
    q:       query,
    api_key: SERP_API_KEY,
    hl:      'pl',
    gl:      'pl',
    num:     '10',
    ...extra,
  });
  const res = await fetch(`https://serpapi.com/search?${params}`);
  return res.json();
}

// ── Parsowanie Google Events ───────────────────────────────────
function parseEvents(data, todayDate) {
  const events = data.events_results || [];
  return events
    .filter(e => {
      const dateStr = e.date?.start_date || e.date?.when || '';
      if (!dateStr) return true;
      // Spróbuj odfiltrować przeszłe daty
      const parsed = new Date(dateStr);
      if (!isNaN(parsed)) return parsed >= todayDate;
      return true;
    })
    .map(e => ({
      title:   e.title            || '',
      date:    e.date?.start_date || e.date?.when || '',
      venue:   e.venue            || '',
      address: Array.isArray(e.address) ? e.address[0] : (e.address || ''),
      link:    e.link             || '',
      source:  'Google Events',
    }));
}

// ── Parsowanie wyników organicznych ───────────────────────────
function parseOrganic(data, source) {
  const results = data.organic_results || [];
  return results.slice(0, 5).map(r => ({
    title:   r.title   || '',
    snippet: r.snippet || '',
    link:    r.link    || '',
    source,
    rawDate: r.date    || null,
  }));
}

// ── Główny endpoint ────────────────────────────────────────────
app.get('/api/concerts/:artist', async (req, res) => {
  const artist = decodeURIComponent(req.params.artist).trim();
  if (!artist) return res.status(400).json({ error: 'Podaj nazwę artysty' });

  const { year, filter, day, month } = getDateFilter();
  const todayDate = new Date(`${year}-${month}-${day}`);

  try {
    const [
      generalData,
      eventsData,
      facebookData,
      polishData,
      globalData,
    ] = await Promise.allSettled([

      // 1. Ogólne Google — tylko wyniki po dzisiejszej dacie
      serpFetch(`${artist} koncert bilety ${filter}`),

      // 2. Google Events — przyszłe koncerty
      serpFetch(`${artist} concert ${year}`, { tbm: 'evn' }),

      // 3. Facebook Events — ostatnie 6 miesięcy
      serpFetch(`"${artist}" concert event site:facebook.com`, { tbs: 'qdr:m6' }),

      // 4. Polskie bileterie — ostatnie 6 miesięcy
      serpFetch(`${artist} bilety koncert going.pl OR ebilet.pl OR ticketmaster.pl OR eventim.pl`, { tbs: 'qdr:m6' }),

      // 5. Songkick / Bandsintown
      serpFetch(`${artist} tour dates ${year} songkick OR bandsintown`),

    ]);

    const events     = [];
    const rawResults = [];

    if (eventsData.status === 'fulfilled') {
      parseEvents(eventsData.value, todayDate).forEach(e => events.push(e));
    }
    if (generalData.status === 'fulfilled') {
      parseOrganic(generalData.value, 'Google').forEach(r => rawResults.push(r));
    }
    if (facebookData.status === 'fulfilled') {
      parseOrganic(facebookData.value, 'Facebook').forEach(r => rawResults.push(r));
    }
    if (polishData.status === 'fulfilled') {
      parseOrganic(polishData.value, 'Bileteria PL').forEach(r => rawResults.push(r));
    }
    if (globalData.status === 'fulfilled') {
      parseOrganic(globalData.value, 'Songkick / Bandsintown').forEach(r => rawResults.push(r));
    }

    res.json({
      artist,
      searchedAt:  new Date().toISOString(),
      events,
      rawResults,
      totalFound:  events.length + rawResults.length,
    });

  } catch (err) {
    console.error('Błąd wyszukiwania:', err);
    res.status(500).json({ error: 'Błąd serwera', details: err.message });
  }
});

// ── Health check ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ConcertRadar API działa ✅', version: '1.1.0' });
});

app.listen(PORT, () => {
  console.log(`✅ ConcertRadar Backend uruchomiony na porcie ${PORT}`);
});
