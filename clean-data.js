const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'shoob', 'shoob_cards', 'cards_data.json');

try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const originalCount = data.cards.length;
    
    // Pages to re-scrape (those that had at least one Unknown)
    const pagesToRetry = new Set();
    
    // Filter cards
    const cleanCards = data.cards.filter(card => {
        const isUnknown = card.animeName === 'Unknown Anime' || card.creator === 'Unknown Creator';
        if (isUnknown) {
            const pageKey = `${card.tier}-${card.page}`;
            pagesToRetry.add(pageKey);
            return false;
        }
        return true;
    });
    
    // Remove those pages from processedPages so scraper retries them
    const originalProcessedCount = data.processedPages.length;
    data.processedPages = data.processedPages.filter(page => !pagesToRetry.has(page));
    
    data.cards = cleanCards;
    data.totalCards = cleanCards.length;
    data.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    console.log(`🧹 Cleaned ${originalCount - cleanCards.length} "Unknown" cards.`);
    console.log(`🔄 Removed ${pagesToRetry.size} pages from processed list for retry.`);
    console.log(`📈 New total: ${cleanCards.length} cards.`);
    
} catch (error) {
    console.error('❌ Error cleaning file:', error.message);
}
