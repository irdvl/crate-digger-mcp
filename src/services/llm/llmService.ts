import { CleanedTrack, ServiceError, ErrorCode, WorkerConfig } from '../../types';

interface AnthropicResponse {
  content?: Array<{
    text?: string;
  }>;
}

export class LLMService {
  private readonly prompt = `You are given raw text from a DJ mix. Extract an ordered JSON array of tracks.
Each item must have:
{
  "index": number,
  "artist": string,
  "title": string,
  "remixInfo": string or null,
  "certainty": float 0-1
}

Rules:
- Remove "feat.", "ft.", "featuring" from artist names
- Extract remix info like "(Remix Name Remix)"
- Set certainty based on confidence in parsing
- Mark unclear entries with certainty < 0.5
- Ensure artist and title are properly separated
- Handle special characters and formatting

Output ONLY valid JSON array, no other text.`;

  constructor(private config: WorkerConfig) {}

  async parseTracklist(rawText: string): Promise<CleanedTrack[]> {
    try {
      const model = this.config.ANTHROPIC_MODEL || 'claude-3-5-haiku';

      const response = await this.callAnthropic({
        model: model,
        messages: [
          { role: 'user', content: this.prompt + '\n\n' + rawText }
        ],
        max_tokens: 2000,
        temperature: 0.3
      });

      return this.validateAndTransform(JSON.parse(response));
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }

      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        `Failed to parse tracklist: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    }
  }

  private async callAnthropic(requestBody: any): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        `Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`,
        response.status >= 500 // Retry on server errors
      );
    }

    const data = await response.json() as AnthropicResponse;

    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        'Invalid response format from Anthropic API',
        false
      );
    }

    return data.content[0].text || '';
  }

  private validateAndTransform(rawResponse: any): CleanedTrack[] {
    if (!Array.isArray(rawResponse)) {
      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        'LLM response is not an array',
        false
      );
    }

    return rawResponse.map((item, index) => {
      // Validate required fields
      if (typeof item.index !== 'number' || typeof item.artist !== 'string' || typeof item.title !== 'string') {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          `Invalid track data at index ${index}: missing required fields`,
          false
        );
      }

      // Validate certainty
      const certainty = typeof item.certainty === 'number' ? Math.max(0, Math.min(1, item.certainty)) : 0.5;

      // Clean up artist and title
      const artist = this.cleanArtistName(item.artist);
      const title = this.cleanTitle(item.title);
      const remixInfo = item.remixInfo && typeof item.remixInfo === 'string' ? item.remixInfo.trim() : undefined;

      return {
        index: item.index,
        original: `${item.artist} - ${item.title}`,
        artist,
        title,
        remixInfo,
        certainty,
        isValid: certainty >= 0.5
      };
    });
  }

  private cleanArtistName(artist: string): string {
    return artist
      .trim()
      .replace(/\s*feat\.?\s*/gi, ' ')
      .replace(/\s*ft\.?\s*/gi, ' ')
      .replace(/\s*featuring\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanTitle(title: string): string {
    return title
      .trim()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Calculate estimated cost for the API call
  calculateCost(inputTokens: number, outputTokens: number): number {
    // Claude 3.5 Haiku pricing: $0.80/1M input tokens, $4.00/1M output tokens
    const inputCost = (inputTokens / 1000000) * 0.80;
    const outputCost = (outputTokens / 1000000) * 4.00;
    return inputCost + outputCost;
  }
}