const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// Robust p-limit polyfill
const pLimit = (concurrency) => {
  const queue = [];
  let activeCount = 0;
  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };
  const run = async (fn, resolve, ...args) => {
    activeCount++;
    const result = (async () => fn(...args))();
    resolve(result);
    try { await result; } catch (e) {}
    next();
  };
  const enqueue = (fn, resolve, ...args) => {
    queue.push(run.bind(null, fn, resolve, ...args));
    (async () => {
      await Promise.resolve();
      if (activeCount < concurrency && queue.length > 0) {
        queue.shift()();
      }
    })();
  };
  return (fn, ...args) => new Promise(resolve => enqueue(fn, resolve, ...args));
};

class ShoobCardScraper {
  constructor(config = {}) {
    this.startPage = config.startPage || 1;
    this.endPage = config.endPage || 2332;
    this.tiers = config.tiers || ['1', '2', '3', '4', '5', '6', 'S'];
    this.outputFolder = config.outputFolder || path.join(__dirname, 'shoob_cards');
    this.outputFile = path.join(this.outputFolder, 'cards_data.json');
    
    this.cards = [];
    this.processedPages = new Set();
    this.browser = null;
    this.isSaving = false;
    
    // Concurrency Settings
    this.pageLimit = pLimit(config.pageConcurrency || 6);
    this.metaLimit = pLimit(config.metaConcurrency || 15); // Total concurrent metadata tabs
  }

  async setupPage(page) {
    await page.setCacheEnabled(true);
    // Explicitly NO resource interception to allow images
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  }

  async initialize() {
    console.log(`🚀 PEAK MODE v6: Hyper-Speed (Target 100+ cards/min)`);
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: 'new', 
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', 
        '--disable-gpu', '--js-flags="--max-old-space-size=4096"',
        '--disable-extensions'
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

  async fetchMetadata(card, tier, pageNum, retryCount = 5) {
    if (!card.detailUrl) return null;
    
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      let page = null;
      try {
        page = await this.browser.newPage();
        await this.setupPage(page);
        
        // Use a longer timeout and wait for networkidle2 to ensure images/content load
        await page.goto(card.detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait for breadcrumb AND creator block to be sure
        await page.waitForSelector('.breadcrumb-new, .user_purchased.padded20', { timeout: 30000 });
        await new Promise(r => setTimeout(r, 1500)); // Stability delay
        
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
        
        console.log(`   ✨ [${meta.creatorName}] ${card.cardName} (P${pageNum})`);
        await page.close();
        return { ...card, ...meta, tier, page: pageNum, creator: meta.creatorName, scrapedAt: new Date().toISOString() };
      } catch (e) {
        if (page) await page.close().catch(() => {});
        if (attempt === retryCount) {
          console.error(`   ❌ Failed metadata for ${card.cardName} after ${retryCount} attempts: ${e.message}`);
          return { ...card, creator: 'Unknown Creator', animeName: 'Unknown Anime', tier, page: pageNum, scrapedAt: new Date().toISOString(), error: e.message };
        }
        const delay = 2000 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async saveProgress() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      const data = {
        totalCards: this.cards.length,
        processedPages: Array.from(this.processedPages).sort(),
        cards: this.cards,
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');
    } finally {
      this.isSaving = false;
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

    let listPage = null;
    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum} (Scanning)`);
      listPage = await this.browser.newPage();
      await this.setupPage(listPage);
      
      // Increased timeout and wait condition
      await listPage.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 90000 });
      
      // Mandatory wait for cards to actually render
      try {
        await listPage.waitForSelector('.card-name, .card-box, .padded20, a[href*="/cards/info/"]', { timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000)); // Extra 2s for stability
      } catch (e) {
        // Selector failed, might be end of tier or slow load
      }
      
      const extraction = await this.extractCardsFromPage(listPage);
      
      if (extraction.cards.length === 0) {
        // Double check for "No cards found" text
        const bodyText = await listPage.evaluate(() => document.body.innerText);
        const isEnd = bodyText.includes('No cards found') || bodyText.includes('There are no cards matching');
        
        if (isEnd) {
          console.log(`   🏁 Tier ${tier} finished at page ${pageNum - 1}`);
          await listPage.close();
          return 'TIER_END';
        } else {
          // If 0 cards and NOT end of tier, it's a loading error
          console.log(`   ⚠️ 0 cards found on P${pageNum}. Capturing error screenshot...`);
          await listPage.screenshot({ path: path.join(this.outputFolder, `error-tier${tier}-p${pageNum}.png`) });
        }
      }

      await listPage.close();
      listPage = null;

      const cardsToScrape = extraction.cards.filter(c => !this.cards.some(existing => existing.detailUrl === c.detailUrl));
      
      if (cardsToScrape.length > 0) {
        const metaTasks = cardsToScrape.map(card => this.metaLimit(() => this.fetchMetadata(card, tier, pageNum)));
        const results = await Promise.all(metaTasks);
        this.cards.push(...results.filter(r => r !== null));
      }

      console.log(`   📊 Page ${pageNum}: ${extraction.cards.length} cards processed (${cardsToScrape.length} new)`);
      this.processedPages.add(pageKey);
      await this.saveProgress();
      
      // Auto-commit locally as requested
      if (this.processedPages.size % 5 === 0) {
        this.localCommit();
      }
      
    } catch (error) {
      if (listPage) await listPage.close().catch(() => {});
      console.error(`❌ Error P${pageNum}: ${error.message}`);
    }
  }

  localCommit() {
    const msg = `📊 Auto-update: ${this.cards.length} cards [skip ci]`;
    // PowerShell compatible separator
    exec(`git add "${this.outputFile}"; git commit -m "${msg}"`, (err) => {
      if (!err) console.log('   💾 Local commit created');
    });
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();

      for (const tier of this.tiers) {
        console.log(`\n--- STARTING TIER ${tier} ---`);
        let p = this.startPage;
        let tierEnded = false;

        while (!tierEnded) {
          const pageBatch = [];
          for (let i = 0; i < 6 && !tierEnded; i++) { // Process 6 list pages in parallel
            const pageNum = p++;
            pageBatch.push(this.pageLimit(async () => {
              const res = await this.scrapePage(tier, pageNum);
              if (res === 'TIER_END') tierEnded = true;
            }));
          }
          await Promise.all(pageBatch);
          if (tierEnded) break;
        }
      }
    } catch (error) {
      console.error('Fatal Error:', error.message);
    } finally {
      if (this.browser) {
        console.log('🏁 Scrape Complete or Interrupted. Saving and closing...');
        await this.saveProgress();
        // await this.browser.close().catch(() => {});
      }
    }
  }
}

new ShoobCardScraper({
  startPage: 1,
  endPage: 2332,
  tiers: ['1', '2', '3', '4', '5', '6', 'S'],
  pageConcurrency: 6,
  metaConcurrency: 20 // Total metadata tabs at once across all active pages
}).start();
