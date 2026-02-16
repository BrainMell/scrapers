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
    this.concurrency = config.concurrency || 3; // Number of main pages to process in parallel
    
    this.cards = [];
    this.cardUrlSet = new Set();
    this.processedPages = new Set();
    
    this.consecutiveFailures = 0;
    this.totalAttempts = 0;
    this.successfulAttempts = 0;
    
    this.browser = null;
    this.isSaving = false;
    this.lastPushedCount = 0; // Track last push
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

  async setupPage(page) {
    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
  }

  async initialize() {
    console.log(`🚀 ULTRA AGGRESSIVE MODE - 32GB RAM UTILIZED`);
    console.log(`🚀 Processing ${this.concurrency} pages at once (~${this.concurrency * 15} tabs)`);
    console.log('🧹 Cleaning up old Chrome processes...');
    await this.cleanup();
    
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    // Close default blank page
    const pages = await this.browser.pages();
    for (const page of pages) {
      await page.close().catch(() => {});
    }
    
    console.log('✅ Browser Engine Ready\n');
  }

  async extractCardsFromPage(targetPage) {
    return await targetPage.evaluate(() => {
      const results = { cards: [] };
      const allImages = Array.from(document.querySelectorAll('img'));
      
      allImages.forEach(img => {
        const src = img.src || '';
        const alt = img.alt || '';
        const link = img.closest('a');
        
        if (link && link.href && (link.href.includes('/cards/info/') || link.href.includes('/card/'))) {
          if (src.includes('card_back.png') || alt.toLowerCase().includes('card back')) {
            return;
          }
          
          if (!results.cards.some(c => c.imageUrl === src)) {
            results.cards.push({
              imageUrl: src,
              detailUrl: link.href,
              cardName: alt.trim() || 'Unknown'
            });
          }
        }
      });
      
      return results;
    });
  }

  async fetchMetadataByOpeningTab(detailUrl, cardName, retryCount = 0) {
    if (!detailUrl) return { animeName: 'Unknown Anime', creator: 'Unknown Creator' };
    
    let detailPage = null;
    try {
      detailPage = await this.browser.newPage();
      await this.setupPage(detailPage);
      await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // AGGRESSIVE WAIT - 4 RETRIES
      await detailPage.waitForFunction(() => {
        const b = document.querySelectorAll('.breadcrumb-new span[itemprop="name"]');
        const c = document.querySelector('.user_purchased.padded20 p');
        return b.length >= 3 && c && c.textContent.trim().length > 2;
      }, { timeout: 20000 });

      const meta = await detailPage.evaluate(() => {
        const bread = Array.from(document.querySelectorAll('.breadcrumb-new li'));
        const seriesLi = bread.find(li => li.querySelector('meta[itemprop="position"]')?.getAttribute('content') === '3') || bread[bread.length - 2];
        const animeName = seriesLi?.querySelector('span[itemprop="name"]')?.textContent.trim() || 'Unknown Anime';

        const creatorBlock = document.querySelector('.user_purchased.padded20');
        let creatorName = 'Unknown Creator';
        if (creatorBlock) {
          const p = creatorBlock.querySelector('p');
          if (p) {
            const clone = p.cloneNode(true);
            const badge = clone.querySelector('span.padr5');
            if (badge) badge.remove();
            creatorName = clone.textContent.trim();
          }
        }
        return { animeName, creatorName };
      });

      await detailPage.close();

      // Track success rate
      this.totalAttempts++;
      if (meta.animeName !== 'Unknown Anime' && meta.creatorName !== 'Unknown Creator') {
        this.successfulAttempts++;
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
      }

      // 6 RETRIES
      if ((meta.animeName === 'Unknown Anime' || meta.creatorName === 'Unknown Creator') && retryCount < 6) {
        console.log(`      🔄 [RETRY ${retryCount + 1}/6] "${cardName}"`);
        await new Promise(r => setTimeout(r, 3000));
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }

      return {
        creator: meta.creatorName,
        animeName: meta.animeName,
        description: `${cardName} from ${meta.animeName}`
      };
    } catch (e) {
      if (detailPage) await detailPage.close().catch(() => {});
      
      this.totalAttempts++;
      this.consecutiveFailures++;
      
      // Check for internet issues
      if (e.message.includes('net::ERR_INTERNET_DISCONNECTED') || 
          e.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        throw new Error('INTERNET_DOWN');
      }
      
      if (retryCount < 6) {
        console.log(`      🔄 [RETRY ${retryCount + 1}/6] Error: "${cardName}"`);
        await new Promise(r => setTimeout(r, 3000));
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }
      
      return { 
        creator: 'Unknown Creator', 
        animeName: 'Unknown Anime', 
        description: `${cardName} from Unknown Anime` 
      };
    }
  }

  getSuccessRate() {
    if (this.totalAttempts === 0) return 100;
    return Math.round((this.successfulAttempts / this.totalAttempts) * 100);
  }

  async saveProgress() {
    if (this.isSaving) return;
    this.isSaving = true;
    
    try {
      // Sort cards to keep them in order
      this.cards.sort((a, b) => {
        if (a.tier !== b.tier) return String(a.tier).localeCompare(String(b.tier));
        return a.page - b.page;
      });

      const data = {
        totalCards: this.cards.length,
        processedPages: Array.from(this.processedPages).sort((a, b) => {
          const [tierA, pageA] = a.split("-");
          const [tierB, pageB] = b.split("-");
          if (tierA !== tierB) return tierA.localeCompare(tierB);
          return parseInt(pageA) - parseInt(pageB);
        }),
        cards: this.cards,
        lastUpdated: new Date().toISOString(),
        stats: {
          successRate: this.getSuccessRate(),
          totalAttempts: this.totalAttempts,
          successfulAttempts: this.successfulAttempts
        }
      };
      
      const tmpFile = this.outputFile + '.tmp';
      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      
      // Retry rename on Windows (handles EPERM)
      let renamed = false;
      for (let i = 0; i < 5; i++) {
        try {
          await fs.rename(tmpFile, this.outputFile);
          renamed = true;
          break;
        } catch (e) {
          if (i === 4) throw e;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      if (renamed) {
        await fs.copyFile(this.outputFile, this.backupFile).catch(() => {});
      }
      
      // Auto-sync to GitHub every 500 new cards
      if (process.env.GITHUB_TOKEN && this.cards.length >= this.lastPushedCount + 500) {
        await this.syncToGitHub();
        this.lastPushedCount = this.cards.length;
      }
      
      if (this.cards.length % 50 === 0 && this.cards.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const timestampedBackup = path.join(this.outputFolder, `backup-${timestamp}-${this.cards.length}cards.json`);
        await fs.copyFile(this.outputFile, timestampedBackup).catch(() => {});
      }
    } finally {
      this.isSaving = false;
    }
  }

  async syncToGitHub() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    console.log('📤 Syncing progress to GitHub...');
    try {
      const token = process.env.GITHUB_TOKEN;
      const repoUrl = `https://${token}@github.com/BrainMell/scrapers.git`;
      
      await execPromise('git config user.email "bot@scrapers.com"');
      await execPromise('git config user.name "Scraper Bot"');
      await execPromise(`git remote set-url origin ${repoUrl}`);
      await execPromise('git add shoob/shoob_cards/cards_data.json');
      // [skip ci] prevents Railway from rebuilding every time we push data
      await execPromise('git commit -m "📊 Auto-update scraped cards data [skip ci]"');
      await execPromise('git push origin master');
      console.log('✅ GitHub Sync Successful');
    } catch (e) {
      console.error('❌ GitHub Sync Failed:', e.message);
    }
  }

  async loadProgress() {
    let loadedFrom = null;
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.cards) {
        this.cards = parsed.cards;
        parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
        if (parsed.processedPages) {
          this.processedPages = new Set(parsed.processedPages);
        }
        loadedFrom = 'main';
      }
    } catch (error) {
      try {
        const data = await fs.readFile(this.backupFile, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed.cards) {
          this.cards = parsed.cards;
          parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
          this.processedPages = new Set(parsed.processedPages || []);
          loadedFrom = 'backup';
        }
      } catch (e) {}
    }
    
    if (loadedFrom) {
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done\n`);
    } else {
      console.log('📝 Starting fresh\n');
    }
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;

    // Restart browser every 20 pages to clear memory leaks
    if (this.processedPages.size > 0 && this.processedPages.size % 20 === 0) {
      console.log('♻️ RAM Cleanup: Restarting browser engine...');
      if (this.browser) await this.browser.close().catch(() => {});
      await this.initialize();
    }

    // BAD INTERNET DETECTION
    if (this.consecutiveFailures >= 10) {
      const successRate = this.getSuccessRate();
      if (successRate < 30) {
        console.log(`\n⚠️  BAD INTERNET DETECTED! Success rate: ${successRate}%`);
        await this.saveProgress();
        await new Promise(r => setTimeout(r, 60000));
        this.consecutiveFailures = 0;
      }
    }

    let listPage = null;
    try {
      console.log(`📄 [START] TIER ${tier} | PAGE ${pageNum}`);
      listPage = await this.browser.newPage();
      await this.setupPage(listPage);
      
      const url = `https://shoob.gg/cards?page=${pageNum}&tier=${tier}`;
      await listPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      let extraction = { cards: [] };
      for (let i = 0; i < 20; i++) {
        extraction = await this.extractCardsFromPage(listPage);
        if (extraction.cards.length >= 15) break;
        if (i < 19) await new Promise(r => setTimeout(r, 1500));
      }

      if (extraction.cards.length === 0) {
        console.log(`   ⚠️  No cards on page ${pageNum} - skipping`);
        await listPage.close();
        return;
      }

      // SEQUENTIAL PROCESSING (RAM Friendly)
      // Instead of opening 15 tabs at once, we do them one by one.
      // This ensures 1GB RAM is never exceeded.
      for (const card of extraction.cards) {
        if (this.cardUrlSet.has(card.imageUrl)) continue;
        
        try {
          const meta = await this.fetchMetadataByOpeningTab(card.detailUrl, card.cardName);
          if (meta.animeName !== 'Unknown Anime' && meta.creator !== 'Unknown Creator') {
            const enrichedCard = { ...card, ...meta, tier, page: pageNum, scrapedAt: new Date().toISOString() };
            this.cards.push(enrichedCard);
            this.cardUrlSet.add(card.imageUrl);
            console.log(`      ✨ [${enrichedCard.creator}] ${enrichedCard.cardName}`);
          }
        } catch (e) {
          if (e.message === 'INTERNET_DOWN') throw e;
        }
      }

      this.processedPages.add(pageKey);
      await this.saveProgress();
      
      console.log(`📄 [DONE] TIER ${tier} | PAGE ${pageNum} (${this.getSuccessRate()}% success)`);
      
      await listPage.close();
      await new Promise(r => setTimeout(r, 2000)); 

    } catch (error) {
      if (listPage) await listPage.close().catch(() => {});
      console.error(`   ❌ Error on page ${pageNum}: ${error.message}`);
      if (error.message === 'INTERNET_DOWN') {
        await new Promise(r => setTimeout(r, 120000));
      }
    }
  }

  async start() {
    const shutdown = async () => {
      console.log(`\n⚠️  Shutting down...`);
      await this.saveProgress().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    try {
      await this.loadProgress();
      await this.initialize();
      
      const allTasks = [];
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          allTasks.push({ tier, page: p });
        }
      }

      console.log(`📋 Total tasks: ${allTasks.length} pages`);
      
      // Process in batches for parallel execution
      for (let i = 0; i < allTasks.length; i += this.concurrency) {
        const batch = allTasks.slice(i, i + this.concurrency);
        console.log(`\n⚡ Processing batch ${Math.floor(i/this.concurrency) + 1} (${batch.length} pages)...`);
        await Promise.all(batch.map(task => this.scrapePage(task.tier, task.page)));
        
        if (i % (this.concurrency * 5) === 0) {
          console.log(`   💾 Interval Save: ${this.cards.length} cards total`);
          await this.saveProgress();
        }
      }
      
      console.log('\n✅ All tiers completed!');
    } catch (error) {
      console.error('\n❌ Fatal:', error.message);
      await this.saveProgress().catch(() => {});
    } finally {
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }
}

const config = {
  startPage: 1,
  endPage: 2332,
  tiers: ['1', '2', '3', '4', '5', '6', 'S'],
  concurrency: 1 // Reduced to 1 for 1GB RAM stability
};

(async () => {
  const scraper = new ShoobCardScraper(config);
  await scraper.start();
})();
