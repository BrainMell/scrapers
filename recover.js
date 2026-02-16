const fs = require('fs');
const path = require('path');

console.log('🔍 RECOVERY TOOL - Searching for your data...\n');

const outputFolder = path.join(__dirname, 'shoob_cards');
const mainFile = path.join(outputFolder, 'cards_data.json');

// Check main file
console.log('📂 Checking main data file...');
try {
  const stats = fs.statSync(mainFile);
  const data = JSON.parse(fs.readFileSync(mainFile, 'utf-8'));
  console.log(`   ✅ Found: ${data.totalCards || 0} cards, ${data.processedPages?.length || 0} pages`);
  console.log(`   📅 Last updated: ${data.lastUpdated || 'unknown'}`);
  console.log(`   💾 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  if (data.totalCards > 0) {
    console.log('\n✨ YOUR DATA IS STILL THERE! The file is fine.');
    console.log('   The scraper probably just had a loading error.');
    process.exit(0);
  }
} catch(e) {
  console.log(`   ❌ Not found or corrupted: ${e.message}`);
}

// Check for Windows shadow copies / temp files
console.log('\n🔍 Checking for backup files...');
try {
  const files = fs.readdirSync(outputFolder);
  const backups = files.filter(f => 
    f.includes('cards_data') || 
    f.includes('backup') ||
    f.includes('.bak') ||
    f.includes('~')
  );
  
  if (backups.length > 0) {
    console.log('   📦 Found potential backups:');
    backups.forEach(file => {
      try {
        const filePath = path.join(outputFolder, file);
        const stats = fs.statSync(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        console.log(`      • ${file}`);
        console.log(`        Cards: ${data.totalCards || 0}, Pages: ${data.processedPages?.length || 0}`);
        console.log(`        Date: ${data.lastUpdated || 'unknown'}`);
        console.log(`        Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } catch(e) {}
    });
  } else {
    console.log('   ❌ No backup files found');
  }
} catch(e) {}

// Check Windows Previous Versions
console.log('\n💡 MANUAL RECOVERY OPTIONS:');
console.log('   1. Right-click on shoob_cards folder');
console.log('   2. Properties → Previous Versions tab');
console.log('   3. Look for versions from before you ran the scraper');
console.log('   4. Restore the old version');
console.log('\n   OR use Windows File Recovery:');
console.log('   winfr C: C:\\Recovery /n \\Users\\DELL\\Desktop\\pinscrape\\shoob_cards\\cards_data.json');

console.log('\n❌ RECOVERY STATUS: Could not find recoverable data automatically');
console.log('   Try the manual steps above, or restart the scraper.');