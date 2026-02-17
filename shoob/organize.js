const fs = require('fs').promises;
const path = require('path');

async function organizeData() {
    const dataPath = path.join(__dirname, 'shoob_cards', 'cards_data.json');
    const backupPath = path.join(__dirname, 'shoob_cards', 'cards_data.before_organize.json');

    try {
        console.log('Reading cards_data.json...');
        const rawData = await fs.readFile(dataPath, 'utf-8');
        const data = JSON.parse(rawData);

        if (!data.cards || !Array.isArray(data.cards)) {
            throw new Error('No cards array found in the data file.');
        }

        console.log(`Found ${data.cards.length} cards. Backing up...`);
        await fs.writeFile(backupPath, rawData);

        console.log('Deduplicating and Cleaning...');
        const seen = new Set();
        const uniqueCards = data.cards.filter(card => {
            if (!card.imageUrl) return false;
            if (seen.has(card.imageUrl)) return false;
            seen.add(card.imageUrl);
            
            if (card.creator && card.creator.includes('People who want')) {
                card.creator = 'Official';
            }
            if (!card.creator || card.creator === 'Unknown Creator') {
                card.creator = 'Official';
            }
            return true;
        });

        console.log(`Removed ${data.cards.length - uniqueCards.length} duplicates.`);

        console.log('Sorting by Tier and Anime...');
        const tierOrder = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7 };
        
        uniqueCards.sort((a, b) => {
            const tierDiff = (tierOrder[a.tier] || 0) - (tierOrder[b.tier] || 0);
            if (tierDiff !== 0) return tierDiff;
            return (a.animeName || '').localeCompare(b.animeName || '');
        });

        const organizedData = {
            stats: {
                totalCards: uniqueCards.length,
                pagesProcessed: data.processedPages ? data.processedPages.length : 0,
                lastUpdate: new Date().toISOString(),
                organized: true
            },
            processedPages: (data.processedPages || []).sort((a, b) => {
                const [aTier, aPage] = a.split('-').map(Number);
                const [bTier, bPage] = b.split('-').map(Number);
                if (aTier !== bTier) return aTier - bTier;
                return aPage - bPage;
            }),
            cards: uniqueCards
        };

        console.log('Saving organized data...');
        await fs.writeFile(dataPath, JSON.stringify(organizedData, null, 2), 'utf-8');
        console.log('DONE! Final Count: ' + uniqueCards.length);

    } catch (error) {
        console.error('Error organizing data:', error.message);
    }
}

organizeData();
