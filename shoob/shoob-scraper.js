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
    this.isSaving = false;
  }

  async cleanup() {
    const { exec } = require('child_process');
    const isWindows = process.platform === 'win32';
    return new Promise((resolve) => {
      const cmd = isWindows ? 'taskkill /F /IM chrome.exe /T 2>nul' : 'pkill -9 chrome 2>/dev/null';
      exec(cmd, () => {
        if (isWindows) exec('taskkill /F /IM chromium.exe /T 2>nul', () => setTimeout(resolve, 1000));
        else exec('pkill -9 chromium 2>/dev/null', () => setTimeout(resolve, 1000));
      });
    });
  }

  async initialize() {
    console.log('🚀 Initializing Stable Server Scraper...');
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: 'new', // Required for Railway
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-first-run', '--no-zygote', '--window-size=1920,1080'
      ]
    });

    const token = process.env.GITHUB_TOKEN;
    console.log(token ? '✅ GitHub Sync: ENABLED' : '⚠️  GitHub Sync: DISABLED');
    console.log('✅ Browser Engine Ready\n');
  }

  async extractCardsFromPage(targetPage) {
    return await targetPage.evaluate(() => {
      const results = { cards: [] };
      const blacklist = ['shoob home', 'home', 'shoob logo', 'navigation', 'nav', 'menu', 'header', 'footer'];
      const isBlacklisted = (name) => {
        const lower = (name || '').toLowerCase().trim();
        return blacklist.some(term => lower === term || lower.includes(term));
      };

      // Exact strategies from old.js
      const strategies = [
        () => {
          const found = [];
          document.querySelectorAll('a[href*="/cards/info/"], a[href*="/card/"]').forEach(link => {
            const img = link.querySelector('img');
            if (img && img.src && !img.src.includes('card_back')) {
              const name = img.alt || 'Unknown';
              if (!isBlacklisted(name)) found.push({ imageUrl: img.src, detailUrl: link.href, cardName: name });
            }
          });
          return found;
        },
        () => {
          const found = [];
          document.querySelectorAll('img').forEach(img => {
            if (!img.src || img.src.includes('card_back')) return;
            const link = img.closest('a');
            if (link && (link.href.includes('shoob.gg') || link.href.includes('/card'))) {
              const name = img.alt || 'Unknown';
              if (!isBlacklisted(name)) found.push({ imageUrl: img.src, detailUrl: link.href, cardName: name });
            }
          });
          return found;
        }
      ];

      let best = [];
      strategies.forEach(s => { const r = s(); if (r.length > best.length) best = r; });
      
      const seen = new Set();
      best.forEach(c => { if (!seen.has(c.detailUrl)) { results.cards.push(c); seen.add(c.detailUrl); } });
      return results;
    });
  }

  async fetchMetadata(page, card, tier, pageNum, attempt = 1) {
    try {
      await page.goto(card.detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2500)); // Wait for JS

      const meta = await page.evaluate(() => {
        let animeName = 'Unknown Anime';
        let creatorName = 'Official';
        
        const bread = Array.from(document.querySelectorAll('.breadcrumb-new li, .breadcrumb li'));
        const seriesLi = bread.find(li => li.querySelector('meta[itemprop="position"]')?.getAttribute('content') === '3') || bread[bread.length - 2];
        if (seriesLi) animeName = seriesLi.querySelector('span')?.textContent.trim() || seriesLi.textContent.trim();

        if (animeName === 'Unknown Anime') {
          const el = document.querySelector('.series-name, [class*="series"], h1, h2');
          if (el) animeName = el.textContent.trim();
        }

        const creatorLink = Array.from(document.querySelectorAll('a[href*="/u/"]')).find(a => !a.textContent.includes('See'));
        if (creatorLink) creatorName = creatorLink.textContent.trim();
        
        return { animeName, creatorName };
      });

      if (meta.animeName === 'Unknown Anime' && attempt < 3) return await this.fetchMetadata(page, card, tier, pageNum, attempt + 1);

      console.log(`   ✨ [${meta.creatorName}] ${card.cardName}`);
      return { ...card, ...meta, tier, page: pageNum, creator: meta.creatorName, scrapedAt: new Date().toISOString() };
    } catch (e) {
      if (attempt < 3) return await this.fetchMetadata(page, card, tier, pageNum, attempt + 1);
      return { ...card, creator: 'Official', animeName: 'Unknown Anime', tier, page: pageNum };
    }
  }

  async saveProgress() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      // Natural Sort
      const tierOrder = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7 };
      this.cards.sort((a, b) => {
        const tA = tierOrder[a.tier] || 9, tB = tierOrder[b.tier] || 9;
        return tA !== tB ? tA - tB : (a.animeName || '').localeCompare(b.animeName || '');
      });

      const data = {
        totalCards: this.cards.length,
        processedPages: Array.from(this.processedPages).sort((a,b) => {
          const [aT, aP] = a.split('-').map(Number), [bT, bP] = b.split('-').map(Number);
          return aT !== bT ? aT - bT : aP - bP;
        }),
        cards: this.cards,
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');
      if (process.env.GITHUB_TOKEN && this.processedPages.size % 5 === 0) await this.syncToGitHub();
    } finally { this.isSaving = false; }
  }

  async syncToGitHub() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const token = process.env.GITHUB_TOKEN;
    const repoUrl = `https://${token}@github.com/BrainMell/scrapers.git`;
    try {
      await execPromise('git config user.email "bot@scrapers.com"');
      await execPromise('git config user.name "Scraper Bot"');
      await execPromise(`git remote set-url origin ${repoUrl}`);
      await execPromise('git fetch origin master');
      await execPromise('git add shoob/shoob_cards/cards_data.json');
      const { stdout: status } = await execPromise('git status --porcelain');
      if (!status.trim()) return;
      await execPromise('git commit -m "📊 Auto-update data"');
      await execPromise('git push origin master --force');
      console.log('✅ GitHub Synced');
    } catch (e) { console.error('   ❌ Sync Failed:', e.message); }
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.cards = parsed.cards || [];
      this.processedPages = new Set(parsed.processedPages || []);
      this.cards.forEach(c => this.cardUrlSet.add(c.imageUrl));
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done\n`);
    } catch (e) {}
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;

    let page = null;
    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum}`);
      page = await this.browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      await page.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 4000)); // Hard wait for React

      const extraction = await this.extractCardsFromPage(page);
      if (extraction.cards.length === 0) {
        const isEnd = await page.evaluate(() => document.body.innerText.includes('No cards found'));
        if (isEnd) { this.processedPages.add(pageKey); await page.close(); return 'TIER_END'; }
        console.log('   ⚠️ Empty page, skipping...');
        await page.close(); return;
      }

      const cardsToScrape = extraction.cards.filter(c => !this.cardUrlSet.has(c.imageUrl));
      extraction.cards.forEach(c => { if (this.cardUrlSet.has(c.imageUrl)) console.log(`      ⏭️  [Known] ${c.cardName}`); });

            if (cardsToScrape.length > 0) {

              console.log(`   ⚡ Scraping metadata for ${cardsToScrape.length} new cards in parallel batches...`);

              

              // Process in batches of 5 to keep RAM low but speed high

              const batchSize = 5;

              for (let i = 0; i < cardsToScrape.length; i += batchSize) {

                const batch = cardsToScrape.slice(i, i + batchSize);

                await Promise.all(batch.map(async (card) => {

                  const worker = await this.browser.newPage();

                  try {

                    // Aggressive Interception: Only allow document and script

                    await worker.setRequestInterception(true);

                    worker.on('request', (req) => {

                      const type = req.resourceType();

                      if (['image', 'stylesheet', 'font', 'media', 'other', 'manifest'].includes(type)) {

                        req.abort();

                      } else {

                        req.continue();

                      }

                    });

      

                    const res = await this.fetchMetadata(worker, card, tier, pageNum);

                    if (res) {

                      this.cards.push(res);

                      this.cardUrlSet.add(res.imageUrl);

                    }

                  } catch (err) {

                    console.error(`      ❌ Error fetching metadata: ${err.message}`);

                  } finally {

                    await worker.close().catch(() => {});

                  }

                }));

                console.log(`      ✓ Batch ${Math.floor(i/batchSize) + 1} complete`);

              }

            }

      this.processedPages.add(pageKey);
      await this.saveProgress();
      await page.close();
    } catch (error) {
      if (page) await page.close().catch(() => {});
      console.error(`❌ Error P${pageNum}: ${error.message}`);
    }
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          const res = await this.scrapePage(tier, p);
          if (res === 'TIER_END') break;
        }
      }
    } finally { if (this.browser) await this.browser.close().catch(() => {}); }
  }
}

new ShoobCardScraper({ startPage: 1, endPage: 2332, tiers: ['1', '2', '3', '4', '5', '6', 'S'] }).start();
