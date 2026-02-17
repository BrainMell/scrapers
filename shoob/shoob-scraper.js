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
    this.metaLimit = pLimit(config.metaConcurrency || 15); 
  }

  async setupPage(page) {
    await page.setCacheEnabled(true);
    // Pipe browser logs to terminal for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('DEBUG:')) console.log(`      [Browser] ${text}`);
    });
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
      headless: false, 
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
      const allLinks = Array.from(document.querySelectorAll('a'));
      
      allLinks.forEach(link => {
        const href = link.href || '';
        const isCardLink = href.includes('/cards/info/') || href.includes('/card/');
        if (!isCardLink) return;

        const isHeaderFooter = link.closest('nav') || link.closest('footer') || link.closest('.navbar') || link.closest('.pagination');
        if (isHeaderFooter) return;

        const img = link.querySelector('img');
        if (!img) return;

        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
        const alt = img.alt || link.textContent.trim() || 'Unknown';
        
        if (src.includes('card_back.png')) {
          console.log(`DEBUG: Found card back at ${href}`);
          return;
        }

        if (src && (src.includes('/cards/') || src.includes('shoob.gg'))) {
          const detailUrl = link.href;
          if (detailUrl && !results.cards.some(c => c.detailUrl === detailUrl)) {
            results.cards.push({ 
              imageUrl: src, 
              detailUrl: detailUrl, 
              cardName: alt.split('\n')[0].trim() || 'Unknown' 
            });
          }
        } else {
          console.log(`DEBUG: Skipping link ${href} - invalid src: ${src}`);
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
        
        await page.goto(card.detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.breadcrumb-new, .user_purchased.padded20', { timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000)); 
        
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
        const delay = 3000 * attempt;
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
      
      await listPage.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 90000 });
      
      console.log(`   ⏳ P${pageNum}: Waiting for cards to load...`);
      try {
        await listPage.waitForFunction(() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          const hasBacks = imgs.some(img => img.src.includes('card_back.png'));
          const hasReal = imgs.some(img => {
            const src = img.src || img.getAttribute('data-src') || '';
            return src.includes('/cards/') && !src.includes('card_back.png');
          });
          return hasReal && !hasBacks;
        }, { timeout: 30000 });
      } catch (e) {
        console.log(`   ⏳ P${pageNum}: Loading timeout or no real cards found yet.`);
      }
      
      let extraction = await this.extractCardsFromPage(listPage);
      
      if (extraction.cards.length === 0) {
        console.log(`   ⏳ P${pageNum} found 0, trying scroll + 5s wait...`);
        await listPage.evaluate(() => window.scrollBy(0, 800));
        await new Promise(r => setTimeout(r, 5000));
        extraction = await this.extractCardsFromPage(listPage);
      }
      
      if (extraction.cards.length === 0) {
        const bodyText = await listPage.evaluate(() => document.body.innerText);
        const isEnd = bodyText.includes('No cards found') || bodyText.includes('There are no cards matching');
        
        if (isEnd) {
          console.log(`   🏁 Tier ${tier} finished at page ${pageNum - 1}`);
          this.processedPages.add(pageKey);
          await listPage.close();
          return 'TIER_END';
        } else {
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
          for (let i = 0; i < 6 && !tierEnded; i++) { 
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
      }
    }
  }
}

new ShoobCardScraper({
  startPage: 1,
  endPage: 2332,
  tiers: ['1', '2', '3', '4', '5', '6', 'S'],
  pageConcurrency: 6,
  metaConcurrency: 20 
}).start();
