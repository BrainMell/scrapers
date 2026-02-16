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
    this.backupFile = path.join(this.outputFolder, 'cards_data.backup.json');
    this.concurrency = 1; // 1GB RAM SAFETY
    
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

  async setupPage(page) {
    // BLOCK IMAGES AND CSS TO SAVE RAM AND SPEED UP
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setViewport({ width: 800, height: 600 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  }

  async initialize() {
    console.log(`🚀 1GB RAM OPTIMIZED - FAST MODE`);
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu', 
        '--js-flags="--max-old-space-size=512"',
        '--window-size=1280,720',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    console.log('✅ Browser Engine Ready\n');
  }

  async extractCardsFromPage(targetPage) {
    return await targetPage.evaluate(() => {
      const results = { cards: [] };
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        const alt = img.alt || '';
        const link = img.closest('a');
        if (link && link.href && (link.href.includes('/cards/info/') || link.href.includes('/card/'))) {
          // Note: src might be blocked by interception, so we rely on DOM structure
          if (!results.cards.some(c => c.detailUrl === link.href)) {
            results.cards.push({ imageUrl: src, detailUrl: link.href, cardName: alt.trim() || 'Unknown' });
          }
        }
      });
      return results;
    });
  }

  async fetchMetadata(page, detailUrl, cardName, retryCount = 0) {
    if (!detailUrl) return { animeName: 'Unknown Anime', creator: 'Unknown Creator' };
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.querySelectorAll('.breadcrumb-new span[itemprop].name, .breadcrumb-new span[itemprop="name"]').length >= 2, { timeout: 10000 });
      
      const meta = await page.evaluate(() => {
        const bread = Array.from(document.querySelectorAll('.breadcrumb-new li'));
        const seriesLi = bread.find(li => li.querySelector('meta[itemprop="position"]')?.getAttribute('content') === '3') || bread[bread.length - 2];
        const animeName = seriesLi?.querySelector('span[itemprop="name"]')?.textContent.trim() || 'Unknown Anime';
        const creatorBlock = document.querySelector('.user_purchased.padded20');
        let creatorName = 'Unknown Creator';
        if (creatorBlock) {
          const p = creatorBlock.querySelector('p');
          if (p) creatorName = p.textContent.replace('Created by', '').trim();
        }
        return { animeName, creatorName };
      });
      return { creator: meta.creatorName, animeName: meta.animeName, description: `${cardName} from ${meta.animeName}` };
    } catch (e) {
      if (retryCount < 3) {
        await new Promise(r => setTimeout(r, 1000));
        return await this.fetchMetadata(page, detailUrl, cardName, retryCount + 1);
      }
      return { creator: 'Unknown Creator', animeName: 'Unknown Anime', description: `${cardName} from Unknown Anime` };
    }
  }

  async saveProgress() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      this.cards.sort((a, b) => {
        if (a.tier !== b.tier) return String(a.tier).localeCompare(String(b.tier));
        return a.page - b.page;
      });
      const data = {
        totalCards: this.cards.length,
        processedPages: Array.from(this.processedPages).sort(),
        cards: this.cards,
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');
      if (process.env.GITHUB_TOKEN) await this.syncToGitHub();
    } finally {
      this.isSaving = false;
    }
  }

  async syncToGitHub() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    try {
      const token = process.env.GITHUB_TOKEN;
      const repoUrl = `https://${token}@github.com/BrainMell/scrapers.git`;
      await execPromise('git config user.email "bot@scrapers.com"');
      await execPromise('git config user.name "Scraper Bot"');
      try { await execPromise('git rev-parse --is-inside-work-tree'); } catch (e) {
        await execPromise('git init');
        await execPromise(`git remote add origin ${repoUrl}`);
      }
      await execPromise(`git remote set-url origin ${repoUrl}`);
      await execPromise('git fetch origin master');
      await execPromise('git reset origin/master'); 
      await execPromise('git add shoob/shoob_cards/cards_data.json');
      const { stdout: status } = await execPromise('git status --porcelain');
      if (!status.trim()) return;
      await execPromise('git commit -m "📊 Auto-update scraped cards data [skip ci]"');
      try { await execPromise('git push origin master'); } catch (pushErr) {
        await execPromise('git push origin master --force');
      }
    } catch (e) {
      console.error('   ❌ Sync Failed:', e.message);
    }
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.cards = parsed.cards || [];
      this.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
      this.processedPages = new Set(parsed.processedPages || []);
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done\n`);
    } catch (e) {}
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;
    if (this.processedPages.size > 0 && this.processedPages.size % 20 === 0) {
      console.log('♻️ RAM Cleanup...');
      if (this.browser) await this.browser.close().catch(() => {});
      await this.initialize();
    }
    let listPage = null;
    let metaPage = null;
    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum}`);
      listPage = await this.browser.newPage();
      await this.setupPage(listPage);
      await listPage.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Wait for at least one card element to appear (images are blocked so we check the links)
      try {
        await listPage.waitForSelector('a[href*="/cards/info/"], a[href*="/card/"]', { timeout: 15000 });
      } catch (e) {
        console.log(`   📸 [DEBUG] Page ${pageNum} didn't load in time.`);
      }

      const extraction = await this.extractCardsFromPage(listPage);
      if (extraction.cards.length === 0) {
        console.log(`   ⚠️ No cards found on page ${pageNum}`);
        this.processedPages.add(pageKey);
        await listPage.close();
        return;
      }

      metaPage = await this.browser.newPage();
      await this.setupPage(metaPage);

      let newCardsOnPage = 0;
      for (const card of extraction.cards) {
        // Since images are blocked, imageUrl might be empty, so we check detailUrl
        if (this.cards.some(c => c.detailUrl === card.detailUrl)) continue;
        newCardsOnPage++;
        const meta = await this.fetchMetadata(metaPage, card.detailUrl, card.cardName);
        this.cards.push({ ...card, ...meta, tier, page: pageNum, scrapedAt: new Date().toISOString() });
        console.log(`   ✨ [${meta.creator}] ${card.cardName}`);
      }

      console.log(`   📊 Page ${pageNum}: ${extraction.cards.length} cards found (${newCardsOnPage} new)`);
      this.processedPages.add(pageKey);
      await this.saveProgress();
      await listPage.close();
      if (metaPage) await metaPage.close();
    } catch (error) {
      if (listPage) await listPage.close().catch(() => {});
      if (metaPage) await metaPage.close().catch(() => {});
      console.error(`❌ Error P${pageNum}: ${error.message}`);
    }
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          await this.scrapePage(tier, p);
        }
      }
    } catch (error) {
      console.error('Fatal:', error.message);
    } finally {
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }
}

new ShoobCardScraper({
  startPage: 1,
  endPage: 2332,
  tiers: ['1', '2', '3', '4', '5', '6', 'S']
}).start();
