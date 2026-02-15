const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

class PinterestScraper {
  constructor(config = {}) {
    this.searchQuery = config.searchQuery || 'anime';
    this.targetCount = config.targetCount || 100000;
    this.outputFile = config.outputFile || path.join(__dirname, 'pinterest_urls.json');
    this.batchSize = config.batchSize || 1000;
    this.maxRetries = config.maxRetries || 5;
    this.scrollDelay = config.scrollDelay || 2000;
    this.urls = new Set();
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    console.log('🚀 Initializing browser with stealth mode...');
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.page = await this.browser.newPage();

    // Set realistic viewport
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Set realistic user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    // Set extra headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // Override navigator properties to avoid detection
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      
      // Override chrome property
      window.chrome = { runtime: {} };
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    console.log('✅ Browser initialized successfully');
  }

  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async humanScroll() {
    // Simulate human-like scrolling
    await this.page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = Math.floor(Math.random() * 300) + 200;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, Math.random() * 100 + 50);
      });
    });
  }

  async extractUrls() {
    return await this.page.evaluate(() => {
      const urls = new Set();
      
      // Try multiple selectors for Pinterest pins
      const selectors = [
        'a[href*="/pin/"]',
        '[data-test-id="pin"] a',
        'a[href^="https://www.pinterest.com/pin/"]',
        'div[data-grid-item="true"] a'
      ];

      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const href = el.href;
          if (href && href.includes('/pin/')) {
            urls.add(href);
          }
        });
      });

      // Also try to get image URLs
      const images = document.querySelectorAll('img[src*="pinimg.com"]');
      images.forEach(img => {
        if (img.src) {
          urls.add(img.src);
        }
      });

      return Array.from(urls);
    });
  }

  async saveProgress() {
    const data = {
      searchQuery: this.searchQuery,
      totalUrls: this.urls.size,
      urls: Array.from(this.urls),
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(
      this.outputFile,
      JSON.stringify(data, null, 2),
      'utf-8'
    );

    console.log(`💾 Progress saved: ${this.urls.size} URLs`);
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.urls = new Set(parsed.urls);
      console.log(`📂 Loaded ${this.urls.size} existing URLs`);
    } catch (error) {
      console.log('📝 Starting fresh - no existing data found');
    }
  }

  async scrapeWithRetry(retryCount = 0) {
    try {
      console.log(`\n🔍 Navigating to Pinterest search for: "${this.searchQuery}"`);
      
      const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(this.searchQuery)}`;
      
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      await this.randomDelay(3000, 5000);

      let consecutiveNoNewUrls = 0;
      let scrollCount = 0;

      while (this.urls.size < this.targetCount) {
        scrollCount++;
        console.log(`\n📜 Scroll iteration ${scrollCount} | Current URLs: ${this.urls.size}/${this.targetCount}`);

        const previousSize = this.urls.size;

        // Extract URLs from current page
        const newUrls = await this.extractUrls();
        newUrls.forEach(url => this.urls.add(url));

        const urlsAdded = this.urls.size - previousSize;
        console.log(`   ➕ Added ${urlsAdded} new URLs`);

        // Check if we're still finding new content
        if (urlsAdded === 0) {
          consecutiveNoNewUrls++;
          console.log(`   ⚠️  No new URLs found (${consecutiveNoNewUrls}/10)`);
          
          if (consecutiveNoNewUrls >= 10) {
            console.log('   🛑 No new content found after 10 attempts. Stopping.');
            break;
          }
        } else {
          consecutiveNoNewUrls = 0;
        }

        // Save progress every batch
        if (this.urls.size % this.batchSize === 0 || this.urls.size >= this.targetCount) {
          await this.saveProgress();
        }

        // Human-like scrolling
        await this.humanScroll();
        await this.randomDelay(this.scrollDelay, this.scrollDelay + 2000);

        // Random actions to appear more human
        if (Math.random() > 0.8) {
          await this.page.evaluate(() => {
            window.scrollBy(0, -Math.random() * 500);
          });
          await this.randomDelay(500, 1000);
        }

        // Periodic longer breaks
        if (scrollCount % 20 === 0) {
          console.log('   ☕ Taking a short break to appear more human...');
          await this.randomDelay(5000, 10000);
        }
      }

      console.log(`\n✅ Scraping completed! Total URLs collected: ${this.urls.size}`);
      await this.saveProgress();

    } catch (error) {
      console.error(`\n❌ Error during scraping: ${error.message}`);
      
      if (retryCount < this.maxRetries) {
        console.log(`\n🔄 Retrying... (Attempt ${retryCount + 1}/${this.maxRetries})`);
        await this.randomDelay(5000, 10000);
        
        // Re-initialize browser
        if (this.browser) {
          await this.browser.close();
        }
        await this.initialize();
        
        return await this.scrapeWithRetry(retryCount + 1);
      } else {
        console.error(`\n💥 Max retries (${this.maxRetries}) reached. Saving progress and exiting.`);
        await this.saveProgress();
        throw error;
      }
    }
  }

  async start() {
    try {
      // Load any existing progress
      await this.loadProgress();

      // Initialize browser
      await this.initialize();

      // Start scraping with retry logic
      await this.scrapeWithRetry();

      // Generate summary report
      await this.generateReport();

    } catch (error) {
      console.error('Fatal error:', error);
    } finally {
      if (this.browser) {
        await this.browser.close();
        console.log('🔒 Browser closed');
      }
    }
  }

  async generateReport() {
    const report = {
      searchQuery: this.searchQuery,
      totalUrls: this.urls.size,
      targetCount: this.targetCount,
      completionPercentage: ((this.urls.size / this.targetCount) * 100).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    const reportFile = path.join(__dirname, `report_${Date.now()}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

    console.log('\n📊 SCRAPING REPORT');
    console.log('═══════════════════════════════════════');
    console.log(`Search Query:    ${report.searchQuery}`);
    console.log(`URLs Collected:  ${report.totalUrls.toLocaleString()}`);
    console.log(`Target Count:    ${report.targetCount.toLocaleString()}`);
    console.log(`Completion:      ${report.completionPercentage}%`);
    console.log(`Report saved to: ${reportFile}`);
    console.log('═══════════════════════════════════════\n');
  }
}

// Main execution
(async () => {
  const scraper = new PinterestScraper({
    searchQuery: 'anime',
    targetCount: 100000,
    outputFile: 'pinterest_anime_urls.json',
    batchSize: 1000,
    maxRetries: 5,
    scrollDelay: 2000,
  });

  await scraper.start();
})();
