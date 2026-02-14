const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;

puppeteer.use(StealthPlugin());

class AdvancedPinterestScraper {
  constructor(config = {}) {
    this.searchQuery = config.searchQuery || 'anime';
    this.targetCount = config.targetCount || 100000;
    this.outputFile = config.outputFile || 'pinterest_urls.json';
    this.batchSize = config.batchSize || 1000;
    this.maxRetries = config.maxRetries || 5;
    this.scrollDelay = config.scrollDelay || 2000;
    this.proxies = config.proxies || [];
    this.currentProxyIndex = 0;
    this.urls = new Set();
    this.failedAttempts = 0;
    this.browser = null;
    this.page = null;
    this.stats = {
      startTime: Date.now(),
      scrolls: 0,
      retries: 0,
      urlsPerMinute: [],
    };
  }

  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    return proxy;
  }

  async initialize() {
    console.log('🚀 Initializing advanced browser setup...');
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
      ],
    };

    // Add proxy if available
    const proxy = this.getNextProxy();
    if (proxy) {
      launchOptions.args.push(`--proxy-server=${proxy}`);
      console.log(`🌐 Using proxy: ${proxy}`);
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Randomize viewport
    const width = 1920 + Math.floor(Math.random() * 100);
    const height = 1080 + Math.floor(Math.random() * 100);
    await this.page.setViewport({ width, height });

    // Set random user agent
    await this.page.setUserAgent(this.getRandomUserAgent());

    // Enhanced headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    });

    // Advanced anti-detection
    await this.page.evaluateOnNewDocument(() => {
      // Overwrite the `navigator.webdriver` property
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      
      // Overwrite the `navigator.plugins` property
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
      
      // Overwrite the `navigator.languages` property
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      
      // Add chrome runtime
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
      };
      
      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Hide automation
      delete navigator.__proto__.webdriver;
      
      // Mock battery API
      navigator.getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
      });
    });

    // Block unnecessary resources to speed up
    await this.page.setRequestInterception(true);
    this.page.on('request', (request) => {
      const resourceType = request.resourceType();
      // Block ads, analytics, and some media
      if (['media', 'font', 'websocket'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log('✅ Advanced browser initialized');
  }

  async checkIfBlocked() {
    const content = await this.page.content();
    const blocked = content.includes('captcha') || 
                   content.includes('blocked') ||
                   content.includes('unusual traffic') ||
                   content.includes('automated');
    
    if (blocked) {
      console.log('🚫 Detected blocking/CAPTCHA');
      this.failedAttempts++;
      return true;
    }
    this.failedAttempts = 0;
    return false;
  }

  async randomMouseMovement() {
    const x = Math.floor(Math.random() * 1920);
    const y = Math.floor(Math.random() * 1080);
    await this.page.mouse.move(x, y, { steps: 10 });
  }

  async humanTyping(selector, text) {
    await this.page.click(selector);
    for (const char of text) {
      await this.page.keyboard.type(char);
      await this.randomDelay(50, 150);
    }
  }

  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async humanScroll() {
    await this.page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = Math.floor(Math.random() * 400) + 150;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, Math.random() * 150 + 50);
      });
    });
    
    this.stats.scrolls++;
  }

  async extractUrls() {
    return await this.page.evaluate(() => {
      const urls = new Set();
      
      // Multiple selectors for different Pinterest layouts
      const selectors = [
        'a[href*="/pin/"]',
        '[data-test-id="pin"] a',
        'a[href^="https://www.pinterest.com/pin/"]',
        'a[href^="/pin/"]',
        'div[data-grid-item="true"] a',
        '[data-test-id="closeup-title"] a',
        '.Pj7.sLG.XiG a',
      ];

      selectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            let href = el.href || el.getAttribute('href');
            if (href) {
              // Normalize URLs
              if (href.startsWith('/pin/')) {
                href = 'https://www.pinterest.com' + href;
              }
              if (href.includes('/pin/')) {
                // Clean URL parameters
                const cleanUrl = href.split('?')[0];
                urls.add(cleanUrl);
              }
            }
          });
        } catch (e) {
          // Selector failed, continue
        }
      });

      // Also extract image URLs
      const imageSelectors = [
        'img[src*="pinimg.com"]',
        'img[srcset*="pinimg.com"]',
      ];

      imageSelectors.forEach(selector => {
        try {
          const images = document.querySelectorAll(selector);
          images.forEach(img => {
            const src = img.src || img.getAttribute('src');
            if (src && src.includes('pinimg.com')) {
              urls.add(src);
            }
          });
        } catch (e) {
          // Continue
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
      stats: {
        ...this.stats,
        runtime: Date.now() - this.stats.startTime,
        urlsPerSecond: (this.urls.size / ((Date.now() - this.stats.startTime) / 1000)).toFixed(2),
      },
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(
      this.outputFile,
      JSON.stringify(data, null, 2),
      'utf-8'
    );

    console.log(`💾 Progress saved: ${this.urls.size.toLocaleString()} URLs | ${data.stats.urlsPerSecond} URLs/sec`);
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.urls = new Set(parsed.urls);
      console.log(`📂 Loaded ${this.urls.size.toLocaleString()} existing URLs`);
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

      // Check if blocked
      if (await this.checkIfBlocked()) {
        throw new Error('Detected as bot/blocked');
      }

      let consecutiveNoNewUrls = 0;
      let scrollCount = 0;
      let lastSaveTime = Date.now();

      while (this.urls.size < this.targetCount) {
        scrollCount++;
        
        const progressBar = '█'.repeat(Math.floor((this.urls.size / this.targetCount) * 20));
        const emptyBar = '░'.repeat(20 - progressBar.length);
        console.log(`\n📜 Scroll ${scrollCount} | [${progressBar}${emptyBar}] ${this.urls.size.toLocaleString()}/${this.targetCount.toLocaleString()}`);

        const previousSize = this.urls.size;

        // Extract URLs
        const newUrls = await this.extractUrls();
        newUrls.forEach(url => this.urls.add(url));

        const urlsAdded = this.urls.size - previousSize;
        console.log(`   ➕ Added ${urlsAdded} new URLs`);

        if (urlsAdded === 0) {
          consecutiveNoNewUrls++;
          console.log(`   ⚠️  No new URLs found (${consecutiveNoNewUrls}/15)`);
          
          if (consecutiveNoNewUrls >= 15) {
            console.log('   🛑 No new content found. Stopping.');
            break;
          }
        } else {
          consecutiveNoNewUrls = 0;
        }

        // Auto-save every batchSize or every 60 seconds
        if (this.urls.size % this.batchSize === 0 || 
            Date.now() - lastSaveTime > 60000) {
          await this.saveProgress();
          lastSaveTime = Date.now();
        }

        // Human-like behaviors
        await this.humanScroll();
        await this.randomDelay(this.scrollDelay, this.scrollDelay + 2000);

        // Random mouse movements
        if (Math.random() > 0.7) {
          await this.randomMouseMovement();
        }

        // Random scroll backs
        if (Math.random() > 0.85) {
          await this.page.evaluate(() => {
            window.scrollBy(0, -Math.random() * 800);
          });
          await this.randomDelay(300, 800);
        }

        // Periodic longer breaks
        if (scrollCount % 25 === 0) {
          const breakTime = Math.floor(Math.random() * 10000) + 5000;
          console.log(`   ☕ Taking a ${(breakTime/1000).toFixed(1)}s break...`);
          await this.randomDelay(breakTime, breakTime + 2000);
        }

        // Check for blocking every 10 scrolls
        if (scrollCount % 10 === 0) {
          if (await this.checkIfBlocked()) {
            throw new Error('Detected as blocked during scraping');
          }
        }
      }

      console.log(`\n✅ Scraping completed! Total URLs: ${this.urls.size.toLocaleString()}`);
      await this.saveProgress();

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
      this.stats.retries++;
      
      if (retryCount < this.maxRetries) {
        const waitTime = Math.min(30000 * (retryCount + 1), 120000);
        console.log(`\n🔄 Retry ${retryCount + 1}/${this.maxRetries} in ${waitTime/1000}s...`);
        await this.randomDelay(waitTime, waitTime + 5000);
        
        // Save before retrying
        await this.saveProgress();
        
        // Close and reinitialize
        if (this.browser) {
          await this.browser.close();
        }
        await this.initialize();
        
        return await this.scrapeWithRetry(retryCount + 1);
      } else {
        console.error(`\n💥 Max retries reached. Saving and exiting.`);
        await this.saveProgress();
        throw error;
      }
    }
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();
      await this.scrapeWithRetry();
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
    const runtime = Date.now() - this.stats.startTime;
    const report = {
      searchQuery: this.searchQuery,
      totalUrls: this.urls.size,
      targetCount: this.targetCount,
      completionPercentage: ((this.urls.size / this.targetCount) * 100).toFixed(2),
      statistics: {
        runtime: `${(runtime / 60000).toFixed(2)} minutes`,
        scrolls: this.stats.scrolls,
        retries: this.stats.retries,
        avgUrlsPerScroll: (this.urls.size / this.stats.scrolls).toFixed(2),
        urlsPerSecond: (this.urls.size / (runtime / 1000)).toFixed(2),
      },
      timestamp: new Date().toISOString(),
    };

    const reportFile = `report_${Date.now()}.json`;
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

    console.log('\n' + '═'.repeat(50));
    console.log('📊 SCRAPING REPORT');
    console.log('═'.repeat(50));
    console.log(`Search Query:      ${report.searchQuery}`);
    console.log(`URLs Collected:    ${report.totalUrls.toLocaleString()}`);
    console.log(`Target Count:      ${report.targetCount.toLocaleString()}`);
    console.log(`Completion:        ${report.completionPercentage}%`);
    console.log(`Runtime:           ${report.statistics.runtime}`);
    console.log(`Total Scrolls:     ${report.statistics.scrolls}`);
    console.log(`Retries:           ${report.statistics.retries}`);
    console.log(`URLs/Scroll:       ${report.statistics.avgUrlsPerScroll}`);
    console.log(`URLs/Second:       ${report.statistics.urlsPerSecond}`);
    console.log(`Report saved to:   ${reportFile}`);
    console.log('═'.repeat(50) + '\n');
  }
}

// Configuration
const config = {
  searchQuery: 'anime',
  targetCount: 100000,
  outputFile: 'pinterest_anime_urls.json',
  batchSize: 1000,
  maxRetries: 5,
  scrollDelay: 2000,
  // Add proxies if you have them (optional)
  // proxies: ['http://proxy1:port', 'http://proxy2:port'],
};

// Run scraper
(async () => {
  const scraper = new AdvancedPinterestScraper(config);
  await scraper.start();
})();
