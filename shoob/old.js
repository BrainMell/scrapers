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
    this.page = null;
  }

  async cleanup() {
    // Kill any lingering Chrome processes
    const { exec } = require('child_process');
    const isWindows = process.platform === 'win32';
    
    return new Promise((resolve) => {
      if (isWindows) {
        exec('taskkill /F /IM chrome.exe /T 2>nul', () => {
          exec('taskkill /F /IM chromium.exe /T 2>nul', () => {
            setTimeout(resolve, 1000); // Wait for processes to die
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
    console.log('🚀 Initializing Shoob Scraper...');
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
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    // Close the default blank page and create a fresh one
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
    
    // Set extra headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
    
    console.log('✅ Browser Ready');
  }

  async waitForPageLoad(maxAttempts = 20) {
    console.log('   ⏳ Waiting for page content...');
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.page.evaluate(() => {
        return {
          bodyLength: document.body?.innerHTML?.length || 0,
          imageCount: document.querySelectorAll('img').length,
          linkCount: document.querySelectorAll('a').length,
          hasContent: document.body?.textContent?.trim().length > 100,
          title: document.title,
          readyState: document.readyState
        };
      });
      
      if (attempt === 0) {
        console.log(`      Page title: "${status.title}"`);
        console.log(`      Ready state: ${status.readyState}`);
      }
      
      // Check if page has loaded with content
      if (status.hasContent && status.imageCount > 5 && status.linkCount > 10) {
        console.log(`      ✓ Page loaded (${status.imageCount} images, ${status.linkCount} links)`);
        return true;
      }
      
      // Check for blocking/error pages
      if (status.bodyLength > 0 && status.bodyLength < 5000) {
        const bodyText = await this.page.evaluate(() => document.body.textContent.toLowerCase());
        if (bodyText.includes('blocked') || bodyText.includes('access denied') || 
            bodyText.includes('captcha') || bodyText.includes('cloudflare')) {
          console.log('      ⚠️  Possible blocking detected!');
          await this.page.screenshot({ 
            path: path.join(this.outputFolder, `block-detection-${Date.now()}.png`) 
          });
          return false;
        }
      }
      
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    console.log('      ⚠️  Page load timeout - taking diagnostic screenshot');
    await this.page.screenshot({ 
      path: path.join(this.outputFolder, `load-timeout-${Date.now()}.png`),
      fullPage: true 
    });
    return false;
  }

  async extractCardsFromPage() {
    return await this.page.evaluate(() => {
      const results = { cards: [], hasCardBack: false, debug: {} };
      
      // Blacklist of non-card elements to ignore
      const blacklist = [
        'shoob home',
        'home',
        'shoob logo',
        'navigation',
        'nav',
        'menu',
        'header',
        'footer'
      ];
      
      let filteredCount = 0;
      
      const isBlacklisted = (name) => {
        const lower = name.toLowerCase().trim();
        const blocked = blacklist.some(term => lower === term || lower.includes(term));
        if (blocked) filteredCount++;
        return blocked;
      };
      
      // Try multiple strategies to find cards
      const strategies = [
        // Strategy 1: Links with /cards/info/ or /card/
        () => {
          const cards = [];
          const links = document.querySelectorAll('a[href*="/cards/info/"], a[href*="/card/"]');
          links.forEach(link => {
            const img = link.querySelector('img');
            if (img && img.src && !img.src.includes('card_back')) {
              const cardName = img.alt?.trim() || 'Unknown';
              if (!isBlacklisted(cardName)) {
                cards.push({
                  imageUrl: img.src,
                  detailUrl: link.href,
                  cardName: cardName,
                  method: 'link-selector'
                });
              }
            }
          });
          return cards;
        },
        
        // Strategy 2: All images with card-like parents
        () => {
          const cards = [];
          const images = document.querySelectorAll('img');
          images.forEach(img => {
            if (!img.src || img.src.includes('card_back')) return;
            
            const link = img.closest('a');
            if (link && link.href && 
                (link.href.includes('shoob.gg') || link.href.includes('/card'))) {
              // Check if image looks like a card (reasonable size)
              const width = img.naturalWidth || img.width;
              const height = img.naturalHeight || img.height;
              
              if ((width > 200 || width === 0) && (height > 200 || height === 0)) {
                const cardName = img.alt?.trim() || 'Unknown';
                if (!isBlacklisted(cardName)) {
                  cards.push({
                    imageUrl: img.src,
                    detailUrl: link.href,
                    cardName: cardName,
                    method: 'image-scan'
                  });
                }
              }
            }
          });
          return cards;
        },
        
        // Strategy 3: Grid/card containers
        () => {
          const cards = [];
          const containers = document.querySelectorAll('[class*="card"], [class*="grid"], [class*="item"]');
          containers.forEach(container => {
            const img = container.querySelector('img');
            const link = container.querySelector('a') || container.closest('a');
            
            if (img && link && img.src && !img.src.includes('card_back')) {
              const cardName = img.alt?.trim() || 'Unknown';
              if (!isBlacklisted(cardName)) {
                cards.push({
                  imageUrl: img.src,
                  detailUrl: link.href,
                  cardName: cardName,
                  method: 'container-scan'
                });
              }
            }
          });
          return cards;
        }
      ];
      
      // Try each strategy and use the one that finds the most cards
      let bestCards = [];
      let bestMethod = 'none';
      
      strategies.forEach(strategy => {
        try {
          const foundCards = strategy();
          if (foundCards.length > bestCards.length) {
            bestCards = foundCards;
            bestMethod = foundCards[0]?.method || 'unknown';
          }
        } catch(e) {}
      });
      
      // Deduplicate
      const seen = new Set();
      bestCards.forEach(card => {
        if (!seen.has(card.imageUrl)) {
          results.cards.push(card);
          seen.add(card.imageUrl);
        }
      });
      
      results.debug = {
        method: bestMethod,
        totalImages: document.querySelectorAll('img').length,
        totalLinks: document.querySelectorAll('a').length,
        foundCards: results.cards.length,
        filtered: filteredCount
      };
      
      // Check for card back
      const allImages = document.querySelectorAll('img');
      allImages.forEach(img => {
        if (img.src?.includes('card_back') || img.alt?.toLowerCase().includes('card back')) {
          const width = img.naturalWidth || img.width;
          if (width > 100) results.hasCardBack = true;
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
      await detailPage.setViewport({ width: 1280, height: 800 });
      
      // Navigate
      await detailPage.goto(detailUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      // Wait for dynamic content
      await new Promise(r => setTimeout(r, 3000));
      
      // Try to wait for specific elements, but don't fail if they timeout
      await detailPage.waitForFunction(() => {
        const hasText = document.body.textContent.trim().length > 100;
        const hasImages = document.querySelectorAll('img').length > 0;
        return hasText && hasImages;
      }, { timeout: 10000 }).catch(() => {});

      const meta = await detailPage.evaluate(() => {
        let animeName = 'Unknown Anime';
        let creatorName = 'Unknown Creator';
        
        // Strategy 1: Breadcrumbs with position="3"
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
          
          // Fallback: second-to-last breadcrumb
          if (animeName === 'Unknown Anime' && breadcrumbs.length >= 3) {
            const span = breadcrumbs[breadcrumbs.length - 2].querySelector('span[itemprop="name"], span');
            if (span) animeName = span.textContent.trim();
          }
        } catch(e) {}
        
        // Strategy 2: Look for series name in various places
        if (animeName === 'Unknown Anime') {
          try {
            const selectors = [
              '.series-name',
              '[class*="series"]',
              'h1', 
              'h2',
              '.title'
            ];
            
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent.trim().length > 0 && el.textContent.trim().length < 100) {
                animeName = el.textContent.trim();
                break;
              }
            }
          } catch(e) {}
        }
        
        // Creator extraction
        try {
          const creatorBlock = document.querySelector('.user_purchased.padded20, .user_purchased, [class*="creator"], [class*="maker"]');
          if (creatorBlock) {
            const p = creatorBlock.querySelector('p');
            if (p) {
              const clone = p.cloneNode(true);
              // Remove badge/label elements
              const badges = clone.querySelectorAll('span.padr5, .badge, .label');
              badges.forEach(b => b.remove());
              const text = clone.textContent.trim();
              if (text.length > 0 && text.length < 50) {
                creatorName = text;
              }
            } else {
              const text = creatorBlock.textContent.trim();
              if (text.length > 0 && text.length < 50) {
                creatorName = text;
              }
            }
          }
        } catch(e) {}
        
        // Fallback: search for "Card Maker:" or "Creator:" labels
        if (creatorName === 'Unknown Creator') {
          try {
            const bodyText = document.body.textContent;
            const patterns = [
              /Card Maker:\s*([^\n]+)/,
              /Creator:\s*([^\n]+)/,
              /Made by:\s*([^\n]+)/,
              /Artist:\s*([^\n]+)/
            ];
            
            for (const pattern of patterns) {
              const match = bodyText.match(pattern);
              if (match && match[1]) {
                creatorName = match[1].trim();
                break;
              }
            }
          } catch(e) {}
        }
        
        return { animeName, creatorName };
      });

      await detailPage.close();

      // Retry logic
      if ((meta.animeName === 'Unknown Anime' || meta.creatorName === 'Unknown Creator') && retryCount < 2) {
        console.log(`      🔄 Retry ${retryCount + 1}/2 for "${cardName}"`);
        await new Promise(r => setTimeout(r, 3000));
        return await this.fetchMetadataByOpeningTab(detailUrl, cardName, retryCount + 1);
      }

      return {
        creator: meta.creatorName,
        animeName: meta.animeName,
        description: `${cardName} from ${meta.animeName}`
      };
    } catch (e) {
      if (detailPage) await detailPage.close();
      if (retryCount < 2) {
        console.log(`      ⚠️ Error on "${cardName}": ${e.message.substring(0, 50)}`);
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

  async saveProgress() {
    const data = {
      totalCards: this.cards.length,
      processedPages: Array.from(this.processedPages),
      cards: this.cards,
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`   💾 Saved: ${this.cards.length} total cards`);
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.cards) {
        this.cards = parsed.cards;
        parsed.cards.forEach(card => this.cardUrlSet.add(card.imageUrl));
      }
      if (parsed.processedPages) {
        this.processedPages = new Set(parsed.processedPages);
      }
      console.log(`📂 Resuming from ${this.cards.length} cards, ${this.processedPages.size} pages done`);
    } catch (error) {
      console.log('📝 Starting fresh');
    }
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) {
      // Only log every 10th skipped page to reduce spam
      if (pageNum % 10 === 0) {
        console.log(`⏭️  Skipping tier ${tier} pages up to ${pageNum} (already done)`);
      }
      return;
    }

    try {
      console.log(`\n📄 TIER ${tier} | PAGE ${pageNum}`);
      const url = `https://shoob.gg/cards?page=${pageNum}&tier=${tier}`;
      
      // Navigate with retry
      let navigationSuccess = false;
      for (let navAttempt = 0; navAttempt < 3; navAttempt++) {
        try {
          await this.page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 45000 
          });
          navigationSuccess = true;
          break;
        } catch(e) {
          console.log(`   ⚠️ Navigation attempt ${navAttempt + 1}/3 failed`);
          if (navAttempt < 2) await new Promise(r => setTimeout(r, 5000));
        }
      }
      
      if (!navigationSuccess) {
        console.log('   ❌ Failed to load page after 3 attempts');
        return;
      }

      // Wait for content to load
      const pageLoaded = await this.waitForPageLoad();
      if (!pageLoaded) {
        console.log('   ❌ Page did not load properly - check screenshots');
        return;
      }

      // Extract cards with retry
      let extraction = { cards: [], debug: {} };
      for (let attempt = 0; attempt < 10; attempt++) {
        extraction = await this.extractCardsFromPage();
        
        if (attempt === 0) {
          console.log(`   🔍 Detection method: ${extraction.debug.method}`);
          const filterMsg = extraction.debug.filtered > 0 ? ` (${extraction.debug.filtered} filtered)` : '';
          console.log(`   📊 Found: ${extraction.debug.foundCards} cards${filterMsg}, ${extraction.debug.totalImages} images, ${extraction.debug.totalLinks} links`);
        }
        
        if (extraction.cards.length >= 12) break;
        if (attempt < 9) await new Promise(r => setTimeout(r, 2000));
      }

      if (extraction.cards.length === 0) {
        console.log('   ⚠️ No cards found - taking screenshot for diagnosis');
        await this.page.screenshot({ 
          path: path.join(this.outputFolder, `no-cards-tier${tier}-page${pageNum}.png`),
          fullPage: true 
        });
        return;
      }

      console.log(`   ⚡ Processing ${extraction.cards.length} cards...`);

      let successCount = 0;
      let unknownCount = 0;

      // Process cards with staggered parallel execution
      const batchSize = 5; // Process 5 at a time
      for (let i = 0; i < extraction.cards.length; i += batchSize) {
        const batch = extraction.cards.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (card, batchIndex) => {
          if (this.cardUrlSet.has(card.imageUrl)) return;
          
          // Stagger within batch
          await new Promise(r => setTimeout(r, batchIndex * 1000));
          
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
            console.log(`      ✨ [${enrichedCard.creator}] ${enrichedCard.description}`);
            successCount++;
          } else {
            console.log(`      ❌ [Unknown] ${card.cardName}`);
            unknownCount++;
          }
        });

        await Promise.all(batchPromises);
        
        // Pause between batches
        if (i + batchSize < extraction.cards.length) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      console.log(`   📊 Results: ${successCount} success, ${unknownCount} unknown`);

      // Save progress if we got good data
      if (unknownCount < extraction.cards.length / 2) {
        this.processedPages.add(pageKey);
        await this.saveProgress();
      } else {
        console.log(`   ⚠️ Too many unknowns (${unknownCount}/${extraction.cards.length}) - will retry this page`);
      }
      
      // Cool down between pages
      console.log('   ⏸️ Cooling down 8s...');
      await new Promise(r => setTimeout(r, 8000));

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      await this.page.screenshot({ 
        path: path.join(this.outputFolder, `error-tier${tier}-page${pageNum}.png`) 
      }).catch(() => {});
    }
  }

  async start() {
    // Setup graceful shutdown handlers
    const shutdown = async (signal) => {
      console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);
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
      
      // Run the full scrape
      for (const tier of this.tiers) {
        for (let p = this.startPage; p <= this.endPage; p++) {
          await this.scrapePage(tier, p);
        }
      }
      
      console.log('\n✅ Scraping complete!');
      console.log(`📊 Total cards collected: ${this.cards.length}`);
    } catch (error) {
      console.error('\n❌ Fatal error:', error.message);
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