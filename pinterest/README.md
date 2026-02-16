# Anime Meme & Reaction Image Scraper 😂🎭

A specialized Pinterest scraper focused on **anime memes, reactions, and stickers** with full metadata extraction for easy searching and sorting.

## ⚠️ LEGAL DISCLAIMER

Educational purposes only. Use at your own risk.

---

## 🎯 Perfect For:

- 🎨 **Sticker Packs**: Discord, Telegram, WhatsApp
- 😂 **Meme Collections**: Organized and searchable
- 🎭 **Reaction Images**: By character, emotion, show
- 💬 **Chat Emojis**: Custom emoji collections
- 🖼️ **Profile Pictures**: Anime pfp collections

---

## 🌟 Key Features

### 🎯 Meme-Focused Searches
Instead of generic "anime", targets:
- ✅ **"Naruto reaction"**, **"Dragon Ball meme"**
- ✅ **"Goku angry"**, **"anime crying"**
- ✅ **"anime sticker pack"**, **"discord emoji"**
- ✅ **"cursed anime"**, **"wholesome anime meme"**

**300+ specific search combinations!**

### 📝 Full Metadata Extraction
Each image includes:
```json
{
  "url": "https://i.pinimg.com/originals/abc123.jpg",
  "width": 800,
  "height": 600,
  "title": "Naruto crying meme",
  "description": "When you realize it's Monday tomorrow",
  "altText": "Naruto crying face",
  "searchTerm": "Naruto reaction",
  "allText": ["sad", "crying", "relatable", "mood"],
  "aspectRatio": "1.33",
  "scrapedAt": "2024-02-14T10:30:00.000Z"
}
```

### 🔍 Searchable Database
Easily find images by:
- Keywords (crying, angry, shocked)
- Character names (Goku, Naruto, Luffy)
- Anime shows (Dragon Ball, One Piece)
- Emotions/moods (happy, sad, confused)
- Types (meme, reaction, sticker)

---

## 📦 Installation

```bash
npm install
```

---

## 🚀 Quick Start

### Step 1: Run the Scraper

```bash
node pinterest-scraper-memes.js
```

### Step 2: Search Your Collection

```bash
# Show stats
node search-images.js

# Search by keyword
node search-images.js crying

# Search multiple keywords
node search-images.js naruto angry

# Search for stickers
node search-images.js sticker discord
```

---

## 📊 Output Format

### Main Output: `anime_memes_reactions.json`

```json
{
  "totalImages": 50000,
  "uniqueUrls": 49500,
  "targetCount": 100000,
  "processedSearches": ["Naruto meme", "Dragon Ball reaction", ...],
  "currentSearch": "anime crying meme",
  "images": [
    {
      "url": "https://i.pinimg.com/originals/abc/def/123.jpg",
      "width": 1000,
      "height": 800,
      "title": "Naruto crying face meme",
      "description": "When you're trying to be strong but failing",
      "altText": "Naruto tears streaming down face",
      "searchTerm": "Naruto reaction",
      "allText": [
        "sad anime",
        "crying meme",
        "naruto tears",
        "relatable",
        "mood"
      ],
      "aspectRatio": "1.25",
      "scrapedAt": "2024-02-14T10:30:00.000Z"
    },
    ...
  ],
  "filters": {
    "minWidth": 400,
    "minHeight": 400
  },
  "lastUpdated": "2024-02-14T10:30:00.000Z"
}
```

---

## 🔍 Search Examples

### Basic Search

```bash
# Find all crying reactions
node search-images.js crying

# Find Goku reactions
node search-images.js goku

# Find angry memes
node search-images.js angry
```

### Advanced Search

```javascript
const ImageSearcher = require('./search-images.js');
const searcher = new ImageSearcher();
searcher.loadData();

// Find Naruto crying images
const results = searcher.search(['naruto', 'crying'], {
  minWidth: 500,
  limit: 20
});

// Find all stickers
const stickers = searcher.search(['sticker']);

// Find shocked reactions from Dragon Ball
const shocked = searcher.search(['shocked'], {
  searchTerm: 'Dragon Ball reaction'
});

// Export results
searcher.exportResults(results, 'naruto-crying.json');
```

---

## 🎨 Search Terms Included

### Anime Shows (38+)
Naruto, One Piece, Dragon Ball, Demon Slayer, Jujutsu Kaisen, Attack on Titan, Death Note, Tokyo Ghoul, My Hero Academia, Bleach, Hunter x Hunter, and 27 more...

### Characters (30+)
Goku, Vegeta, Naruto, Sasuke, Luffy, Zoro, Ichigo, Deku, Tanjiro, Nezuko, Gojo, Levi, Light, Saitama, and 16 more...

### Meme Types (25+)
- **Emotions**: crying, laughing, shocked, angry, confused, smug
- **Types**: meme, reaction, sticker, emoji, pfp, icon
- **Styles**: cursed, wholesome, relatable, funny
- **Platform**: discord emoji, telegram sticker

### Generated Searches (300+)
Every combination of:
- `[Anime] + meme/reaction/sticker`
- `[Character] + meme/reaction/angry/crying`
- `anime + [emotion/type]`

Examples:
- "Naruto reaction"
- "Goku angry"
- "anime crying meme"
- "Dragon Ball sticker"
- "cursed anime"
- "discord anime emoji"

---

## ⚙️ Configuration

### Quality Settings

```javascript
const config = {
  minImageWidth: 400,   // Lower for memes (not all are high-res)
  minImageHeight: 400,
};
```

**Recommended Settings:**
- **Memes/Reactions**: 300-500px (current default)
- **Stickers**: 200-400px
- **HD Wallpapers**: 1920x1080+

### Target Count

```javascript
targetCount: 100000,  // Adjust as needed
```

---

## 📈 Expected Results

### Per Search Term
- **Popular** (Naruto, Goku): 100-200 images
- **Medium** (specific character reactions): 50-100 images
- **Niche** (specific anime + emotion): 20-50 images

### Overall Performance
- **Speed**: 30-60 images per minute
- **100k images**: 30-50 hours
- **Metadata coverage**: 60-80% have title/description

---

## 🔧 Using the Search Tool

### Command Line

```bash
# Show statistics
node search-images.js

# Search for crying memes
node search-images.js crying

# Multiple keywords (AND logic)
node search-images.js naruto crying

# Find angry Goku
node search-images.js goku angry
```

### Programmatic Usage

```javascript
const ImageSearcher = require('./search-images.js');
const searcher = new ImageSearcher();

// Load data
searcher.loadData();

// Get statistics
searcher.getStats();

// Search
const results = searcher.search(['crying', 'naruto'], {
  minWidth: 500,
  limit: 50
});

// Display results
searcher.displayResults(results);

// Export
searcher.exportResults(results, 'my-results.json');
```

---

## 💡 Use Cases

### 1. Discord Emoji Pack

```javascript
// Find all sticker-sized images
const stickers = searcher.search(['sticker'], {
  minWidth: 200,
  maxWidth: 800,
  minHeight: 200,
  maxHeight: 800,
  limit: 100
});
```

### 2. Reaction Image Collection

```javascript
// Get all crying reactions
const crying = searcher.search(['crying', 'tears']);

// Get all angry reactions
const angry = searcher.search(['angry', 'mad']);

// Get all shocked reactions
const shocked = searcher.search(['shocked', 'surprised']);
```

### 3. Character-Specific Memes

```javascript
// All Goku memes
const goku = searcher.search(['goku']);

// All Naruto reactions
const naruto = searcher.search(['naruto', 'reaction']);

// All Luffy funny moments
const luffy = searcher.search(['luffy', 'funny']);
```

### 4. Mood-Based Collections

```javascript
// Wholesome memes
const wholesome = searcher.search(['wholesome']);

// Cursed images
const cursed = searcher.search(['cursed']);

// Relatable memes
const relatable = searcher.search(['relatable']);
```

---

## 📊 Metadata Fields Explained

| Field | Description | Example |
|-------|-------------|---------|
| `url` | Direct image URL | `i.pinimg.com/originals/...` |
| `width` | Image width in pixels | `1200` |
| `height` | Image height in pixels | `800` |
| `title` | Pin title from Pinterest | "Naruto crying meme" |
| `description` | Pin description | "When you realize it's Monday" |
| `altText` | Image alt text | "Naruto with tears" |
| `searchTerm` | Search query used | "Naruto reaction" |
| `allText` | All text found on pin | ["sad", "crying", "mood"] |
| `aspectRatio` | Width/height ratio | "1.5" |
| `scrapedAt` | Timestamp | "2024-02-14T10:30:00Z" |

---

## 🎯 Filtering Tips

### By Emotion
```javascript
// Sad
searcher.search(['crying', 'sad', 'tears']);

// Happy
searcher.search(['happy', 'laughing', 'smile']);

// Angry
searcher.search(['angry', 'mad', 'rage']);

// Confused
searcher.search(['confused', 'thinking', 'hmm']);
```

### By Type
```javascript
// Memes
searcher.search(['meme', 'funny']);

// Reactions
searcher.search(['reaction', 'face']);

// Stickers
searcher.search(['sticker', 'emoji']);

// PFPs
searcher.search(['pfp', 'profile picture']);
```

### By Size
```javascript
// Small (stickers)
searcher.search([], { maxWidth: 500, maxHeight: 500 });

// Medium (reactions)
searcher.search([], { minWidth: 400, maxWidth: 1000 });

// Large (wallpapers)
searcher.search([], { minWidth: 1920 });
```

---

## 📁 File Structure

```
pinscrape/
├── pinterest-scraper-memes.js       # Main scraper
├── search-images.js                  # Search utility
├── anime_memes_reactions.json       # Output (auto-generated)
├── report_[timestamp].json          # Reports
└── package.json                     # Dependencies
```

---

## 🚀 Advanced Usage

### Export by Category

```javascript
const searcher = new ImageSearcher();
searcher.loadData();

// Export all reactions
const reactions = searcher.search(['reaction']);
searcher.exportResults(reactions, 'reactions.json');

// Export all stickers
const stickers = searcher.search(['sticker']);
searcher.exportResults(stickers, 'stickers.json');

// Export all memes
const memes = searcher.search(['meme']);
searcher.exportResults(memes, 'memes.json');
```

### Build Custom Collections

```javascript
// Crying reactions from top shows
const shows = ['Naruto', 'One Piece', 'Dragon Ball'];
const cryingPack = [];

shows.forEach(show => {
  const results = searcher.search([show, 'crying'], { limit: 20 });
  cryingPack.push(...results);
});

searcher.exportResults(cryingPack, 'crying-pack.json');
```

---

## 🆚 Comparison: Before vs After

### Before (Generic)
```json
{
  "url": "https://pinterest.com/pin/123456/",
  "searchQuery": "anime"
}
```
❌ Pin URL (not image)
❌ No metadata
❌ Generic search

### After (Meme-Focused)
```json
{
  "url": "https://i.pinimg.com/originals/abc.jpg",
  "title": "Naruto crying meme",
  "description": "When you're trying to be strong",
  "searchTerm": "Naruto reaction",
  "allText": ["sad", "crying", "relatable"],
  "width": 800,
  "height": 600
}
```
✅ Direct image URL
✅ Full metadata
✅ Specific search (memes/reactions)
✅ Searchable by keywords

---

## 💡 Pro Tips

1. **Start Small**: Test with 1,000 images first
2. **Check Metadata**: Run `node search-images.js` to see stats
3. **Filter Smart**: Use multiple keywords for better results
4. **Export Often**: Save filtered results to separate files
5. **Organize**: Create category-specific collections

---

## 🎉 Perfect For

- 🎨 Sticker pack creators
- 💬 Discord/Telegram admins
- 😂 Meme page owners
- 🎭 Reaction image collectors
- 🖼️ Anime content creators

---

## 📝 License

MIT - Educational purposes only

---

**Happy Meme Hunting! 😂🎭🎨**