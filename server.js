const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const port = process.env.PORT || 7000;

// O MANIFESTO CORRIGIDO IGUAL AO SEU EXEMPLO (com catálogos e prefixes corretos)
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    id: "org.animesdigital.stremio.addon",
    version: "1.0.0",
    name: "AnimesDigital Addon",
    description: "Streams automáticos do site animesdigital.org para StreamFin",
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
    idPrefixes: ["tt", "tmdb", "ad_"]
  });
});

// Rota de streams corrigida para receber os parâmetros do Stremio/StreamFin padrão
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.params;
  
  // Limpa o ID e tenta apontar para o slug textual do site
  const idLimpo = id.replace('.json', '');
  const videoUrl = `https://animesdigital.org{idLimpo}/`;
  
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Bloqueia itens desnecessários para carregar na velocidade máxima no Render
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    let videoLink = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.match(/\.(mp4|m3u8)$|master\.m3u8/i)) {
        videoLink = url;
      }
    });

    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    if (!videoLink) {
      throw new Error('Link de vídeo não foi interceptado a tempo');
    }

    res.json({
      streams: [{
        url: videoLink,
        title: "AnimesDigital HTTP Stream (Direct)"
      }]
    });
    
  } catch (error) {
    console.error('Erro no Servidor:', error.message);
    res.json({ streams: [] });
  } finally {
    if (browser) await browser.close();
  }
});

// Rota vazia de catálogo apenas para não quebrar o Stremio ao abrir a aba principal
app.get('/catalog/:type/:id.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ metas: [] });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
