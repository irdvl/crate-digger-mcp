import * as cheerio from 'cheerio';
import { CleanedTrack, TrackSearchResult, ServiceError, ErrorCode, WorkerConfig } from '../../types';

export class NotSliderService {
  private readonly retryAttempts = 2;

  constructor(private config: WorkerConfig) {}

  async search(track: CleanedTrack): Promise<TrackSearchResult> {
    const query = `${track.artist} - ${track.title}`;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        // Search for track
        const searchUrl = `${this.config.NOTSLIDER_BASE_URL}?q=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DJMixDownloader/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        const downloadUrl = await this.extractDownloadUrl(html, query);

        if (downloadUrl) {
          const finalUrl = await this.followRedirect(downloadUrl);

          return {
            track,
            found: true,
            source: 'notslider',
            downloadUrl: finalUrl,
            quality: '320kbps',
            format: 'mp3'
          };
        }
      } catch (error) {
        console.warn(`NotSlider search attempt ${attempt + 1} failed for "${query}":`, error);

        if (attempt === this.retryAttempts - 1) {
          return {
            track,
            found: false,
            error: `Search failed after ${this.retryAttempts} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }

        // Exponential backoff
        await this.delay(1000 * Math.pow(2, attempt));
      }
    }

    return {
      track,
      found: false,
      error: 'No 320kbps MP3 found'
    };
  }

  private async extractDownloadUrl(html: string, query: string): Promise<string | null> {
    try {
      const $ = cheerio.load(html);

      // Look for download links with 320kbps quality
      const downloadLinks = $('a[href*=".mp3"], a[href*="download"]').filter((_, element) => {
        const text = $(element).text().toLowerCase();
        const href = $(element).attr('href') || '';

        // Check if link contains 320kbps or high quality indicators
        return text.includes('320') ||
               text.includes('320kbps') ||
               text.includes('high quality') ||
               text.includes('download') ||
               href.includes('.mp3');
      });

      // Return the first valid download link
      for (let i = 0; i < downloadLinks.length; i++) {
        const href = downloadLinks.eq(i).attr('href');
        if (href && (href.startsWith('http') || href.startsWith('/'))) {
          return href.startsWith('/') ? `${this.config.NOTSLIDER_BASE_URL}${href}` : href;
        }
      }

      // Fallback: look for any MP3 link
      const mp3Links = $('a[href*=".mp3"]');
      if (mp3Links.length > 0) {
        const href = mp3Links.first().attr('href');
        if (href) {
          return href.startsWith('http') ? href : `${this.config.NOTSLIDER_BASE_URL}${href}`;
        }
      }

      return null;
    } catch (error) {
      console.warn('Failed to extract download URL from NotSlider HTML:', error);
      return null;
    }
  }

  private async followRedirect(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DJMixDownloader/1.0)'
        }
      });

      return response.url;
    } catch (error) {
      console.warn('Failed to follow redirect:', error);
      return url; // Return original URL if redirect fails
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}