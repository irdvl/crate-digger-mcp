import { RawTrack, ServiceError, ErrorCode } from '../../types';

export class YouTubeService {
  private readonly timeout = 25000;

  async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cf: { cacheTtl: 300 } // 5-minute edge cache
      });

      if (!response.ok) {
        throw new ServiceError(
          ErrorCode.YOUTUBE_FETCH_FAILED,
          `Failed to fetch YouTube page: ${response.status} ${response.statusText}`,
          true
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceError(
          ErrorCode.TIMEOUT,
          'YouTube fetch request timed out',
          true
        );
      }

      throw new ServiceError(
        ErrorCode.YOUTUBE_FETCH_FAILED,
        `Failed to fetch YouTube page: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  extractChapters(html: string): RawTrack[] | null {
    try {
      // Extract JSON-LD VideoObject.hasPart
      const jsonLdMatch = html.match(
        /<script[^>]+type="application\/ld\+json"[^>]*>([^<]+)<\/script>/
      );

      if (jsonLdMatch) {
        const data = JSON.parse(jsonLdMatch[1]);
        return this.parseChapters(data);
      }
      return null;
    } catch (error) {
      console.warn('Failed to extract chapters from JSON-LD:', error);
      return null;
    }
  }

  extractDescription(html: string): string {
    try {
      // Fallback to raw description
      const match = html.match(/"shortDescription":"(.*?)"/);
      return match ? this.unescapeDescription(match[1]) : '';
    } catch (error) {
      console.warn('Failed to extract description:', error);
      return '';
    }
  }

  extractMixTitle(html: string): string {
    try {
      // Extract title from meta tags or JSON-LD
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
      if (titleMatch) {
        return this.unescapeDescription(titleMatch[1]);
      }

      // Fallback to JSON-LD title
      const jsonLdMatch = html.match(
        /<script[^>]+type="application\/ld\+json"[^>]*>([^<]+)<\/script>/
      );
      if (jsonLdMatch) {
        const data = JSON.parse(jsonLdMatch[1]);
        if (data.name) {
          return this.unescapeDescription(data.name);
        }
      }

      return 'Unknown Mix';
    } catch (error) {
      console.warn('Failed to extract mix title:', error);
      return 'Unknown Mix';
    }
  }

  private parseChapters(data: any): RawTrack[] | null {
    try {
      // Handle different JSON-LD structures
      if (data.hasPart && Array.isArray(data.hasPart)) {
        return data.hasPart
          .filter((part: any) => part['@type'] === 'Clip' && part.name)
          .map((part: any, index: number) => ({
            index: index + 1,
            timestamp: part.startOffset || undefined,
            rawText: part.name
          }));
      }

      // Alternative structure
      if (data.video && data.video.hasPart && Array.isArray(data.video.hasPart)) {
        return data.video.hasPart
          .filter((part: any) => part['@type'] === 'Clip' && part.name)
          .map((part: any, index: number) => ({
            index: index + 1,
            timestamp: part.startOffset || undefined,
            rawText: part.name
          }));
      }

      return null;
    } catch (error) {
      console.warn('Failed to parse chapters from JSON-LD:', error);
      return null;
    }
  }

  private unescapeDescription(text: string): string {
    return text
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\');
  }

  // Parse description text into tracks when chapters are not available
  parseDescriptionTracks(description: string): RawTrack[] {
    const lines = description.split('\n');
    const tracks: RawTrack[] = [];
    let index = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Look for timestamp patterns like "1:23:45" or "1:23" followed by track info
      const timestampMatch = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);

      if (timestampMatch) {
        tracks.push({
          index,
          timestamp: timestampMatch[1],
          rawText: timestampMatch[2].trim()
        });
        index++;
      } else if (trimmed.includes('-') || trimmed.includes('–') || trimmed.includes('—')) {
        // Likely a track line without timestamp
        tracks.push({
          index,
          rawText: trimmed
        });
        index++;
      }
    }

    return tracks;
  }
}