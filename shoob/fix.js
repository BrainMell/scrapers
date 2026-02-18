const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

class CreatorNameFixer {
  constructor() {
    this.inputFile = path.join(__dirname, 'shoob_cards', 'cards_data.json');
    this.outputFile = path.join(__dirname, 'shoob_cards', 'cards_data.json');
    this.backupFile = path.join(__dirname, 'shoob_cards', 'cards_data.backup_before_creator_fix.json');
    
    this.browser = null;
    this.parallelTabs = 40; // 40 tabs at once
    
    this.cards = [];
    this.totalFixed = 0;
    this.totalSkipped = 0;
    this.totalFailed = 0;
  }

  async initialize() {
    console.log('🔧 Creator Name Fixer - Ultra Fast Mode (40 parallel tabs)\n');
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    console.log('✅ Browser ready\n');
  }

  async loadData() {
    console.log('📂 Loading cards_data.json...');
    const raw = await fs.readFile(this.inputFile, 'utf-8');
    const data = JSON.parse(raw);
    
    // Backup original
    await fs.writeFile(this.backupFile, raw, 'utf-8');
    console.log(`✅ Backup saved to: ${this.backupFile}\n`);
    
    this.cards = data.cards || [];
    this.processedPages = data.processedPages || [];
    this.metadata = data;
    
    return this.cards;
  }

  async fetchCreatorName(page, detailUrl, attempt = 1) {
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 1000));

      const creatorName = await page.evaluate(() => {
        // Strategy 1: Look for text between "Card Maker:" and "See the Maker"
        const bodyText = document.body.textContent;
        const makerMatch = bodyText.match(/Card Maker:([^S]+?)See the Maker/);
        if (makerMatch) {
          return makerMatch[1].trim();
        }
        
        // Strategy 2: Look for the user link
        const creatorLink = Array.from(document.querySelectorAll('a[href*="/u/"]'))
          .find(a => !a.textContent.includes('See'));
        return creatorLink ? creatorLink.textContent.trim() : null;
      });

      return creatorName;
    } catch (e) {
      if (attempt < 2) return await this.fetchCreatorName(page, detailUrl, attempt + 1);
      return null;
    }
  }

  async fixCreators() {
    // Find cards that need fixing
    const needsFix = this.cards.filter(c => {
      // Skip cards from pages 570-800 that are Anonymous (those are legit)
      if (c.creator === 'Anonymous' && c.page >= 570 && c.page <= 800) {
        return false;
      }
      
      // Fix if creator is Anonymous, Official, Unknown, or empty
      return !c.creator || 
             c.creator === 'Anonymous' || 
             c.creator === 'Official' || 
             c.creator === 'Unknown Creator';
    });

    console.log(`🔍 Found ${needsFix.length} cards that need creator name fixes`);
    console.log(`📊 Processing in batches of ${this.parallelTabs}...\n`);

    // Process in batches
    for (let i = 0; i < needsFix.length; i += this.parallelTabs) {
      const batch = needsFix.slice(i, i + this.parallelTabs);
      const batchNum = Math.floor(i / this.parallelTabs) + 1;
      const totalBatches = Math.ceil(needsFix.length / this.parallelTabs);
      
      console.log(`⚡ Batch ${batchNum}/${totalBatches} (${batch.length} cards)`);
      const startTime = Date.now();

      const results = await Promise.all(batch.map(async (card) => {
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

          const creatorName = await this.fetchCreatorName(worker, card.detailUrl);
          
          if (creatorName && creatorName !== 'Official') {
            // Found a real creator name
            card.creator = creatorName;
            return { status: 'fixed', name: creatorName };
          } else {
            // Couldn't find, keep as Anonymous
            card.creator = 'Anonymous';
            return { status: 'skipped' };
          }
        } catch (err) {
          return { status: 'failed' };
        } finally {
          await worker.close().catch(() => {});
        }
      }));

      const fixed = results.filter(r => r.status === 'fixed').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const failed = results.filter(r => r.status === 'failed').length;
      
      this.totalFixed += fixed;
      this.totalSkipped += skipped;
      this.totalFailed += failed;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✓ Fixed: ${fixed} | Skipped: ${skipped} | Failed: ${failed} (${elapsed}s)`);
      
      // Save progress every batch
      await this.saveProgress();
    }

    console.log('\n📊 FINAL STATS:');
    console.log(`   ✅ Total Fixed: ${this.totalFixed}`);
    console.log(`   ⚠️  Total Skipped: ${this.totalSkipped}`);
    console.log(`   ❌ Total Failed: ${this.totalFailed}`);
  }

  async saveProgress() {
    const data = {
      ...this.metadata,
      totalCards: this.cards.length,
      cards: this.cards,
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async start() {
    try {
      await this.loadData();
      await this.initialize();
      await this.fixCreators();
      
      console.log('\n✅ Creator name fixing complete!');
      console.log(`📁 Updated file: ${this.outputFile}`);
      console.log(`💾 Backup: ${this.backupFile}`);
      
    } finally {
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }
}

new CreatorNameFixer().start();