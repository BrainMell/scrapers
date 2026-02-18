const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

class ShoobCardScraper {
  constructor(config = {}) {
    // Hardcoded tier limits based on actual site data
    this.tierLimits = { '1': 805, '2': 549, '3': 440, '4': 360, '5': 138, '6': 35, 'S': 8 };
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
    console.log('🚀 [SERVER MODE] Initializing Memory-Efficient Scraper...');
    await this.cleanup();
    try { await fs.mkdir(this.outputFolder, { recursive: true }); } catch (e) {}
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-first-run', '--no-zygote', '--window-size=1280,720',
        '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'
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
      await new Promise(r => setTimeout(r, 2500));

      const meta = await page.evaluate(() => {
        let animeName = 'Unknown Anime';
        let creatorName = 'Official';
        
        // Extract anime name from breadcrumbs
        const breadcrumbItems = Array.from(document.querySelectorAll('ol.breadcrumb-new li[itemprop="itemListElement"]'));
        for (const item of breadcrumbItems) {
          const position = item.querySelector('meta[itemprop="position"]');
          if (position && position.getAttribute('content') === '3') {
            const nameSpan = item.querySelector('span[itemprop="name"]');
            if (nameSpan) {
              animeName = nameSpan.textContent.trim();
              break;
            }
          }
        }
        
        if (animeName === 'Unknown Anime' && breadcrumbItems.length >= 2) {
          const secondLast = breadcrumbItems[breadcrumbItems.length - 2];
          const nameSpan = secondLast.querySelector('span[itemprop="name"]');
          if (nameSpan) animeName = nameSpan.textContent.trim();
        }

        // Extract creator name - IMPROVED: handles concatenated text
        // Strategy 1: Look for text between "Card Maker:" and "See the Maker"
        const bodyText = document.body.textContent;
        const makerMatch = bodyText.match(/Card Maker:([^S]+?)See the Maker/);
        if (makerMatch) {
          creatorName = makerMatch[1].trim();
        }
        
        // Strategy 2: If that fails, look for the user link
        if (!creatorName || creatorName === 'Official') {
          const creatorLink = Array.from(document.querySelectorAll('a[href*="/u/"]'))
            .find(a => !a.textContent.includes('See'));
          if (creatorLink) {
            creatorName = creatorLink.textContent.trim();
          }
        }
        
        return { animeName, creatorName };
      });

      if (meta.animeName === 'Unknown Anime' && attempt < 3) return await this.fetchMetadata(page, card, tier, pageNum, attempt + 1);

      if (meta.animeName === 'Unknown Anime') {
        console.log(`   ⚠️ Skipping [Unknown Anime]: ${card.cardName}`);
        return null;
      }

      let creator = meta.creatorName || 'Anonymous';
      if (!creator || creator === 'Official' || creator === 'Unknown Creator' ||
          creator.includes('People who want') || creator.includes('Requested by')) {
        creator = 'Anonymous';
      }

      const animeName = String(meta.animeName).trim();
      const cardName = String(card.cardName || 'Unknown Character').trim();
      const description = `${cardName} from ${animeName}`;

      console.log(`   ✨ [${creator}] ${cardName}`);
      return {
        imageUrl: card.imageUrl,
        detailUrl: card.detailUrl,
        cardName,
        creator,
        animeName,
        description,
        tier,
        page: pageNum,
        scrapedAt: new Date().toISOString()
      };
    } catch (e) {
      if (attempt < 3) return await this.fetchMetadata(page, card, tier, pageNum, attempt + 1);
      console.log(`   ⚠️ Skipping [fetch failed]: ${card.cardName}`);
      return null;
    }
  }

  async saveProgress() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
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
      if (process.env.GITHUB_TOKEN) await this.syncToGitHub();
    } finally { this.isSaving = false; }
  }

  async syncToGitHub() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const token = process.env.GITHUB_TOKEN;
    const repoUrl = `https://${token}@github.com/BrainMell/scrapers.git`;
    const gitOptions = { cwd: path.join(__dirname, '..') };
    
    try {
      try {
        await execPromise('git rev-parse --is-inside-work-tree', gitOptions);
      } catch (e) {
        console.log('   🔧 Initializing ephemeral git repo for sync...');
        await execPromise('git init', gitOptions);
        await execPromise(`git remote add origin ${repoUrl}`, gitOptions);
        await execPromise('git fetch origin master', gitOptions);
        await execPromise('git reset --soft origin/master', gitOptions);
      }

      await execPromise('git config user.email "bot@scrapers.com"', gitOptions);
      await execPromise('git config user.name "Scraper Bot"', gitOptions);
      await execPromise(`git remote set-url origin ${repoUrl}`, gitOptions);
      await execPromise('git add shoob/shoob_cards/cards_data.json', gitOptions);
      
      const { stdout: status } = await execPromise('git status --porcelain', gitOptions);
      if (!status.trim()) return;

      await execPromise('git commit -m "📊 Auto-update data"', gitOptions);
      await execPromise('git push origin HEAD:master --force', gitOptions);
      console.log('✅ GitHub Synced');
    } catch (e) { 
      console.error('   ❌ Sync Failed:', e.message);
    }
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      let loadedCards = parsed.cards || [];
      this.processedPages = new Set(parsed.processedPages || []);

      const beforeCount = loadedCards.length;
      const filtered = loadedCards.filter(c => {
        if (!c.animeName || c.animeName === 'Unknown Anime') {
          this.processedPages.delete(`${c.tier}-${c.page}`);
          return false;
        }
        return true;
      });

      if (beforeCount !== filtered.length) {
        console.log(`🧹 Removed ${beforeCount - filtered.length} Unknown Anime cards — pages queued for re-scrape.`);
      }

      this.cards = filtered.map(c => {
        delete c.creatorName;
        if (!c.creator || c.creator === 'Official' || c.creator === 'Unknown Creator' ||
            (typeof c.creator === 'string' && (c.creator.includes('People who want') || c.creator.includes('Requested by')))) {
          c.creator = 'Anonymous';
        }
        if (!c.description || c.description.trim() === '') {
          c.description = c.cardName + ' from ' + c.animeName;
        }
        return c;
      });

      this.cards.forEach(c => this.cardUrlSet.add(c.imageUrl));
      console.log(`📂 Resuming: ${this.cards.length} cards, ${this.processedPages.size} pages done\n`);
    } catch (e) {}
  }

  async scrapePage(tier, pageNum) {
    const pageKey = `${tier}-${pageNum}`;
    if (this.processedPages.has(pageKey)) return;

    let page = null;
    try {
      console.log(`📄 TIER ${tier} | PAGE ${pageNum}/${this.tierLimits[tier]}`);
      page = await this.browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      await page.goto(`https://shoob.gg/cards?page=${pageNum}&tier=${tier}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 4000));

      const extraction = await this.extractCardsFromPage(page);
      if (extraction.cards.length === 0) {
        const isEnd = await page.evaluate(() => document.body.innerText.includes('No cards found'));
        if (isEnd) { this.processedPages.add(pageKey); await page.close(); return 'TIER_END'; }
        console.log('   ⚠️ Empty page, skipping...');
        await page.close(); return;
      }

      const cardsToScrape = extraction.cards.filter(c => !this.cardUrlSet.has(c.imageUrl));
      extraction.cards.forEach(c => { if (this.cardUrlSet.has(c.imageUrl)) console.log(`      ⭐️  [Known] ${c.cardName}`); });

      if (cardsToScrape.length > 0) {
        console.log(`   ⚡ Scraping ${cardsToScrape.length} new cards ONE AT A TIME (memory-safe)...`);
        
        // SERVER MODE: Process ONE card at a time
        for (const card of cardsToScrape) {
          const worker = await this.browser.newPage();
          try {
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
            console.error(`      ❌ Error: ${err.message}`);
          } finally {
            await worker.close().catch(() => {});
          }
        }
        
        await this.saveProgress();
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
        const maxPage = this.tierLimits[tier];
        console.log(`\n🎯 Starting TIER ${tier} (${maxPage} pages)\n`);
        for (let p = 1; p <= maxPage; p++) {
          const res = await this.scrapePage(tier, p);
          if (res === 'TIER_END') break;
        }
      }
      console.log('\n✅ ALL TIERS COMPLETE!');
    } finally { 
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }
}

new ShoobCardScraper({ tiers: ['1', '2', '3', '4', '5', '6', 'S'] }).start();