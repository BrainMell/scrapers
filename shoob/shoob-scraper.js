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

  async setupPage(page, blockCss = true) {
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url().toLowerCase();
      const shouldBlock = blockCss ? ['image', 'stylesheet', 'font', 'media', 'other'] : ['image', 'font', 'media', 'other'];
      if (shouldBlock.includes(type) || url.includes('google-analytics') || url.includes('doubleclick')) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  }

  async initialize() {
    console.log(`🚀 PEAK MODE v4: Vision + Network Idle`);
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', 
        '--disable-gpu', '--js-flags="--max-old-space-size=450"',
        '--disable-extensions', '--no-first-run', '--no-zygote'
      ]
    });
    console.log('✅ Browser Engine Ready\n');
  }

  async extractCardsFromPage(targetPage) {
    return await targetPage.evaluate(() => {
      const results = { cards: [] };
      const cardElements = document.querySelectorAll('a[href*="/cards/info/"], a[href*="/card/"]');
      cardElements.forEach(link => {
        if (link.closest('nav') || link.closest('footer') || link.classList.contains('nav-link')) return;
        const img = link.querySelector('img');
        const src = img ? (img.src || img.getAttribute('data-src') || '') : '';
        const alt = img ? (img.alt || '') : (link.textContent.trim() || 'Unknown');
        if (src.includes('card_back.png') || alt.toLowerCase().includes('card back')) return;
        if (!results.cards.some(c => c.detailUrl === link.href)) {
          results.cards.push({ imageUrl: src, detailUrl: link.href, cardName: alt.split('\n')[0].trim() || 'Unknown' });
        }
      });
      return results;
    });
  }

  async fetchMetadata(page, card, tier, pageNum) {
    if (!card.detailUrl) return null;
    try {
      await page.goto(card.detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForSelector('.breadcrumb-new', { timeout: 15000 });
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
      console.log(`   ✨ [${meta.creatorName}] ${card.cardName}`);
      return { ...card, ...meta, tier, page: pageNum, creator: meta.creatorName, scrapedAt: new Date().toISOString() };
    } catch (e) {
      return { ...card, creator: 'Unknown Creator', animeName: 'Unknown Anime', tier, page: pageNum, scrapedAt: new Date().toISOString() };
    }
  }

  async saveProgress(forceSync = false) {
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
      if (process.env.GITHUB_TOKEN && (forceSync || this.processedPages.size % 5 === 0)) {
        await this.syncToGitHub();
      }
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
      try { await execPromise('git rev-parse --is-inside-work-tree'); } catch (e) {
        await execPromise('git init');
        await execPromise(`git remote add origin ${repoUrl}`);
      }
      await execPromise('git config user.email "bot@scrapers.com"');
      await execPromise('git config user.name "Scraper Bot"');
      await execPromise(`git remote set-url origin ${repoUrl}`);
      await execPromise('git fetch origin master');
      await execPromise('git reset origin/master'); 
      await execPromise('git add shoob/shoob_cards/cards_data.json shoob/shoob_cards/*.png');
      const { stdout: status } = await execPromise('git status --porcelain');
      if (!status.trim()) return;
      await execPromise('git commit -m "📊 Auto-update [skip ci]"');
      try { await execPromise('git push origin master'); } catch (pushErr) {
        await execPromise('git push origin master --force');
      }
      console.log('✅ GitHub Synced');
    } catch (e) {
      console.error('   ❌ Sync Failed:', e.message);
    }
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.cards = parsed.cards || [];
      this.processedPages = new Set(parsed.processedPages || []);
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done\n`);
    } catch (e) {}
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;
    
    if (this.processedPages.size > 0 && this.processedPages.size % 10 === 0) {
      console.log('♻️ RAM Cleanup: Browser Restart...');
      if (this.browser) await this.browser.close().catch(() => {});
      await this.initialize();
    }

    let listPage = null;
    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum}`);
      listPage = await this.browser.newPage();
      await this.setupPage(listPage, false);
      await listPage.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 60000 });
      
      const title = await listPage.title();
      console.log(`   🌐 Page Title: ${title}`);

      try {
        await listPage.waitForSelector('.card-name, .card-box, div.padded20', { timeout: 15000 });
      } catch (e) {}

      let extraction = await this.extractCardsFromPage(listPage);
      
      if (extraction.cards.length === 0) {
        console.log(`   ⚠️ No cards found. Capturing screenshot...`);
        await listPage.screenshot({ path: path.join(this.outputFolder, `error-tier${tier}-p${pageNum}.png`) });
        await this.syncToGitHub(); // Force sync the screenshot so we can see it!
        
        // Final End of Tier Check
        const isEnd = await listPage.evaluate(() => document.body.innerText.includes('No cards found'));
        if (isEnd) {
          console.log(`   🏁 Tier ${tier} finished at page ${pageNum - 1}`);
          this.processedPages.add(pageKey);
          await listPage.close();
          return 'TIER_END';
        }
        await listPage.close();
        return;
      }

      await listPage.close(); 
      listPage = null;

      const cardsToScrape = extraction.cards.filter(c => !this.cards.some(existing => existing.detailUrl === c.detailUrl));
      
      if (cardsToScrape.length > 0) {
        const worker1 = await this.browser.newPage();
        const worker2 = await this.browser.newPage();
        await Promise.all([this.setupPage(worker1, true), this.setupPage(worker2, true)]);

        const results = [];
        for (let i = 0; i < cardsToScrape.length; i += 2) {
          const pair = cardsToScrape.slice(i, i + 2);
          const tasks = pair.map((card, idx) => 
            this.fetchMetadata(idx === 0 ? worker1 : worker2, card, tier, pageNum)
          );
          const batchResults = await Promise.all(tasks);
          results.push(...batchResults.filter(r => r !== null));
        }

        this.cards.push(...results);
        await Promise.all([worker1.close(), worker2.close()]);
      }

      console.log(`   📊 Page ${pageNum}: ${extraction.cards.length} cards found (${cardsToScrape.length} new)`);
      this.processedPages.add(pageKey);
      await this.saveProgress();
    } catch (error) {
      if (listPage) await listPage.close().catch(() => {});
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
