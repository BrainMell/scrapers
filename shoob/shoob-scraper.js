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
    
    this.consecutiveFailures = 0;
    this.totalAttempts = 0;
    this.successfulAttempts = 0;
    
    this.browser = null;
    this.page = null;
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
    console.log('🚀 AGGRESSIVE MODE - 32GB RAM - ALL 15 TABS AT ONCE');
    console.log('🧹 Cleaning up old Chrome processes...');
    await this.cleanup();
    
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: false,
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

    this.page = await this.browser.newPage();
    
    // Enhanced stealth
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
    
    console.log('✅ Browser Ready\n');
  }

  async extractCardsFromPage() {
    return await this.page.evaluate(() => {
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
      await detailPage.setViewport({ width: 1024, height: 768 });
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

      // 4 RETRIES
      if ((meta.animeName === 'Unknown Anime' || meta.creatorName === 'Unknown Creator') && retryCount < 4) {
        console.log(`      🔄 [RETRY ${retryCount + 1}/4] "${cardName}"`);
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
      
      if (retryCount < 4) {
        console.log(`      🔄 [RETRY ${retryCount + 1}/4] Error: "${cardName}"`);
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
    const data = {
      totalCards: this.cards.length,
      processedPages: Array.from(this.processedPages),
      cards: this.cards,
      lastUpdated: new Date().toISOString(),
      stats: {
        successRate: this.getSuccessRate(),
        totalAttempts: this.totalAttempts,
        successfulAttempts: this.successfulAttempts
      }
    };
    
    // TRIPLE BACKUP SYSTEM
    // 1. Write to .tmp file first (atomic save)
    const tmpFile = this.outputFile + '.tmp';
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    
    // 2. Rename to main file (atomic operation)
    await fs.rename(tmpFile, this.outputFile);
    
    // 3. Copy to backup file
    await fs.copyFile(this.outputFile, this.backupFile).catch(() => {});
    
    // 4. Timestamped backup every 50 cards
    if (this.cards.length % 50 === 0 && this.cards.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const timestampedBackup = path.join(this.outputFolder, `backup-${timestamp}-${this.cards.length}cards.json`);
      await fs.copyFile(this.outputFile, timestampedBackup).catch(() => {});
    }
    
    console.log(`   💾 Saved: ${this.cards.length} total cards (${this.getSuccessRate()}% success rate)\n`);
  }

  async loadProgress() {
    let loadedFrom = null;
    
    // Try main file first
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.cards && parsed.cards.length > 0) {
        this.cards = parsed.cards;
        parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
        if (parsed.processedPages) {
          this.processedPages = new Set(parsed.processedPages);
        }
        loadedFrom = 'main';
      }
    } catch (error) {
      // Try backup
      try {
        console.log('⚠️  Main file corrupted, trying backup...');
        const data = await fs.readFile(this.backupFile, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed.cards && parsed.cards.length > 0) {
          this.cards = parsed.cards;
          parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
          if (parsed.processedPages) {
            this.processedPages = new Set(parsed.processedPages);
          }
          loadedFrom = 'backup';
        }
      } catch (backupError) {
        // Try timestamped backups
        try {
          const files = await fs.readdir(this.outputFolder);
          const backups = files
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .sort()
            .reverse();
          
          if (backups.length > 0) {
            console.log('⚠️  Backup corrupted, trying timestamped backup...');
            const latestBackup = path.join(this.outputFolder, backups[0]);
            const data = await fs.readFile(latestBackup, 'utf-8');
            const parsed = JSON.parse(data);
            if (parsed.cards && parsed.cards.length > 0) {
              this.cards = parsed.cards;
              parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
              if (parsed.processedPages) {
                this.processedPages = new Set(parsed.processedPages);
              }
              loadedFrom = 'timestamped';
              console.log(`   Loaded from: ${backups[0]}`);
            }
          }
        } catch (e) {}
      }
    }
    
    if (loadedFrom) {
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done (from ${loadedFrom} file)\n`);
    } else {
      console.log('📝 Starting fresh\n');
    }
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) {
      if (pageNum % 10 === 0) {
        console.log(`⏭️  Skipping tier ${tier} up to page ${pageNum}`);
      }
      return;
    }

    // BAD INTERNET DETECTION
    if (this.consecutiveFailures >= 5) {
      const successRate = this.getSuccessRate();
      if (successRate < 30) {
        console.log(`\n⚠️  ============================================`);
        console.log(`⚠️  BAD INTERNET DETECTED!`);
        console.log(`⚠️  Success rate: ${successRate}%`);
        console.log(`⚠️  Consecutive failures: ${this.consecutiveFailures}`);
        console.log(`⚠️  ============================================`);
        console.log(`⚠️  Pausing for 60 seconds...`);
        console.log(`⚠️  Press Ctrl+C to stop, or wait to retry\n`);
        
        await this.saveProgress();
        await new Promise(r => setTimeout(r, 60000));
        
        this.consecutiveFailures = 0;
        console.log(`🔄 Resuming...\n`);
      }
    }

    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum} (Success: ${this.getSuccessRate()}%)`);
      const url = `https://shoob.gg/cards?page=${pageNum}&tier=${tier}`;
      
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // WAIT FOR CARDS TO LOAD
      let extraction = { cards: [] };
      for (let i = 0; i < 20; i++) {
        extraction = await this.extractCardsFromPage();
        if (extraction.cards.length >= 15) {
          console.log(`   ✅ Found ${extraction.cards.length} cards`);
          break;
        }
        if (i < 19) await new Promise(r => setTimeout(r, 1500));
      }

      if (extraction.cards.length === 0) {
        console.log('   ⚠️ No cards found - skipping\n');
        return;
      }

      console.log(`   ⚡ Opening ALL ${extraction.cards.length} tabs at once...`);

      // 15 TABS AT ONCE - USE THAT RAM
      let successCount = 0;
      let unknownCount = 0;

      const cardPromises = extraction.cards.map(async (card, index) => {
        if (this.cardUrlSet.has(card.imageUrl)) return;
        
        // Tiny stagger to prevent OS freakout
        await new Promise(r => setTimeout(r, index * 200));
        
        try {
          const meta = await this.fetchMetadataByOpeningTab(card.detailUrl, card.cardName);
          
          if (meta.animeName !== 'Unknown Anime' && meta.creator !== 'Unknown Creator') {
            const enrichedCard = {
              ...card,
              ...meta,
              tier,
              page: pageNum,
              scrapedAt: new Date().toISOString()
            };
            this.cards.push(enrichedCard);
            this.cardUrlSet.add(card.imageUrl);
            console.log(`      ✨ [${enrichedCard.creator}] ${enrichedCard.cardName} from ${enrichedCard.animeName}`);
            successCount++;
          } else {
            console.log(`      ❌ [Unknown] ${card.cardName}`);
            unknownCount++;
          }
        } catch (e) {
          if (e.message === 'INTERNET_DOWN') {
            throw e;
          }
          unknownCount++;
        }
      });

      await Promise.all(cardPromises);

      console.log(`   📊 ${successCount} success, ${unknownCount} unknown`);

      // Only mark as done if we got GOOD data (more than half successful)
      if (unknownCount < extraction.cards.length / 2) {
        this.processedPages.add(pageKey);
        await this.saveProgress();
      } else {
        console.log(`   ⚠️ Too many unknowns - will retry this page\n`);
      }
      
      // Cool down
      await new Promise(r => setTimeout(r, 8000));

    } catch (error) {
      if (error.message === 'INTERNET_DOWN') {
        console.log('\n🔴 INTERNET CONNECTION LOST!');
        console.log('   Saving progress and pausing for 2 minutes...');
        await this.saveProgress();
        await new Promise(r => setTimeout(r, 120000));
        console.log('   Retrying...\n');
      } else {
        console.error(`   ❌ Error: ${error.message}\n`);
      }
    }
  }

  async start() {
    const shutdown = async (signal) => {
      console.log(`\n⚠️  Shutting down...`);
      await this.saveProgress().catch(() => {});
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    try {
      await this.loadProgress();
      await this.initialize();
      
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          await this.scrapePage(tier, p);
        }
      }
      
      console.log('\n✅ Done!');
      console.log(`📊 Total: ${this.cards.length} cards`);
    } catch (error) {
      console.error('\n❌ Fatal:', error.message);
      await this.saveProgress().catch(() => {});
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    }
  }
}

const config = {
  startPage: 1,
  endPage: 2332,
  tiers: ['1', '2', '3', '4', '5', '6', 'S']
};

(async () => {
  const scraper = new ShoobCardScraper(config);
  await scraper.start();
})();