# Pinterest Scraper

A sophisticated Pinterest URL scraper built with Puppeteer, featuring anti-detection measures, automatic retry logic, and progress saving.

## ⚠️ IMPORTANT LEGAL NOTICE

**This tool is for educational purposes only.** Web scraping Pinterest likely violates their Terms of Service. Use at your own risk:

- ❌ May result in IP bans
- ❌ May violate Pinterest's Terms of Service
- ❌ Could have legal consequences
- ✅ Consider using Pinterest's official API instead
- ✅ Always respect robots.txt and rate limits
- ✅ Only use for personal research/education

## Features

✨ **Anti-Detection Measures**
- Puppeteer Stealth plugin
- Randomized delays between actions
- Human-like scrolling patterns
- Realistic user agents and headers
- Random viewport movements

🔄 **Reliability**
- Automatic retry on failures (configurable retries)
- Progress auto-save every 1000 URLs
- Resume from last session
- Graceful error handling

💾 **Data Management**
- Local JSON file storage
- Grouped and deduplicated URLs
- Progress reports
- Batch processing

## Installation

```bash
# Install dependencies
npm install

# Or with yarn
yarn install
```

## Quick Start

```bash
# Run the scraper
npm start
```

The scraper will:
1. Open Pinterest in stealth mode
2. Search for "anime" (configurable)
3. Scroll and extract URLs
4. Save progress automatically
5. Generate a final report

## Configuration

Edit the scraper configuration in `pinterest-scraper.js`:

```javascript
const scraper = new PinterestScraper({
  searchQuery: 'anime',        // Search term
  targetCount: 100000,         // Target number of URLs
  outputFile: 'pinterest_anime_urls.json',  // Output filename
  batchSize: 1000,            // Save progress every N URLs
  maxRetries: 5,              // Max retry attempts on failure
  scrollDelay: 2000,          // Delay between scrolls (ms)
});
```

## Output Format

The scraper generates a JSON file with this structure:

```json
{
  "searchQuery": "anime",
  "totalUrls": 50000,
  "urls": [
    "https://www.pinterest.com/pin/123456789/",
    "https://i.pinimg.com/originals/...",
    ...
  ],
  "lastUpdated": "2024-02-14T10:30:00.000Z"
}
```

## Advanced Usage

### Custom Search Query

```javascript
const scraper = new PinterestScraper({
  searchQuery: 'your search term here',
  targetCount: 50000,
});
```

### Adjust Speed and Stealth

```javascript
const scraper = new PinterestScraper({
  scrollDelay: 3000,  // Slower = more stealthy
  maxRetries: 10,     // More retries = more persistent
});
```

### Resume Interrupted Scraping

The scraper automatically resumes from the last saved progress. Simply run it again:

```bash
npm start
```

## How It Works

1. **Initialization**: Launches headless Chrome with stealth plugins
2. **Navigation**: Goes to Pinterest search page
3. **Extraction**: Finds pin URLs using multiple CSS selectors
4. **Scrolling**: Simulates human-like scrolling behavior
5. **Deduplication**: Uses a Set to store unique URLs
6. **Saving**: Periodically saves progress to disk
7. **Retry**: Automatically retries on network failures
8. **Completion**: Generates summary report

## Anti-Detection Techniques

- 🎭 Stealth plugin to mask automation
- 🎲 Random delays (1-3 seconds)
- 📜 Human-like scroll patterns
- 🖱️ Random mouse movements
- ⏰ Periodic breaks (every 20 scrolls)
- 🔄 Natural back-scrolls occasionally
- 🌐 Realistic browser headers
- 📱 Standard viewport sizes

## Troubleshooting

### "No new URLs found"

The scraper might have exhausted available content. Pinterest limits how many results are shown. Try:
- Different search terms
- More specific queries
- Running multiple smaller scrapes

### "Browser crashes"

Increase system resources or add these launch args:

```javascript
args: [
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
]
```

### "Detected and blocked"

If Pinterest detects the scraper:
- Increase `scrollDelay` to 4000-6000ms
- Reduce scraping frequency
- Use residential proxies (advanced)
- Add more random behaviors

## Rate Limiting

To be respectful of Pinterest's servers:

```javascript
const scraper = new PinterestScraper({
  scrollDelay: 5000,  // Wait 5 seconds between scrolls
});
```

## Proxy Support (Advanced)

Add proxy support by modifying the launch args:

```javascript
args: [
  '--proxy-server=http://your-proxy:port',
]
```

## Environment Variables

Create a `.env` file for sensitive configuration:

```bash
PINTEREST_SEARCH_QUERY=anime
TARGET_COUNT=100000
SCROLL_DELAY=2000
```

Then load it:

```javascript
require('dotenv').config();

const scraper = new PinterestScraper({
  searchQuery: process.env.PINTEREST_SEARCH_QUERY,
  targetCount: parseInt(process.env.TARGET_COUNT),
});
```

## Data Export

Convert JSON to CSV:

```javascript
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('pinterest_anime_urls.json'));
const csv = data.urls.map(url => `"${url}"`).join('\n');
fs.writeFileSync('urls.csv', csv);
```

## Performance Tips

- Run on a server with good network connection
- Use SSD for faster file I/O
- Monitor memory usage (100k URLs ≈ 10-20MB)
- Consider splitting into multiple smaller scrapes

## Ethical Considerations

Before using this tool, consider:

1. **Legal**: Check Pinterest's Terms of Service
2. **Technical**: Respect rate limits and robots.txt
3. **Ethical**: Don't overwhelm their servers
4. **Privacy**: Don't scrape personal information
5. **Purpose**: Use data responsibly

## Alternatives

Instead of scraping, consider:

- **Pinterest API**: Official, legal, rate-limited
- **Pinterest RSS**: For some boards
- **Manual Export**: Pinterest's download tools
- **Partnerships**: Official data partnerships

## License

MIT License - Use at your own risk

## Disclaimer

This tool is provided "as is" for educational purposes only. The authors are not responsible for any misuse or violations of terms of service. Always comply with local laws and website terms of service.
