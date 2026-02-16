# Shoob.gg Card Scraper 🎴

A specialized scraper for https://shoob.gg/cards that extracts card images and metadata across all 2,332 pages (34,969+ cards).

---

## 🎯 Features

✅ **Scrapes All Pages**: Handles all 2,332 pages automatically
✅ **Full Metadata**: Card name, type, ability, rarity, cost, stats
✅ **No Duplicates**: Tracks scraped URLs to avoid re-downloads
✅ **Resume Support**: Automatically resumes from where it left off
✅ **Organized Output**: Creates folder with JSON data file
✅ **Format Detection**: Handles both PNG and GIF images
✅ **Template Wait**: Waits for template images to load before scraping

---

## 📦 Installation

```bash
npm install
```

---

## 🚀 Quick Start

### Test Run (1 Page):

```bash
node shoob-scraper.js
```

This will scrape **page 1 only** as a test.

### Full Scrape (All 2,332 Pages):

Edit the config in `shoob-scraper.js`:

```javascript
const config = {
  startPage: 1,
  endPage: 2332,  // ← Change this from 1 to 2332
  outputFolder: 'shoob_cards',
  minImageWidth: 399,
  minImageHeight: 399,
  imageWaitTime: 3000,
};
```

Then run:
```bash
node shoob-scraper.js
```

---

## ⚙️ Configuration Options

```javascript
const config = {
  startPage: 1,              // First page to scrape
  endPage: 1,                // Last page to scrape
  outputFolder: 'shoob_cards',  // Output folder name
  minImageWidth: 399,        // Filter: minimum width
  minImageHeight: 399,       // Filter: minimum height
  imageWaitTime: 3000,       // Wait time for images (ms)
};
```

### Common Configurations:

**Test run (1 page):**
```javascript
startPage: 1,
endPage: 1,
```

**First 10 pages:**
```javascript
startPage: 1,
endPage: 10,
```

**Pages 100-200:**
```javascript
startPage: 100,
endPage: 200,
```

**All pages (full scrape):**
```javascript
startPage: 1,
endPage: 2332,
```

---

## 📁 Output Structure

```
shoob_cards/
├── cards_data.json          # Main data file with all cards
└── report_[timestamp].json  # Statistics report
```

### Output Format: `cards_data.json`

```json
{
  "totalCards": 15,
  "uniqueCards": 15,
  "processedPages": [1],
  "pageRange": "1-1",
  "cards": [
    {
      "imageUrl": "https://shoob.gg/images/card123.png",
      "width": 400,
      "height": 514,
      "format": "png",
      "cardName": "Fire Dragon",
      "cardType": "Creature",
      "ability": "Flying, Haste",
      "rarity": "Rare",
      "cost": "4",
      "stats": "5/5",
      "additionalText": ["Dragon", "Fire", "Flying"],
      "altText": "Fire Dragon card",
      "scrapedPage": 1,
      "scrapedAt": "2024-02-14T10:30:00.000Z"
    },
    ...
  ],
  "metadata": {
    "minImageWidth": 399,
    "minImageHeight": 399,
    "scrapedFrom": "shoob.gg"
  },
  "lastUpdated": "2024-02-14T10:30:00.000Z"
}
```

---

## 🔍 Metadata Extracted

Each card includes:

| Field | Description | Example |
|-------|-------------|---------|
| `imageUrl` | Direct image URL | `https://shoob.gg/...` |
| `width` | Image width (px) | `400` |
| `height` | Image height (px) | `514` |
| `format` | File format | `png`, `gif` |
| `cardName` | Name of the card | "Fire Dragon" |
| `cardType` | Card type | "Creature", "Spell" |
| `ability` | Card ability/text | "Flying, Haste" |
| `rarity` | Card rarity | "Common", "Rare" |
| `cost` | Mana/resource cost | "4" |
| `stats` | Attack/Defense | "5/5" |
| `additionalText` | Extra metadata | ["Dragon", "Fire"] |
| `altText` | Image alt text | "" |
| `scrapedPage` | Page number | `1` |
| `scrapedAt` | Timestamp | ISO date string |

---

## 📊 Expected Performance

### Single Page:
- **Time**: 5-10 seconds
- **Cards**: ~15 cards per page
- **Output**: Immediate

### Full Scrape (2,332 pages):
- **Total Cards**: ~34,969 cards
- **Time**: 3-6 hours
- **Output Size**: ~50-100 MB JSON

### Breakdown:
- ~5 seconds per page
- ~4 seconds break between pages
- ~9 seconds total per page
- 2,332 pages × 9 seconds = ~5.8 hours

---

## 🔄 Resume Support

The scraper **automatically resumes** from where it stopped!

If you stop the scraper:
1. Already scraped pages are saved
2. Already scraped cards are saved
3. Run the scraper again
4. It skips processed pages and continues

**Example:**
```
First run: Scraped pages 1-500, stopped
Second run: Automatically skips 1-500, continues from 501
```

---

## 💡 Usage Examples

### Test First Page:
```bash
node shoob-scraper.js
```

### Scrape Pages 1-100:
```javascript
// Edit config
startPage: 1,
endPage: 100,
```
```bash
node shoob-scraper.js
```

### Scrape ALL Pages:
```javascript
// Edit config
startPage: 1,
endPage: 2332,
```
```bash
node shoob-scraper.js
```

### Continue After Stopping:
Just run it again - it resumes automatically!
```bash
node shoob-scraper.js
```

---

## 🎨 Filtering Options

### All Images (No Filter):
```javascript
minImageWidth: 0,
minImageHeight: 0,
```

### Standard Cards Only (400x514):
```javascript
minImageWidth: 399,
minImageHeight: 399,
```

### High Quality Only:
```javascript
minImageWidth: 500,
minImageHeight: 500,
```

---

## 🐛 Troubleshooting

### "Found 0 cards"

**Problem**: Images not loading or wrong selectors

**Solutions:**
1. Increase wait time:
```javascript
imageWaitTime: 5000,  // 5 seconds
```

2. Check the browser window - do you see cards?

3. Website structure may have changed - selectors need updating

### "Taking too long"

**Solutions:**
1. Scrape in batches:
```javascript
// First batch
startPage: 1,
endPage: 500,

// Second batch (after first finishes)
startPage: 501,
endPage: 1000,
```

2. Reduce wait time (if stable):
```javascript
imageWaitTime: 2000,  // 2 seconds
```

### "Duplicate cards"

The scraper tracks URLs to prevent duplicates. If you see duplicates:
- Different pages may have same card with different metadata
- This is expected and preserved

---

## 📈 Progress Monitoring

### Console Output:

```
📄 SCRAPING PAGE 1
🌐 Loading: https://shoob.gg/cards?page=1
⏳ Waiting 3s for images to fully load...
   📸 Found 150 image elements on page
   🎴 Extracted 15 cards with data
   ➕ Added 15 NEW cards (15 total)
   📝 Sample Card:
      Name: Fire Dragon
      Type: Creature
      Size: 400x514 (png)
      URL: https://shoob.gg/images/...
💾 Saved: 15 cards to shoob_cards/cards_data.json
✅ Finished page 1: +15 cards
```

### Check Progress:
```powershell
# Windows
Get-Content shoob_cards\cards_data.json | ConvertFrom-Json | Select totalCards, processedPages
```

---

## 🎯 Tips for Full Scrape

1. **Test First**: Run 1 page to verify it works
2. **Check Output**: Look at `cards_data.json` to see if metadata is good
3. **Batch Scraping**: Do 500 pages at a time if you're worried about crashes
4. **Run Overnight**: Full scrape takes 4-6 hours
5. **Stable Internet**: Ensure good connection

---

## 📝 Adjusting for Website Changes

If Shoob.gg changes their HTML structure, update the selectors in `extractCardsFromPage()`:

```javascript
// Current selectors (in the code)
const cardElements = document.querySelectorAll('[class*="card"]');
const nameElement = container?.querySelector('[class*="name"]');
const typeElement = container?.querySelector('[class*="type"]');
```

**How to find new selectors:**
1. Right-click on a card → Inspect
2. Look at the HTML structure
3. Update the `querySelector` calls

---

## 🔐 Rate Limiting

The scraper includes:
- ✅ 2-4 second breaks between pages
- ✅ 3 second wait for images to load
- ✅ Retry logic (3 attempts per page)
- ✅ Human-like delays

This should be safe for the server. If you get blocked:
- Increase delays
- Add longer breaks every N pages

---

## 📊 Sample Report

After scraping, you'll get a report like:

```
📊 SCRAPING REPORT
═══════════════════════════════════════════════════════════
Total Cards:         34,969
Unique Cards:        34,850
Pages Processed:     2,332
Page Range:          1-2332

Metadata Coverage:
  With Names:        32,450
  With Abilities:    28,600

Image Formats:
  png:               30,200
  gif:               4,769

Output Location:     shoob_cards
Report saved:        shoob_cards/report_1707925200000.json
═══════════════════════════════════════════════════════════
```

---

## 🆚 Quick Reference

| What | How |
|------|-----|
| Test 1 page | `endPage: 1` |
| Scrape all | `endPage: 2332` |
| Change output folder | `outputFolder: 'my_folder'` |
| Increase quality | `minImageWidth: 500` |
| Faster scraping | `imageWaitTime: 2000` |
| Resume scraping | Just run again |

---

## ✅ Checklist

- [ ] Ran test with 1 page
- [ ] Checked `shoob_cards/cards_data.json` exists
- [ ] Verified cards have good metadata
- [ ] Changed `endPage` to desired number
- [ ] Started full scrape
- [ ] Monitoring progress occasionally

---

## 💾 Output Files

### `cards_data.json`
Main database with all cards and metadata

### `report_[timestamp].json`
Statistics and breakdown

**Both files are in the `shoob_cards/` folder**

---

**Ready to scrape all 34,969 cards!** 🎴

Change `endPage: 2332` and run it! 🚀
