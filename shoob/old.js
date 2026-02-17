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
          exec('taskkill /F /IM chromium.exe /T 2>nul', () => {
            setTimeout(resolve, 1000);
          });
        });
      } else {
        exec('pkill -9 chrome 2>/dev/null', () => {
          exec('pkill -9 chromium 2>/dev/null', () => {
            setTimeout(resolve, 1000);
          });
        });
      }
    });
  }

  async initialize() {
    console.log('🚀 Initializing Robust Scraper (1GB RAM Optimized)...');
    await this.cleanup();
    
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,800'
      ]
    });

    // Enhanced stealth and identification
    const page = await this.browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive'
    });
    await page.close();
    
    console.log('✅ Browser Ready');
  }

  async fetchMetadataByOpeningTab(detailUrl, cardName, retryCount = 0) {
    if (!detailUrl) return { animeName: 'Unknown Anime', creator: 'Unknown Creator' };
    
    let detailPage = null;
    this.activeTabs++;
    try {
      detailPage = await this.browser.newPage();
      
      // 1GB OPTIMIZATION: Block heavy resources in sub-tabs
      await detailPage.setRequestInterception(true);
      detailPage.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await detailPage.setViewport({ width: 800, height: 600 });
      await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // Wait for JS to render breadcrumbs

      const meta = await detailPage.evaluate(() => {
        let animeName = 'Unknown Anime';
        let creatorName = 'Unknown Creator';
        
        // Strategy 1: Breadcrumbs
        try {
          const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb-new li, .breadcrumb li, [class*="breadcrumb"] li'));
          const seriesLi = breadcrumbs.find(li => {
            const meta = li.querySelector('meta[itemprop="position"]');
            return meta && meta.getAttribute('content') === '3';
          });
          if (seriesLi) {
            const span = seriesLi.querySelector('span[itemprop="name"]');
            if (span) animeName = span.textContent.trim();
          }
          if (animeName === 'Unknown Anime' && breadcrumbs.length >= 2) {
            const span = breadcrumbs[breadcrumbs.length - 2].querySelector('span[itemprop="name"], span');
            if (span) animeName = span.textContent.trim();
          }
        } catch(e) {}
        
        // Strategy 2: Title elements fallback
        if (animeName === 'Unknown Anime') {
          const selectors = ['.series-name', '[class*="series"]', 'h1', 'h2'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 0 && el.textContent.trim().length < 100) {
              animeName = el.textContent.trim();
              break;
            }
          }
        }
        
        // Strategy 3: Creator extraction
        try {
          const creatorLink = Array.from(document.querySelectorAll('a[href*="/u/"]')).find(a => {
            const text = a.textContent.toLowerCase();
            return !text.includes('see') && !text.includes('view') && !text.includes('maker');
          });
          if (creatorLink) {
            creatorName = creatorLink.textContent.trim();
          } else {
            const block = document.querySelector('.user_purchased, [class*="creator"], [class*="maker"]');
            if (block) creatorName = block.textContent.replace('Card Maker:', '').trim().split('\n')[0];
          }
        } catch(e) {}
        
        return { animeName, creatorName };
      });

      await detailPage.close();
      this.activeTabs--;

      // Retry ONLY if series is missing
      if (meta.animeName === 'Unknown Anime' && retryCount < 2) {
        await new Promise(r => setTimeout(r, 2000));
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }

      return {
        creator: meta.creatorName === 'Unknown Creator' ? 'Official' : meta.creatorName,
        animeName: meta.animeName,
        description: `${cardName} from ${meta.animeName}`
      };
    } catch (e) {
      if (detailPage) { await detailPage.close().catch(() => {}); this.activeTabs--; }
      if (retryCount < 2) {
        await new Promise(r => setTimeout(r, 3000));
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }
      return { creator: 'Official', animeName: 'Unknown Anime', description: `${cardName} from Unknown Anime` };
    }
  }

  async saveProgress() {
    // Natural Sort for JSON organization
    const tierOrder = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7 };
    this.cards.sort((a, b) => {
      const tierDiff = (tierOrder[a.tier] || 0) - (tierOrder[b.tier] || 0);
      if (tierDiff !== 0) return tierDiff;
      return (a.animeName || '').localeCompare(b.animeName || '');
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
    const backupFile = path.join(this.outputFolder, 'cards_data.backup.json');

    try {
      await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      try {
        await fs.access(this.outputFile);
        await fs.copyFile(this.outputFile, backupFile);
      } catch (e) {}
      await fs.rename(tempFile, this.outputFile);
      console.log(`   💾 Progress Saved: ${this.cards.length} cards total`);
    } catch (error) {
      console.error(`   ❌ Failed to save progress: ${error.message}`);
    }
  }

  async loadProgress() {
    const backupFile = path.join(this.outputFolder, 'cards_data.backup.json');
    const filesToTry = [this.outputFile, backupFile];
    
    // Check for any timestamped backups too
    try {
      const files = await fs.readdir(this.outputFolder);
      const timestamps = files.filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort().reverse().map(f => path.join(this.outputFolder, f));
      filesToTry.push(...timestamps);
    } catch (e) {}

    for (const file of filesToTry) {
      try {
        const data = await fs.readFile(file, 'utf-8');
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (parsed.cards) {
          this.cards = parsed.cards;
          this.cardUrlSet = new Set();
          parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
          this.processedPages = new Set(parsed.processedPages || []);
          console.log(`📂 Resuming from ${this.cards.length} cards, ${this.processedPages.size} pages (Loaded from ${path.basename(file)})`);
          return;
        }
      } catch (error) {}
    }
    console.log('📝 Starting Fresh Database');
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;

    let page = null;
    let attempts = 0;
    try {
      page = await this.browser.newPage();
      const url = `https://shoob.gg/cards?page=${pageNum}&tier=${tier}`;

      while (attempts < 3) {
        attempts++;
        console.log(`📑 [Tier ${tier} P${pageNum}] Loading... Attempt ${attempts}/3`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Anti-block detection
        const content = await page.evaluate(() => document.body.textContent);
        if (content.includes('Cloudflare') || content.includes('Access Denied')) {
          console.log('⚠️  Block detected! Waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
          continue;
        }

        // Strategy-based Extraction
        const extraction = await page.evaluate(() => {
          const cards = [];
          const seen = new Set();
          // Look for all card-like links
          const links = document.querySelectorAll('a[href*="/cards/info/"], a[href*="/card/"]');
          links.forEach(link => {
            const img = link.querySelector('img');
            if (img && img.src && !img.src.includes('card_back')) {
              if (!seen.has(img.src)) {
                cards.push({ imageUrl: img.src, detailUrl: link.href, cardName: img.alt?.trim() || 'Unknown' });
                seen.add(img.src);
              }
            }
          });
          return cards;
        });

        if (extraction.length > 0) {
          console.log(`🚀 [Tier ${tier} P${pageNum}] Scraping ${extraction.length} cards...`);
          
          // Small batches of 2 for 1GB RAM stability
          const batchSize = 2;
          for (let i = 0; i < extraction.length; i += batchSize) {
            const batch = extraction.slice(i, i + batchSize);
            await Promise.all(batch.map(async (card) => {
              if (this.cardUrlSet.has(card.imageUrl)) return;
              const meta = await this.fetchMetadataByOpeningTab(card.detailUrl, card.cardName);
              if (meta.animeName !== 'Unknown Anime') {
                const enriched = { 
                  ...card, ...meta, 
                  tier, page: pageNum, 
                  scrapedAt: new Date().toISOString() 
                };
                this.cards.push(enriched);
                this.cardUrlSet.add(card.imageUrl);
                console.log(`      ✨ [${enriched.creator}] ${enriched.description}`);
              }
            }));
            await new Promise(r => setTimeout(r, 1500));
          }
          this.processedPages.add(pageKey);
          break;
        } else {
          console.log(`⚠️  No cards found on P${pageNum}. Retrying...`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      
      if (attempts >= 3 && !this.processedPages.has(pageKey)) {
        await page.screenshot({ path: path.join(this.outputFolder, `error-p${pageNum}.png`) });
      }

      await page.close();
    } catch (error) {
      console.error(`❌ [Tier ${tier} P${pageNum}] Fatal: ${error.message}`);
      if (page) await page.close().catch(() => {});
    }
  }

  async start() {
    process.on('SIGINT', async () => {
      console.log('\n⚠️  Emergency Save...');
      await this.saveProgress();
      process.exit(0);
    });

    try {
      await this.loadProgress();
      await this.initialize();
      
      for (const tier of this.tiers) {
        console.log(`\n🌀 STARTING TIER ${tier}...`);
        for (let p = this.startPage; p <= this.endPage; p++) {
          if (this.processedPages.has(`${tier}-${p}`)) {
            if (p % 100 === 0) console.log(`⏩ Fast-forwarding P${p}...`);
            continue;
          }
          await this.scrapePage(tier, p);
          // Save every 5 pages
          if (p % 5 === 0) await this.saveProgress();
        }
      }
      console.log('\n👑 ALL FINISHED!');
    } catch (error) {
      console.error('\n❌ CRASH:', error.message);
      await this.saveProgress().catch(() => {});
    } finally {
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }
}

const config = { startPage: 1, endPage: 2332, tiers: ['1', '2', '3', '4', '5', '6', 'S'] };
(async () => { await new ShoobCardScraper(config).start(); })();
