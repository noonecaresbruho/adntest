const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 7000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  next();
});

// MANIFESTO CORRIGIDO: Agora informamos ao Stremio/Switch que aceitamos IDs oficiais ("tt")
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "org.animesdigital.stremio.addon",
    version: "1.0.2",
    name: "AnimesDigital Addon",
    description: "Streams HTTP diretos do animesdigital.org para o seu Switch",
    logo: "https://strem.io",
    background: "https://strem.io",
    resources: ["stream", "catalog"],
    types: ["movie", "series"],
    catalogs: [
      {
        type: "series",
        id: "animesdigital_populares",
        name: "Populares (AnimesDigital)"
      }
    ],
    idPrefixes: ["tt", "ad_"] // CRUCIAL: "tt" diz ao Switch para liberar seu addon na lista de players globais!
  });
});

// TELA INICIAL (CATÁLOGO)
app.get('/catalog/:type/:id.json', async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => ['image', 'font', 'media'].includes(r.resourceType()) ? r.abort() : r.continue());

    await page.goto('https://animesdigital.org', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    const $ = cheerio.load(html);
    const metas = [];

    $('.epiItem, .animeItem, .boxAnimes, [class*="item"]').each((i, el) => {
      const link = $(el).find('a').attr('href');
      const title = $(el).find('img').attr('alt') || $(el).find('[class*="title"]').text().trim();
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (link && title) {
        const idLimpo = link.replace('https://animesdigital.org', '').replace(/\//g, '');
        if (img && !img.startsWith('http')) img = 'https://animesdigital.org' + img;

        metas.push({
          id: `ad_${idLimpo}`,
          type: "series",
          name: title,
          poster: img || "https://strem.io",
          description: "Assista no Animes Digital"
        });
      }
    });
    res.json({ metas: metas.slice(0, 24) });
  } catch (error) {
    res.json({ metas: [] });
  } finally {
    if (browser) await browser.close();
  }
});

// EXTRATOR DO VÍDEO (STREAMS)
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  let nomeProcurar = "";

  // Se veio do catálogo próprio
  if (id.startsWith('ad_')) {
    nomeProcurar = id.replace('ad_', '').replace('.json', '');
  } else {
    // Se veio de fora (ID oficial tt0123456:1:1 do IMDb)
    try {
      const partesId = id.replace('.json', '').split(':');
      const imdbCode = partesId[0]; // Pega a primeira parte (o ttXXXXXX)
      const temporada = partesId[1] || "1";
      const episodio = partesId[2] || "1";

      // Pergunta para a API do Stremio qual é o nome em texto desse ID
      const metadata = await axios.get(`https://strem.io{type}/${imdbCode}.json`);
      if (metadata.data && metadata.data.meta) {
        let tituloOriginal = metadata.data.meta.name.toLowerCase();
        
        // Formata o texto tirando acentos e colocando traços igual ao site de animes
        nomeProcurar = tituloOriginal
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, '-');
        
        // Monta a estrutura padrão de episódios que o site usa
        nomeProcurar = `${nomeProcurar}-episodio-${episodio}`;
      }
    } catch (e) {
      console.error("Erro na conversão do ID do IMDb:", e.message);
    }
  }

  if (!nomeProcurar) return res.json({ streams: [] });

  const videoUrl = `https://animesdigital.org${nomeProcurar}/`;
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const page = await browser.newPage();
    let videoLink = null;
    
    page.on('response', async (response) => {
      const url = response.url();
      if (url.match(/\.(mp4|m3u8)$|master\.m3u8/i)) {
        videoLink = url;
      }
    });

    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    if (!videoLink) throw new Error('Vídeo não disparou requisição HTTP');

    res.json({
      streams: [{
        url: videoLink,
        title: "AnimesDigital Stream Direto 📺"
      }]
    });
    
  } catch (error) {
    console.error('Erro ao capturar stream:', error.message);
    res.json({ streams: [] });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(port, () => console.log(`Servidor ativo na porta ${port}`));
