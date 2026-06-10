const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function run() {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log("Browser launched successfully!");
    const page = await browser.newPage();
    console.log("Opening shoob.gg...");
    await page.goto('https://shoob.gg/cards?page=1&tier=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log("DOM content loaded. Waiting for cards selector...");
    
    // Wait for card links
    await page.waitForSelector('a[href*="/cards/info/"], a[href*="/card/"]', { timeout: 15000 });
    console.log("Cards selector found!");
    
    const content = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const links = Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.innerText }));
        return { bodyText: bodyText.substring(0, 500), links: links.slice(0, 10) };
    });
    
    console.log("Body text snippet:\n", content.bodyText);
    console.log("Links count:", content.links.length);
    console.log("Links:", content.links);
    
    await browser.close();
    process.exit(0);
}

run().catch(err => {
    console.error("Puppeteer launch failed:", err);
    process.exit(1);
});
