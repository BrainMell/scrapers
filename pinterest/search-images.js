const fs = require('fs');
const path = require('path');

/**
 * Search through scraped anime memes/reactions by metadata
 * Usage: node search-images.js "crying" "naruto"
 */

class ImageSearcher {
  constructor(dataFile = path.join(__dirname, 'anime_memes_reactions.json')) {
    this.dataFile = dataFile;
    this.data = null;
  }

  loadData() {
    try {
      const rawData = fs.readFileSync(this.dataFile, 'utf-8');
      this.data = JSON.parse(rawData);
      console.log(`📂 Loaded ${this.data.images.length.toLocaleString()} images\n`);
      return true;
    } catch (error) {
      console.error(`❌ Error loading ${this.dataFile}: ${error.message}`);
      return false;
    }
  }

  search(keywords, options = {}) {
    if (!this.data) {
      console.error('❌ No data loaded. Run loadData() first.');
      return [];
    }

    const {
      minWidth = 0,
      maxWidth = Infinity,
      minHeight = 0,
      maxHeight = Infinity,
      searchTerm = null,
      limit = 50,
    } = options;

    const results = this.data.images.filter(img => {
      // Dimension filters
      if (img.width && (img.width < minWidth || img.width > maxWidth)) return false;
      if (img.height && (img.height < minHeight || img.height > maxHeight)) return false;
      
      // Search term filter
      if (searchTerm && img.searchTerm !== searchTerm) return false;

      // Keyword matching
      if (!keywords || keywords.length === 0) return true;

      const searchableText = [
        img.title || '',
        img.description || '',
        img.altText || '',
        img.searchTerm || '',
        ...(img.allText || []),
      ].join(' ').toLowerCase();

      return keywords.every(keyword => 
        searchableText.includes(keyword.toLowerCase())
      );
    });

    return results.slice(0, limit);
  }

  displayResults(results) {
    if (results.length === 0) {
      console.log('❌ No results found\n');
      return;
    }

    console.log(`✅ Found ${results.length} results:\n`);
    console.log('═'.repeat(80));

    results.forEach((img, index) => {
      console.log(`\n${index + 1}. ${img.title || 'No title'}`);
      console.log(`   URL: ${img.url}`);
      console.log(`   Size: ${img.width}x${img.height}`);
      console.log(`   Search: ${img.searchTerm}`);
      if (img.description) {
        console.log(`   Desc: ${img.description.substring(0, 100)}${img.description.length > 100 ? '...' : ''}`);
      }
      if (img.allText && img.allText.length > 0) {
        console.log(`   Tags: ${img.allText.slice(0, 5).join(', ')}`);
      }
    });

    console.log('\n' + '═'.repeat(80));
  }

  exportResults(results, filename = 'search_results.json') {
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`\n💾 Exported ${results.length} results to ${filename}`);
  }

  getStats() {
    if (!this.data) {
      console.error('❌ No data loaded');
      return;
    }

    const images = this.data.images;
    
    // Count by search term
    const searchTermCounts = {};
    images.forEach(img => {
      const term = img.searchTerm || 'unknown';
      searchTermCounts[term] = (searchTermCounts[term] || 0) + 1;
    });

    // Top search terms
    const topSearches = Object.entries(searchTermCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    // Dimension stats
    const widths = images.filter(img => img.width).map(img => img.width);
    const heights = images.filter(img => img.height).map(img => img.height);
    
    const avgWidth = widths.length > 0 ? Math.round(widths.reduce((a, b) => a + b, 0) / widths.length) : 0;
    const avgHeight = heights.length > 0 ? Math.round(heights.reduce((a, b) => a + b, 0) / heights.length) : 0;

    console.log('\n📊 STATISTICS');
    console.log('═'.repeat(60));
    console.log(`Total Images:        ${images.length.toLocaleString()}`);
    console.log(`Images with Title:   ${images.filter(img => img.title).length.toLocaleString()}`);
    console.log(`Images with Desc:    ${images.filter(img => img.description).length.toLocaleString()}`);
    console.log(`Average Size:        ${avgWidth}x${avgHeight}`);
    console.log(`\nTop 20 Search Terms:`);
    topSearches.forEach(([term, count], index) => {
      console.log(`  ${index + 1}. ${term} (${count})`);
    });
    console.log('═'.repeat(60) + '\n');
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const searcher = new ImageSearcher();

  if (!searcher.loadData()) {
    process.exit(1);
  }

  // Show stats if no arguments
  if (args.length === 0) {
    console.log('Usage: node search-images.js [keywords...]\n');
    console.log('Examples:');
    console.log('  node search-images.js crying');
    console.log('  node search-images.js naruto reaction');
    console.log('  node search-images.js goku angry\n');
    searcher.getStats();
    process.exit(0);
  }

  // Search by keywords
  const keywords = args;
  console.log(`🔍 Searching for: ${keywords.join(', ')}\n`);
  
  const results = searcher.search(keywords, { limit: 50 });
  searcher.displayResults(results);

  // Ask if user wants to export
  if (results.length > 0) {
    console.log('\n💡 To export results, run:');
    console.log(`   searcher.exportResults(results, 'my-results.json')`);
  }
}

module.exports = ImageSearcher;
