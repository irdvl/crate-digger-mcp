import { CleanTracksOnlyArgs, CleanTracksOnlyResult, CleanedTrack, ServiceError, ErrorCode, WorkerConfig } from '../types';
import { LLMService } from '../services/llm/llmService';
import { Validation } from '../utils/validation';
import { Logger } from '../utils/logger';

export class CleanTracksOnlyHandler {
  private llmService: LLMService;

  constructor(private config: WorkerConfig) {
    this.llmService = new LLMService(config);
  }

  async handle(args: CleanTracksOnlyArgs): Promise<CleanTracksOnlyResult> {
    const logger = new Logger('clean-only');

    logger.info('handler', 'Starting track cleaning only', {
      trackCount: args.tracks.length,
      provider: args.provider || 'anthropic'
    });

    try {
      // Validate input
      if (!args.tracks || !Array.isArray(args.tracks) || args.tracks.length === 0) {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          'Tracks array is required and must not be empty',
          false
        );
      }

      // Sanitize track strings
      const sanitizedTracks = args.tracks.map(track =>
        Validation.sanitizeString(track, 500)
      ).filter(track => track.length > 0);

      if (sanitizedTracks.length === 0) {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          'No valid track strings found after sanitization',
          false
        );
      }

      // Clean tracks using LLM
      logger.info('llm', 'Cleaning tracks with LLM');
      const rawText = sanitizedTracks.join('\n');
      const cleaned = await this.llmService.parseTracklist(rawText);

      // Calculate estimated cost (rough approximation)
      const estimatedInputTokens = rawText.length / 4; // Rough token estimation
      const estimatedOutputTokens = cleaned.length * 50; // Rough estimation for JSON output
      const cost = this.llmService.calculateCost(estimatedInputTokens, estimatedOutputTokens);

      logger.info('handler', 'Track cleaning completed', {
        inputTracks: sanitizedTracks.length,
        outputTracks: cleaned.length,
        estimatedCost: cost
      });

      return {
        cleaned,
        cost
      };

    } catch (error) {
      if (error instanceof ServiceError) {
        logger.error('handler', 'Track cleaning failed with service error', {
          error: error.message,
          code: error.code
        });
        throw error;
      }

      logger.error('handler', 'Track cleaning failed with unexpected error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        `Unexpected error during track cleaning: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    }
  }
}