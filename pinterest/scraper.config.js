// Configuration for Smart Anime Scraper

module.exports = {
  // Target settings
  targetCount: 100000,              // Total images to collect
  outputFile: 'anime_images_filtered.json',
  
  // Quality filters
  minImageWidth: 800,               // Minimum width in pixels (800 = HD quality)
  minImageHeight: 800,              // Minimum height in pixels
  
  // Scraping behavior
  batchSize: 500,                   // Auto-save every N images
  maxRetries: 3,                    // Retry attempts per anime
  scrollDelay: 3000,                // Delay between scrolls (ms)
  maxScrollsPerAnime: 20,           // Max scrolls per anime title
  
  // Security
  rotateUserAgentFrequency: 0.3,    // 30% chance to rotate UA between anime
  breakBetweenAnime: [3000, 8000],  // Random break time range [min, max]
  
  // Advanced filters (optional)
  excludePatterns: [
    '/75x75_RS/',      // Tiny thumbnails
    '/170x/',          // Small thumbnails
    '/236x/',          // Medium thumbnails
    '/avatars/',       // Profile pictures
  ],
  
  // Preferred image quality paths
  preferredPaths: [
    '/originals/',     // Highest quality
    '/736x/',          // High quality
    '/564x/',          // Medium-high quality
  ],
  
  // Custom anime list (leave empty to use default)
  customAnimeList: [
    // Add your own anime titles here
    // 'Custom Anime Title 1',
    // 'Custom Anime Title 2',
  ],
  
  // Aspect ratio filters (optional)
  // Set to null to disable
  minAspectRatio: null,  // e.g., 0.5 for very tall images
  maxAspectRatio: null,  // e.g., 3.0 for very wide images
};
