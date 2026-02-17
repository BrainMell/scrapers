const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

class ShoobCardScraper {
  constructor(config = {}) {
    this.startPage = config.startPage || 1;
    this.endPage = config.endPage || 2332;
    this.tiers = config.tiers || ['1', '2', '3', '4', '5', '6', 'S'];
    this.outputFolder = config.outputFolder || path.join(__dirname, 'shoob_cards');
    this.outputFile = path.join(this.outputFolder, 'cards_data.json');
    
    this.cards = [];
    this.cardUrlSet = new Set();
    this.processedPages = new Set();
    
    this.browser = null;
    this.activeTabs = 0;
  }

  async cleanup() {
    const { exec } = require('child_process');
    const isWindows = process.platform === 'win32';
    return new Promise((resolve) => {
      if (isWindows) {
        exec('taskkill /F /IM chrome.exe /T 2>nul', () => {
          exec('taskkill /F /IM chromium.exe /T 2>nul', () => setTimeout(resolve, 1000));
        });
      } else {
        exec('pkill -9 chrome 2>/dev/null', () => {
          exec('pkill -9 chromium 2>/dev/null', () => setTimeout(resolve, 1000));
        });
      }
    });
  }

  async initialize() {
    console.log('🚀 Initializing Scraper (1GB RAM Optimized)...');
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}

    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Critical for small servers
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=800,600'
      ]
    });
    console.log('✅ Browser Ready');
  }

  async fetchMetadataByOpeningTab(detailUrl, cardName, retryCount = 0) {
    if (!detailUrl) return { animeName: 'Unknown Anime', creator: 'Unknown Creator' };
    let detailPage = null;
    this.activeTabs++;
    try {
      detailPage = await this.browser.newPage();
      await detailPage.setRequestInterception(true);
      detailPage.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await detailPage.setViewport({ width: 800, height: 600 });
      await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));

      const meta = await detailPage.evaluate(() => {
        let animeName = 'Unknown Anime';
        let creatorName = 'Unknown Creator';
        try {
          const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb-new li, .breadcrumb li'));
          const seriesLi = breadcrumbs.find(li => {
            const pos = li.querySelector('meta[itemprop="position"]');
            return pos && pos.getAttribute('content') === '3';
          });
          if (seriesLi) {
            const span = seriesLi.querySelector('span[itemprop="name"]');
            if (span) animeName = span.textContent.trim();
          }
        } catch(e) {}
        try {
          const creatorLink = Array.from(document.querySelectorAll('a[href*="/u/"]')).find(a => {
            const text = a.textContent.toLowerCase();
            return !text.includes('see') && !text.includes('view');
          });
          if (creatorLink) creatorName = creatorLink.textContent.trim();
        } catch(e) {}
        return { animeName, creatorName };
      });

      await detailPage.close();
      this.activeTabs--;

      if (meta.animeName === 'Unknown Anime' && retryCount < 2) {
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }
      return { creator: meta.creatorName, animeName: meta.animeName, description: `${cardName} from ${meta.animeName}` };
    } catch (e) {
      if (detailPage) { await detailPage.close().catch(() => {}); this.activeTabs--; }
      if (retryCount < 2) return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      return { creator: 'Unknown Creator', animeName: 'Unknown Anime', description: `${cardName} from Unknown Anime` };
    }
  }

  async saveProgress() {
    const tierOrder = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7 };
    this.cards.sort((a, b) => {
      const tierDiff = (tierOrder[a.tier] || 0) - (tierOrder[b.tier] || 0);
      return tierDiff !== 0 ? tierDiff : (a.animeName || '').localeCompare(b.animeName || '');
    });

    const data = {
      stats: { totalCards: this.cards.length, pagesProcessed: this.processedPages.size, lastUpdate: new Date().toISOString() },
      processedPages: Array.from(this.processedPages).sort((a, b) => {
        const [aT, aP] = a.split('-').map(Number);
        const [bT, bP] = b.split('-').map(Number);
        return aT !== bT ? aT - bT : aP - bP;
      }),
      cards: this.cards
    };

    const tempFile = `${this.outputFile}.tmp`;
    try {
      await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempFile, this.outputFile);
      console.log(`   💾 Saved: ${this.cards.length} cards`);
    } catch (error) { console.error(`   ❌ Save failed: ${error.message}`); }
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.cards) {
        this.cards = parsed.cards;
        parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
        this.processedPages = new Set(parsed.processedPages || []);
      }
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages.`);
    } catch (error) { console.log('📝 Starting fresh'); }
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;

    let page = null;
    let attempts = 0;
    try {
      page = await this.browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      const url = `https://shoob.gg/cards?page=${pageNum}&tier=${tier}`;
      while (attempts < 3) {
        attempts++;
        console.log(`📑 [Tier ${tier} P${pageNum}] Attempt ${attempts}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        const content = await page.evaluate(() => document.body.textContent);
        if (content.includes('Cloudflare') || content.includes('Access Denied')) {
          console.log('⚠️ Blocked, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
          continue;
        }

        const extraction = await page.evaluate(() => {
          const cards = [];
          document.querySelectorAll('a[href*="/cards/info/"]').forEach(link => {
            const img = link.querySelector('img');
            if (img && img.src && !img.src.includes('card_back')) {
              cards.push({ imageUrl: img.src, detailUrl: link.href, cardName: img.alt?.trim() || 'Unknown' });
            }
          });
          return cards;
        });

        if (extraction.length > 0) {
          console.log(`🚀 Scraping ${extraction.length} cards...`);
          const batchSize = 2;
          for (let i = 0; i < extraction.length; i += batchSize) {
            const batch = extraction.slice(i, i + batchSize);
            await Promise.all(batch.map(async (card) => {
              if (this.cardUrlSet.has(card.imageUrl)) return;
              const meta = await this.fetchMetadataByOpeningTab(card.detailUrl, card.cardName);
              if (meta.animeName !== 'Unknown Anime') {
                const enriched = { ...card, ...meta, creator: meta.creator === 'Unknown Creator' ? 'Official' : meta.creator, tier, page: pageNum, scrapedAt: new Date().toISOString() };
                this.cards.push(enriched);
                this.cardUrlSet.add(card.imageUrl);
                console.log(`      ✨ [${enriched.creator}] ${enriched.description}`);
              }
            }));
            await new Promise(r => setTimeout(r, 1000));
          }
          this.processedPages.add(pageKey);
          break;
        }
        await new Promise(r => setTimeout(r, 5000));
      }
      await page.close();
    } catch (error) { if (page) await page.close().catch(() => {}); }
  }

  async start() {
    process.on('SIGINT', async () => { await this.saveProgress(); process.exit(0); });
    try {
      await this.loadProgress();
      await this.initialize();
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          await this.scrapePage(tier, p);
          if (p % 5 === 0) await this.saveProgress();
        }
      }
    } finally { if (this.browser) await this.browser.close(); }
  }
}

const config = { startPage: 1, endPage: 2332, tiers: ['1', '2', '3', '4', '5', '6', 'S'] };
(async () => { await new ShoobCardScraper(config).start(); })();
