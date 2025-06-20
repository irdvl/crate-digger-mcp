import { GenerateScriptOnlyArgs, GenerateScriptOnlyResult, TrackSearchResult, ServiceError, ErrorCode, WorkerConfig } from '../types';
import { ScriptBuilder } from '../services/script/scriptBuilder';
import { Validation } from '../utils/validation';
import { Logger } from '../utils/logger';

export class GenerateScriptOnlyHandler {
  private scriptBuilder: ScriptBuilder;

  constructor(private config: WorkerConfig) {
    this.scriptBuilder = new ScriptBuilder();
  }

  async handle(args: GenerateScriptOnlyArgs): Promise<GenerateScriptOnlyResult> {
    const logger = new Logger('script-only');

    logger.info('handler', 'Starting script generation only', {
      trackCount: args.searchResults.length,
      mixTitle: args.mixTitle
    });

    try {
      // Validate input
      if (!args.searchResults || !Array.isArray(args.searchResults)) {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          'Search results array is required',
          false
        );
      }

      if (!args.mixTitle || typeof args.mixTitle !== 'string') {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          'Mix title is required and must be a string',
          false
        );
      }

      // Sanitize mix title
      const sanitizedMixTitle = Validation.sanitizeString(args.mixTitle, 200);

      // Validate search results structure
      const validResults: TrackSearchResult[] = [];
      for (const result of args.searchResults) {
        if (result && typeof result === 'object' && 'track' in result && 'found' in result) {
          validResults.push(result);
        } else {
          logger.warn('handler', 'Invalid search result structure', { result });
        }
      }

      if (validResults.length === 0) {
        throw new ServiceError(
          ErrorCode.LLM_PARSE_FAILED,
          'No valid search results found',
          false
        );
      }

      // Generate download script
      logger.info('script', 'Generating download script');
      const script = this.scriptBuilder.build(validResults, sanitizedMixTitle);

      logger.info('handler', 'Script generation completed', {
        trackCount: validResults.length,
        mixTitle: sanitizedMixTitle,
        foundTracks: validResults.filter(r => r.found).length
      });

      return {
        script
      };

    } catch (error) {
      if (error instanceof ServiceError) {
        logger.error('handler', 'Script generation failed with service error', {
          error: error.message,
          code: error.code
        });
        throw error;
      }

      logger.error('handler', 'Script generation failed with unexpected error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new ServiceError(
        ErrorCode.LLM_PARSE_FAILED,
        `Unexpected error during script generation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    }
  }
}