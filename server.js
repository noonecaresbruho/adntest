const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const ID_PREFIX = 'ad_';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    next();
});

// MANIFESTO DO ADDON
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'org.animesdigital.stremio.addon',
        version: '1.0.7',
        name: 'Animes Digital',
        description: 'Addon inteligente com busca por texto para o Switch',
        logo: "https://strem.io",
        background: "https://strem.io",
        resources: ['catalog', 'stream'],
        types: ['series', 'movie'],
        catalogs: [
            {
                type: 'series',
                id: 'recentes',
                name: 'Episódios Recentes'
            }
        ],
        idPrefixes: ['tt', ID_PREFIX]
    });
});

// CATÁLOGO DA TELA INICIAL (LANÇAMENTOS)
app.get('/catalog/:type/:id.json', async (req, res) => {
    try {
        const { type } = req.params;
        const homepageUrl = 'https://animesdigital.org';
        const response = await axios.get(homepageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const items = [];

        $('a[href*="/video/a/"]').each((index, element) => {
            const href = $(element).attr('href');
            const match = href.match(/\/video\/a\/(\d+)\/?/);
            if (match) {
                const numero = match[1];
                const name = $(element).text().trim() || $(element).find('img').attr('alt') || `Anime ${numero}`;
                items.push({
                    id: `${ID_PREFIX}${numero}`,
                    name: name,
                    type: type === 'movie' ? 'movie' : 'series',
                    poster: "https://strem.io",
                    description: "Assista no Animes Digital"
                });
            }
        });

        const uniqueItems = items.filter((value, index, self) => index === self.findIndex((t) => t.id === value.id));
        res.json({ metas: uniqueItems.slice(0, 30) });
    } catch (error) {
        res.json({ metas: [] });
    }
});

// ROTA DE STREAM: SISTEMA DE TRADUÇÃO DE BUSCA AUTOMÁTICA
app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    let numeroDoVideo = null;

    // 1. Se o usuário clicou pelo catálogo próprio do Addon
    if (id.startsWith(ID_PREFIX)) {
        numeroDoVideo = id.replace(ID_PREFIX, '').replace('.json', '');
    } else {
        // 2. Se clicou por fora (Busca global do Switch / ID ttXXXXX:Temporada:Episódio)
        try {
            const partes = id.replace('.json', '').split(':');
            const imdbCode = partes[0];
            const temporada = partes[1] || "1";
            const episodio = partes[2] || "1";

            // Pergunta para o Stremio qual o nome do anime (Ex: "Dogulwang")
            const metadata = await axios.get(`https://strem.io{type}/${imdbCode}.json`);
            if (metadata.data && metadata.data.meta) {
                const nomeAnime = metadata.data.meta.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                
                // Faz o robô dar uma busca na barra de pesquisa do próprio site para achar as páginas de vídeo
                const buscaSite = await axios.get(`https://animesdigital.org{encodeURIComponent(nomeAnime)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $ = cheerio.load(buscaSite.data);
                
                $('a[href*="/video/a/"]').each((i, el) => {
                    const textoLink = $(el).text().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    // Verifica se o texto do link do site bate com o número do episódio que você quer (ex: "episodio 03")
                    if (textoLink.includes(`episodio ${episodio.padStart(2, '0')}`) || textoLink.includes(`episodio ${episodio}`)) {
                        const match = $(el).attr('href').match(/\/video\/a\/(\d+)\/?/);
                        if (match) numeroDoVideo = match[1];
                    }
                });
            }
        } catch (e) {
            console.error("Erro na busca por ID global:", e.message);
        }
    }

    if (!numeroDoVideo) return res.json({ streams: [] });

    // Monta a URL exata baseada na descoberta do seu print
    const playerUrl = `https://animesdigital.org{numeroDoVideo}/`;

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        let videoLink = null;

        // Escuta a rede focando no index.m3u8 do player de mídia oculto
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('index.m3u8') || url.match(/\.(mp4|m3u8)(\?.*)?$/i)) {
                videoLink = url;
            }
        });

        await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(resolve => setTimeout(resolve, 6000)); // Espera o player de iframe carregar na rede

        if (!videoLink) throw new Error('M3U8 não interceptado');

        res.json({
            streams: [{
                url: videoLink,
                title: 'AnimesDigital HTTP Stream 📺'
            }]
        });
    } catch (error) {
        console.error('Erro no processamento:', error.message);
        res.json({ streams: [] });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Servidor ativo na porta ${PORT}`));
