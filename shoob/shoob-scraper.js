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
    
    // We point this to the bot's production cards_data.json as the source of truth!
    this.botDataPath = path.resolve(__dirname, '../../whatsapp-bot/core/data/cards_data.json');
    
    this.outputFolder = config.outputFolder || path.join(__dirname, 'shoob_cards');
    this.outputFile = path.join(this.outputFolder, 'cards_data.json');
    this.backupFile = path.join(this.outputFolder, 'cards_data.backup.json');
    
    this.cards = [];
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
    await page.setCacheEnabled(false);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  }

  async initialize() {
    console.log(`🚀 PEAK MODE v4: Vision + Network Idle (Using system Chrome)`);
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    this.browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: false,
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
      await page.goto(card.detailUrl, { waitUntil: 'networkidle2', timeout: 25000 });
      await page.waitForSelector('.breadcrumb-new', { timeout: 15000 });
      const meta = await page.evaluate(() => {
        const bread = Array.from(document.querySelectorAll('.breadcrumb-new li'));
        const seriesLi = bread.find(li => li.querySelector('meta[itemprop="position"]')?.getAttribute('content') === '3') || bread[bread.length - 2];
        const animeName = seriesLi?.querySelector('span[itemprop="name"]')?.textContent.trim() || 'Unknown Anime';
        const creatorBlock = document.querySelector('.user_purchased.padded20');
        let creatorName = 'Unknown Creator';
        if (creatorBlock) {
          const p = creatorBlock.querySelector('p');
          if (p) creatorName = p.textContent.replace('Created by', '').replace('Card Maker:', '').trim();
        }
        return { animeName, creatorName };
      });
      console.log(`   ✨ [${meta.creatorName}] ${card.cardName}`);
      return { ...card, ...meta, tier, page: pageNum, creator: meta.creatorName, scrapedAt: new Date().toISOString() };
    } catch (e) {
      return { ...card, creator: 'Unknown Creator', animeName: 'Unknown Anime', tier, page: pageNum, scrapedAt: new Date().toISOString() };
    }
  }

  async autoScroll(page) {
    await page.evaluate(async () => {
      let lastHeight = 0;
      let stableCount = 0;
      const distance = 200;
      while (stableCount < 3) {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        await new Promise(r => setTimeout(r, 200));
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
          stableCount++;
        } else {
          stableCount = 0;
          lastHeight = newHeight;
        }
      }
    });
  }

  assignIds() {
    const maxNumByTier = {};
    const tiers = ['1', '2', '3', '4', '5', '6', 'S'];
    
    // First, find the maximum ID number for each tier among cards that already have IDs
    for (const card of this.cards) {
      if (card.id) {
        const parts = card.id.split('-');
        const tier = parts[0];
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) {
          if (!maxNumByTier[tier] || num > maxNumByTier[tier]) {
            maxNumByTier[tier] = num;
          }
        }
      }
    }
    
    // Initialize tiers
    for (const tier of tiers) {
      if (maxNumByTier[tier] === undefined) {
        maxNumByTier[tier] = 0;
      }
    }
    
    // Now assign sequential IDs to cards missing them
    for (const card of this.cards) {
      if (!card.id) {
        const tier = String(card.tier);
        maxNumByTier[tier]++;
        const numStr = String(maxNumByTier[tier]).padStart(5, '0');
        card.id = `${tier}-${numStr}`;
        console.log(`🆕 Assigned new ID ${card.id} to "${card.cardName}"`);
      }
    }
  }

  async saveProgress(forceSync = false) {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      // Assign IDs to new cards
      this.assignIds();
      
      this.cards.sort((a, b) => {
        if (a.tier !== b.tier) return String(a.tier).localeCompare(String(a.tier));
        
        // Sort by id number ascending
        const aNum = parseInt(a.id.split('-')[1], 10);
        const bNum = parseInt(b.id.split('-')[1], 10);
        return aNum - bNum;
      });

      const data = {
        totalCards: this.cards.length,
        uniqueCards: this.cards.length,
        processedPages: Array.from(this.processedPages).sort(),
        cards: this.cards,
        lastUpdated: new Date().toISOString()
      };

      // Write to both scraper repo JSON and whatsapp-bot local JSON
      const jsonContent = JSON.stringify(data, null, 2);
      await fs.writeFile(this.outputFile, jsonContent, 'utf-8');
      await fs.writeFile(this.botDataPath, jsonContent, 'utf-8');
      console.log(`💾 Saved: ${this.cards.length} cards to both databases.`);

      // Sync to GitHub
      await this.syncToGitHub();
    } finally {
      this.isSaving = false;
    }
  }

  async syncToGitHub() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const repoPath = path.join(__dirname, '..');
    try {
      await execPromise('git config user.email "bot@scrapers.com"', { cwd: repoPath });
      await execPromise('git config user.name "Scraper Bot"', { cwd: repoPath });
      await execPromise('git add shoob/shoob_cards/cards_data.json', { cwd: repoPath });
      const { stdout: status } = await execPromise('git status --porcelain', { cwd: repoPath });
      if (!status.trim()) return;
      await execPromise('git commit -m "📊 Auto-update scraped cards data [skip ci]"', { cwd: repoPath });
      await execPromise('git push origin main', { cwd: repoPath });
      console.log('✅ GitHub Synced');
    } catch (e) {
      console.error('   ❌ Sync Failed:', e.message);
    }
  }

  async loadProgress() {
    try {
      // 1. Load from whatsapp-bot JSON
      const botDataRaw = await fs.readFile(this.botDataPath, 'utf-8');
      const botParsed = JSON.parse(botDataRaw);
      const botCards = botParsed.cards || [];

      // 2. Load from scraper repo JSON
      let repoCards = [];
      try {
        const repoDataRaw = await fs.readFile(this.outputFile, 'utf-8');
        const repoParsed = JSON.parse(repoDataRaw);
        repoCards = repoParsed.cards || [];
      } catch (e) {
        console.log("Scraper cards_data.json not found or empty, using bot data as base.");
      }

      // 3. Merge both databases (deduplicate by detailUrl)
      const mergedMap = new Map();
      for (const card of repoCards) {
        if (card.detailUrl) mergedMap.set(card.detailUrl, card);
      }
      for (const card of botCards) {
        if (card.detailUrl) mergedMap.set(card.detailUrl, card);
      }

      this.cards = Array.from(mergedMap.values());

      // Merge processedPages
      const mergedPages = new Set(botParsed.processedPages || []);
      
      // Clear page 1 and 2 of each tier so the scraper always scans them for new cards!
      const tiersToScan = ['1', '2', '3', '4', '5', '6', 'S'];
      for (const tier of tiersToScan) {
        mergedPages.delete(`${tier}-1`);
        mergedPages.delete(`${tier}-2`);
      }

      this.processedPages = mergedPages;
      console.log(`📂 Loaded and merged: ${this.cards.length} cards, ${this.processedPages.size} pages in registry\n`);
    } catch (e) {
      console.error("Error in loadProgress:", e.message);
      // Fallback
      this.cards = [];
      this.processedPages = new Set();
    }
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
      console.log(`📄 TIER ${tier} | PAGE ${pageNum} (Total: ${this.cards.length} cards)`);
      listPage = await this.browser.newPage();
      await this.setupPage(listPage);
      // Navigate to the visible card listing page
      await listPage.goto(`https://shoob.gg/cards?tier=${tier}&page=${pageNum}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.autoScroll(listPage);
      
      const title = await listPage.title();
      console.log(`   🌐 Page Title: ${title}`);

      // Extract cards from page DOM
      const extraction = await this.extractCardsFromPage(listPage);
      
      if (extraction.cards.length === 0) {
        console.log(`   ⚠️ No cards found. Checking if end of tier...`);
        const isEnd = await listPage.evaluate(() => document.body.innerText.includes('No cards found') || document.body.innerText.includes('No result'));
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

      // STRICT DEDUPLICATION: Check both against in-memory cards and existing URLs
      const cardsToScrape = extraction.cards.filter(c => !this.cards.some(existing => existing.detailUrl === c.detailUrl));
      
      if (cardsToScrape.length > 0) {
        console.log(`   ➕ Found ${cardsToScrape.length} new cards to scrape out of ${extraction.cards.length} on page`);
        const worker1 = await this.browser.newPage();
        const worker2 = await this.browser.newPage();
        await Promise.all([this.setupPage(worker1), this.setupPage(worker2)]);

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
      } else {
        console.log(`   ✅ Page ${pageNum}: All ${extraction.cards.length} cards already exist in database.`);
      }

      this.processedPages.add(pageKey);
      await this.saveProgress();

      // IF ALL CARDS WERE ALREADY IN THE DATABASE, WE CAN SAFELY STOP FOR THIS TIER
      if (cardsToScrape.length === 0) {
        console.log(`   ⏭️ Reached already scraped cards. Stopping tier ${tier} scan.`);
        return 'TIER_END';
      }
    } catch (error) {
      if (listPage) await listPage.close().catch(() => {});
      console.error(`❌ Error P${pageNum}: ${error.message}`);
    }
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();
      // Pin pause: if pin file exists, wait until removed
      const pinPath = path.resolve(__dirname, 'pin.txt');
      while (true) {
        try {
          await fs.access(pinPath);
          console.log('🔒 Scraper paused due to pin file. Remove pin.txt to continue...');
          await new Promise(r => setTimeout(r, 5000));
        } catch {
          break;
        }
      }
      for (const tier of this.tiers) {
        console.log(`📄 SCRAPING TIER ${tier}`);
        const listPage = await this.browser.newPage();
        await this.setupPage(listPage);
        // Open tier page without pagination (cards are loaded via infinite scroll)
        await listPage.goto(`https://shoob.gg/cards?tier=${tier}`, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.autoScroll(listPage);
        const extraction = await this.extractCardsFromPage(listPage);
        const cardsToScrape = extraction.cards.filter(c => !this.cards.some(existing => existing.detailUrl === c.detailUrl));
        console.log(`   ➕ Found ${cardsToScrape.length} new cards in tier ${tier}`);
        if (cardsToScrape.length > 0) {
          const WORKER_COUNT = 8;
          const workers = [];
          for (let w = 0; w < WORKER_COUNT; w++) {
            const page = await this.browser.newPage();
            await this.setupPage(page);
            workers.push(page);
          }
          const results = [];
          for (let i = 0; i < cardsToScrape.length; i += WORKER_COUNT) {
            const batchCards = cardsToScrape.slice(i, i + WORKER_COUNT);
            const tasks = batchCards.map((card, idx) =>
              this.fetchMetadata(workers[idx], card, tier, 1)
            );
            const batch = await Promise.all(tasks);
            results.push(...batch.filter(r => r !== null));
          }
          this.cards.push(...results);
          await Promise.all(workers.map(w => w.close()));
        }
        await listPage.close();
        await this.saveProgress();
      }
      console.log("🏁 All tiers scraped!");
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
