const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

class DebuggedMemeScraperFixed {
  constructor(config = {}) {
    this.targetCount = config.targetCount || 100000;
    this.outputFile = config.outputFile || path.join(__dirname, 'anime_memes_reactions.json');
    this.batchSize = config.batchSize || 500;
    this.maxRetries = config.maxRetries || 3;
    this.scrollDelay = config.scrollDelay || 4000;
    this.minImageWidth = config.minImageWidth || 300;
    this.minImageHeight = config.minImageHeight || 300;
    this.images = [];
    this.imageUrlSet = new Set();
    this.processedSearches = new Set();
    this.currentSearch = '';
    this.browser = null;
    this.page = null;
    
    this.searchTerms = this.generateMemeReactionSearches();
    this.userAgents = this.generateUserAgents();
  }

  generateMemeReactionSearches() {
    const animeShows = [
      'Naruto', 'One Piece', 'Dragon Ball', 'My Hero Academia', 'Demon Slayer',
      'Jujutsu Kaisen', 'Attack on Titan', 'Death Note', 'Tokyo Ghoul', 'Bleach',
      'Hunter x Hunter', 'Fullmetal Alchemist', 'Black Clover', 'Chainsaw Man',
      'Spy x Family', 'JoJo', 'Mob Psycho 100', 'Cowboy Bebop', 'Evangelion',
    ];

    const characters = [
      'Goku', 'Vegeta', 'Naruto', 'Sasuke', 'Luffy', 'Zoro', 'Ichigo',
      'Deku', 'Bakugo', 'Tanjiro', 'Gojo', 'Eren', 'Levi', 'Light', 'L',
    ];

    const searchTerms = [];

    // Anime + meme/reaction
    animeShows.forEach(anime => {
      searchTerms.push(`${anime} meme`);
      searchTerms.push(`${anime} reaction`);
      searchTerms.push(`${anime} funny`);
    });

    // Character + reaction
    characters.forEach(character => {
      searchTerms.push(`${character} meme`);
      searchTerms.push(`${character} reaction`);
    });

    // Generic
    const generic = [
      'anime meme', 'anime reaction', 'anime sticker',
      'cursed anime', 'anime pfp', 'anime discord emoji',
    ];

    searchTerms.push(...generic);
    return searchTerms;
  }

  generateUserAgents() {
    return [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async initialize() {
    console.log('🚀 Initializing browser with DEBUG mode...');
    
    this.browser = await puppeteer.launch({
      headless: true,  // Run in background
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent(this.getRandomUserAgent());

    console.log('✅ Browser ready');
  }

  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async smartScroll() {
    await this.page.evaluate(async () => {
      window.scrollBy(0, 1000);
      await new Promise(resolve => setTimeout(resolve, 800));
    });
  }

  async waitForImages() {
    console.log('   ⏳ Waiting for Pinterest to load images...');
    
    // Check for login wall first
    const loginWall = await this.page.evaluate(() => {
      const modal = document.querySelector('[data-test-id="login-modal-default"]');
      const signup = document.querySelector('div[role="dialog"]');
      const text = document.body.innerText.toLowerCase();
      return !!modal || (signup && text.includes('log in')) || text.includes('sign up to see more');
    });

    if (loginWall) {
      console.log('   🚨 LOGIN WALL DETECTED! Pinterest is blocking guest access.');
      console.log('   💡 Please log in manually in the browser window or use a VPN.');
    }

    // Wait for image elements to appear
    try {
      await this.page.waitForSelector('img[src*="pinimg"]', { timeout: 20000 });
      console.log('   ✅ Images detected on page');
      await this.randomDelay(3000, 5000);
      return true;
    } catch (e) {
      console.log('   ⚠️  Images not found after 20s');
      return false;
    }
  }

  async debugPageContent() {
    // Check what's actually on the page
    const debug = await this.page.evaluate(() => {
      const allImages = document.querySelectorAll('img');
      const pinimgImages = document.querySelectorAll('img[src*="pinimg"]');
      
      return {
        totalImages: allImages.length,
        pinimgImages: pinimgImages.length,
        sampleUrls: Array.from(pinimgImages).slice(0, 3).map(img => img.src),
      };
    });
    
    console.log(`   🔍 DEBUG: ${debug.totalImages} total images, ${debug.pinimgImages} Pinterest images`);
    if (debug.sampleUrls.length > 0) {
      console.log(`   📸 Sample URL: ${debug.sampleUrls[0].substring(0, 80)}...`);
    }
    
    return debug.pinimgImages > 0;
  }

  async extractImagesWithMetadata() {
    return await this.page.evaluate((minWidth, minHeight) => {
      const results = [];
      
      // Strategy: Find ALL images with pinimg.com first
      const allImages = Array.from(document.querySelectorAll('img'));
      
      allImages.forEach(img => {
        try {
          const src = img.src || img.getAttribute('src') || img.getAttribute('data-src');
          
          if (!src || !src.includes('pinimg.com')) return;
          
          // Skip obvious tiny thumbnails/icons
          if (src.includes('/75x75_RS/') || 
              src.includes('/avatar') ||
              src.includes('/user/')) {
            return;
          }
          
          // Get dimensions
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          
          // QUALITY FILTER:
          // If dimensions are missing or too small, we usually skip.
          // Exception: Pinterest search results are typically 236px wide thumbnails
          // that we upgrade to /originals/ later.
          const pinMarkers = ['/236x/', '/474x/', '/564x/', '/736x/', '/originals/'];
          const isPinterestPin = pinMarkers.some(marker => src.includes(marker));
          
          if (isPinterestPin) {
            // For pins, we accept them if they are at least 200px wide (standard thumbnail)
            // This ensures we can upgrade them to high-res later.
            if (width < 200 || (height > 0 && height < 200)) return;
          } else {
            // For non-pin images, strictly enforce the user's quality limits
            if (width < minWidth || height < minHeight) return;
          }
          
          // Final check: if we have a width but height is 0, it's likely a broken/loading image
          if (width > 0 && height === 0) return;
          
          // Find parent container for metadata
          let parent = img.closest('[data-test-id="pin"]') || 
                      img.closest('[data-grid-item="true"]') ||
                      img.closest('div[role="listitem"]') ||
                      img.parentElement;
          
          let title = '';
          let description = '';
          let altText = img.alt || '';
          let allText = [];
          
          // Try to extract text from parent
          if (parent) {
            const textNodes = parent.querySelectorAll('div, span, h1, h2, p');
            textNodes.forEach(node => {
              const text = node.textContent.trim();
              if (text && text.length > 2 && text.length < 500) {
                allText.push(text);
              }
            });
            
            if (allText.length > 0) {
              title = allText[0];
              if (allText.length > 1) {
                description = allText.slice(1).join(' ');
              }
            }
          }
          
          // Upgrade URL to original quality
          let cleanUrl = src.split('?')[0];
          const qualityMarkers = ['/236x/', '/474x/', '/736x/', '/564x/', '/170x/'];
          let upgraded = false;
          
          for (const marker of qualityMarkers) {
            if (cleanUrl.includes(marker)) {
              cleanUrl = cleanUrl.replace(marker, '/originals/');
              upgraded = true;
              break;
            }
          }
          
          results.push({
            url: cleanUrl,
            width: width || 0,
            height: height || 0,
            title: title,
            description: description,
            altText: altText,
            allText: allText,
            upgraded: upgraded
          });
        } catch (e) {
          // Skip
        }
      });
      
      return results;
    }, this.minImageWidth, this.minImageHeight);
  }

  async saveProgress() {
    const data = {
      totalImages: this.images.length,
      uniqueUrls: this.imageUrlSet.size,
      targetCount: this.targetCount,
      processedSearches: Array.from(this.processedSearches),
      currentSearch: this.currentSearch,
      images: this.images,
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(
      this.outputFile,
      JSON.stringify(data, null, 2),
      'utf-8'
    );

    console.log(`💾 SAVED: ${this.images.length.toLocaleString()} images | Searches: ${this.processedSearches.size}`);
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(data);
      
      if (parsed.images) {
        this.images = parsed.images;
        parsed.images.forEach(img => {
          this.imageUrlSet.add(img.url);
        });
      }
      
      if (parsed.processedSearches) {
        this.processedSearches = new Set(parsed.processedSearches);
      }
      
      console.log(`📂 Loaded ${this.images.length.toLocaleString()} images`);
      console.log(`📂 Processed ${this.processedSearches.size} searches`);
    } catch (error) {
      console.log('📝 Starting fresh');
    }
  }

  async scrapeSearch(searchTerm, retryCount = 0) {
    const startSize = this.images.length;
    
    try {
      this.currentSearch = searchTerm;
      console.log(`\n${'='.repeat(70)}`);
      console.log(`🎯 SEARCHING: "${searchTerm}"`);
      console.log(`${'='.repeat(70)}`);
      
      const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(searchTerm)}`;
      
      console.log('   🌐 Loading Pinterest...');
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // CRITICAL: Wait for images to actually load
      let hasImages = await this.waitForImages();
      
      // If no images, try one refresh - sometimes Pinterest fails on first load
      if (!hasImages) {
        console.log('   🔄 No images found. Retrying page load...');
        await this.randomDelay(3000, 5000);
        await this.page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        hasImages = await this.waitForImages();
      }
      
      // Extra wait for dynamic content
      await this.randomDelay(3000, 5000);
      
      // Debug what's on the page
      await this.debugPageContent();
      
      if (!hasImages) {
        console.log('   ⚠️  Still no Pinterest images found. Pinterest might be blocking or search is empty.');
        console.log('   💡 Check the browser window to see what is happening.');
      }

      let consecutiveNoNew = 0;
      let scrollCount = 0;
      const maxScrollsPerSearch = 30;

      while (scrollCount < maxScrollsPerSearch && this.images.length < this.targetCount) {
        scrollCount++;
        
        console.log(`\n📜 Scroll ${scrollCount}/${maxScrollsPerSearch} | Total collected: ${this.images.length.toLocaleString()}`);

        // Extract images
        const extractedImages = await this.extractImagesWithMetadata();
        
        console.log(`   🔍 Found ${extractedImages.length} potential images`);
        
        let newAdded = 0;
        extractedImages.forEach(img => {
          if (!this.imageUrlSet.has(img.url)) {
            this.images.push({
              ...img,
              searchTerm: searchTerm,
              scrapedAt: new Date().toISOString(),
            });
            this.imageUrlSet.add(img.url);
            newAdded++;
          }
        });

        console.log(`   ➕ Added ${newAdded} NEW images (${this.images.length.toLocaleString()} total)`);
        
        // Show sample
        if (newAdded > 0 && extractedImages.length > 0) {
          const sample = extractedImages[0];
          console.log(`   📝 Sample: ${sample.width}x${sample.height} - "${sample.title || 'no title'}"`);
        }

        if (newAdded === 0) {
          consecutiveNoNew++;
          console.log(`   ⚠️  No new images (${consecutiveNoNew}/6)`);
          
          if (consecutiveNoNew >= 6) {
            console.log('   ⏭️  Moving to next search...');
            break;
          }
        } else {
          consecutiveNoNew = 0;
        }

        // Save progress
        if (this.images.length % this.batchSize === 0 || 
            (newAdded > 0 && this.images.length % 50 === 0)) {
          await this.saveProgress();
        }

        // Scroll and wait
        await this.smartScroll();
        await this.randomDelay(this.scrollDelay, this.scrollDelay + 2000);
        
        // Let page load more content
        if (scrollCount % 5 === 0) {
          console.log('   ⏸️  Pausing to let content load...');
          await this.randomDelay(3000, 5000);
        }
      }

      this.processedSearches.add(searchTerm);
      await this.saveProgress();

      const totalAdded = this.images.length - startSize;
      console.log(`✅ FINISHED "${searchTerm}": +${totalAdded} images`);

    } catch (error) {
      console.error(`❌ ERROR with "${searchTerm}": ${error.message}`);
      
      if (retryCount < this.maxRetries) {
        console.log(`🔄 Retrying "${searchTerm}" (${retryCount + 1}/${this.maxRetries})...`);
        await this.randomDelay(8000, 12000);
        return await this.scrapeSearch(searchTerm, retryCount + 1);
      }
    }
  }

  async start() {
    try {
      await this.loadProgress();
      await this.initialize();

      console.log(`\n🎬 MEME & REACTION SCRAPER`);
      console.log(`🎯 Target: ${this.targetCount.toLocaleString()} images`);
      console.log(`📏 Min size: ${this.minImageWidth}x${this.minImageHeight}`);
      console.log(`🔍 Searches: ${this.searchTerms.length}`);
      console.log(`🐛 DEBUG MODE: Browser visible, extra logging\n`);

      const remainingSearches = this.searchTerms.filter(term => !this.processedSearches.has(term));
      
      console.log(`📋 ${remainingSearches.length} searches to process\n`);

      for (const searchTerm of remainingSearches) {
        if (this.images.length >= this.targetCount) {
          console.log('\n🎉 TARGET REACHED!');
          break;
        }

        await this.scrapeSearch(searchTerm);

        // Break between searches
        if (remainingSearches.indexOf(searchTerm) < remainingSearches.length - 1) {
          const breakTime = Math.floor(Math.random() * 4000) + 3000;
          console.log(`\n⏸️  Break: ${(breakTime/1000).toFixed(1)}s before next search...`);
          await this.randomDelay(breakTime, breakTime + 2000);
        }
      }

      await this.generateReport();

    } catch (error) {
      console.error('FATAL ERROR:', error);
      await this.saveProgress();
    } finally {
      if (this.browser) {
        await this.browser.close();
        console.log('🔒 Browser closed');
      }
    }
  }

  async generateReport() {
    const report = {
      summary: {
        totalImages: this.images.length,
        uniqueUrls: this.imageUrlSet.size,
        targetCount: this.targetCount,
        completionPercentage: ((this.images.length / this.targetCount) * 100).toFixed(2),
        searchesProcessed: this.processedSearches.size,
        totalSearchTerms: this.searchTerms.length,
      },
      timestamp: new Date().toISOString(),
    };

    const reportFile = path.join(__dirname, `report_${Date.now()}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

    console.log('\n' + '═'.repeat(70));
    console.log('📊 FINAL REPORT');
    console.log('═'.repeat(70));
    console.log(`Images Collected:    ${report.summary.totalImages.toLocaleString()}`);
    console.log(`Target:              ${report.summary.targetCount.toLocaleString()}`);
    console.log(`Completion:          ${report.summary.completionPercentage}%`);
    console.log(`Searches Done:       ${report.summary.searchesProcessed}/${report.summary.totalSearchTerms}`);
    console.log(`Report:              ${reportFile}`);
    console.log('═'.repeat(70) + '\n');
  }
}

// Configuration
const config = {
  targetCount: 100000,
  outputFile: 'anime_memes_reactions.json',
  batchSize: 500,
  maxRetries: 3,
  scrollDelay: 4000,      // Increased wait time
  minImageWidth: 400,     // Restored for higher quality
  minImageHeight: 400,
};

// Run
(async () => {
  console.log('🎬 Starting DEBUGGED Meme Scraper...\n');
  const scraper = new DebuggedMemeScraperFixed(config);
  await scraper.start();
})();