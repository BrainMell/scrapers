const fs = require('fs').promises;
const path = require('path');

async function organizeData() {
    const cardsDir = path.join(__dirname, 'shoob_cards');
    const dataPath = path.join(cardsDir, 'cards_data.json');
    const backupPath = path.join(cardsDir, 'cards_data.before_organize.json');

    try {
        console.log('🔍 Searching for all JSON data files in shoob_cards...');
        const files = await fs.readdir(cardsDir);
        
        const jsonFiles = files.filter(f => 
            f.endsWith('.json') && 
            !f.includes('before_organize') && 
            f !== 'cards_data.json' &&
            f !== 'cards_data.backup.json'
        );

        const priorityFiles = ['cards_data.json', 'cards_data.backup.json'];
        const filesToProcess = [];
        for (const pf of priorityFiles) {
            if (files.includes(pf)) filesToProcess.push(pf);
        }
        filesToProcess.push(...jsonFiles);

        console.log(`📂 Found ${filesToProcess.length} files to merge.`);
        
        let allCards = [];
        let allProcessedPages = new Set();

        for (const file of filesToProcess) {
            console.log(`  📄 Processing ${file}...`);
            try {
                const filePath = path.join(cardsDir, file);
                const rawData = await fs.readFile(filePath, 'utf-8');
                if (!rawData.trim()) continue;
                
                const data = JSON.parse(rawData);
                let cards = [];
                let pages = [];

                if (data.cards && Array.isArray(data.cards)) {
                    cards = data.cards;
                    pages = data.processedPages || [];
                } else if (Array.isArray(data)) {
                    cards = data;
                }

                if (cards.length > 0) {
                    allCards = allCards.concat(cards);
                }

                if (Array.isArray(pages)) {
                    pages.forEach(p => {
                        if (typeof p === 'string' && p.includes('-')) {
                            allProcessedPages.add(p);
                        } else if (!isNaN(parseInt(p))) {
                            allProcessedPages.add(`1-${p}`);
                        }
                    });
                }
            } catch (err) {
                console.error(`  ⚠️ Error reading ${file}: ${err.message}`);
            }
        }

        if (allCards.length === 0) {
            throw new Error('No cards found in any of the data files.');
        }

        // Backup
        try {
            if (files.includes('cards_data.json')) {
                const currentRaw = await fs.readFile(dataPath, 'utf-8');
                await fs.writeFile(backupPath, currentRaw);
            }
        } catch (e) {}

        console.log('🧹 Deduplicating and Cleaning...');
        const seen = new Set();
        const animeMap = new Map();

        allCards.forEach(card => {
            if (!card || !card.imageUrl) return;
            if (card.animeName && card.animeName !== 'Unknown Anime') {
                const nameKey = card.cardName?.toLowerCase().trim();
                if (nameKey && (!animeMap.has(nameKey) || animeMap.get(nameKey) === 'Unknown Anime')) {
                    animeMap.set(nameKey, card.animeName);
                }
            }
        });

        const uniqueCards = allCards.filter(card => {
            if (!card || !card.imageUrl) return false;
            if (seen.has(card.imageUrl)) return false;
            seen.add(card.imageUrl);
            
            // Normalize animeName
            if (!card.animeName || card.animeName === 'Unknown Anime') {
                const nameKey = card.cardName?.toLowerCase().trim();
                card.animeName = animeMap.get(nameKey) || 'Unknown Anime';
            }

            // Remove cards still unknown after lookup
            if (!card.animeName || card.animeName === 'Unknown Anime') return false;

            // Ensure types
            card.tier = String(card.tier || '1');
            card.page = parseInt(card.page) || 0;
            card.animeName = String(card.animeName).trim();
            card.cardName = String(card.cardName || 'Unknown Character').trim();

            // Remove creatorName field — keep only creator
            delete card.creatorName;
            if (!card.creator || card.creator === 'Unknown Creator' || card.creator === 'Official') {
                card.creator = 'Anonymous';
            }
            if (card.creator.includes('People who want') || card.creator.includes('Requested by')) {
                card.creator = 'Anonymous';
            }

            // Add description if missing
            if (!card.description || card.description.trim() === '') {
                card.description = `${card.cardName} from ${card.animeName}`;
            }
            
            return true;
        });

        console.log(`✨ Unique cards: ${uniqueCards.length}`);

        console.log('🗂️  Sorting by Page (1 to Last), then Tier, then Anime...');
        const tierOrder = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7, 'Special': 8 };
        
        uniqueCards.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            const tA = tierOrder[a.tier] || 99;
            const tB = tierOrder[b.tier] || 99;
            if (tA !== tB) return tA - tB;
            const animeCmp = a.animeName.localeCompare(b.animeName);
            if (animeCmp !== 0) return animeCmp;
            return a.cardName.localeCompare(b.cardName);
        });

        // Assign unique IDs after sorting
        uniqueCards.forEach((card, index) => {
            card.id = String(index + 1).padStart(5, '0');
        });

        const tierCounts = {};
        const animeSet = new Set();
        uniqueCards.forEach(c => {
            tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1;
            animeSet.add(c.animeName);
        });

        const organizedData = {
            totalCards: uniqueCards.length,
            uniqueCards: uniqueCards.length,
            processedPages: Array.from(allProcessedPages).sort((a, b) => {
                const [aTier, aPage] = a.split('-').map(Number);
                const [bTier, bPage] = b.split('-').map(Number);
                if (aTier !== bTier) return aTier - bTier;
                return aPage - bPage;
            }),
            lastUpdated: new Date().toISOString(),
            cards: uniqueCards,
            metadata: {
                organized: true,
                totalAnimes: animeSet.size,
                tierBreakdown: tierCounts,
                pageRange: uniqueCards.length > 0 ? `${uniqueCards[0].page}-${uniqueCards[uniqueCards.length-1].page}` : '0-0'
            }
        };

        await fs.writeFile(dataPath, JSON.stringify(organizedData, null, 2), 'utf-8');
        
        console.log('\n✅ DONE!');
        console.log(`   • Total Cards: ${uniqueCards.length}`);
        console.log(`   • Page Range: ${organizedData.metadata.pageRange}`);
        console.log(`   • First Card: [P${uniqueCards[0].page}] ${uniqueCards[0].cardName} (${uniqueCards[0].animeName})`);
        console.log(`   • Last Card:  [P${uniqueCards[uniqueCards.length-1].page}] ${uniqueCards[uniqueCards.length-1].cardName} (${uniqueCards[uniqueCards.length-1].animeName})`);

    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }
}

organizeData();