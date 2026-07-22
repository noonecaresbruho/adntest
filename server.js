const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const app = express();
const port = process.env.PORT || 7000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// MANIFESTO COMPLETO
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "org.animesdigital.stremio.addon",
    version: "1.0.0",
    name: "AnimesDigital Addon",
    description: "Streams automáticos do site animesdigital.org para StreamFin",
    logo: "https://strem.io",
    background: "https://strem.io",
    resources: ["stream", "catalog"],
    types: ["series"],
    catalogs: [
      {
        type: "series",
        id: "animesdigital_populares",
        name: "Populares (AnimesDigital)"
      }
    ],
    idPrefixes: ["ad_"]
  });
});

// ROTA DO CATÁLOGO: Puxa os animes da página inicial do site automaticamente
app.get('/catalog/:type/:id.json', async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    
    // Bloqueia mídia para carregar a estrutura mais rápido
    await page.setRequestInterception(true);
    page.on('request', (r) => ['image', 'font', 'media'].includes(r.resourceType()) ? r.abort() : r.continue());

    await page.goto('https://animesdigital.org', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    const $ = cheerio.load(html);
    
    const metas = [];

    // Vasculha os blocos de anime da página inicial do site
    $('.epiItem, .animeItem, .boxAnimes, [class*="item"]').each((i, el) => {
      const link = $(el).find('a').attr('href');
      const title = $(el).find('img').attr('alt') || $(el).find('[class*="title"]').text().trim();
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (link && title) {
        // Transforma o link do site no ID que o addon vai usar para buscar o vídeo depois
        const idLimpo = link.replace('https://animesdigital.org', '').replace(/\//g, '');
        
        if (img && !img.startsWith('http')) {
          img = 'https://animesdigital.org' + img;
        }

        metas.push({
          id: `ad_${idLimpo}`,
          type: "series",
          name: title,
          poster: img || "https://strem.io",
          description: "Assista agora via Animes Digital"
        });
      }
    });

    res.json({ metas: metas.slice(0, 24) }); // Retorna os primeiros 24 animes da lista
    
  } catch (error) {
    console.error('Erro no Catálogo:', error.message);
    res.json({ metas: [] });
  } finally {
    if (browser) await browser.close();
  }
});

// ROTA DE STREAMS: Pega o vídeo direto ao clicar no anime escolhido
app.get('/stream/:type/:id.json', async (req, res) => {
  const { id } = req.params;
  const idLimpo = id.replace('ad_', '').replace('.json', '');
  const videoUrl = `https://animesdigital.org${idLimpo}/`;
  
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
    await new Promise(resolve => setTimeout(resolve, 5000)); // Aguarda o player injetar o streaming na rede
    
    if (!videoLink) throw new Error('Link não interceptado');

    res.json({
      streams: [{
        url: videoLink,
        title: "AnimesDigital Stream Direto"
      }]
    });
    
  } catch (error) {
    console.error('Erro no Stream:', error.message);
    res.json({ streams: [] });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(port, () => console.log(`Servidor na porta ${port}`));
