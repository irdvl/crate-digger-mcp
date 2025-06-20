import { ExtractTracksOnlyArgs, ExtractTracksOnlyResult, RawTrack, ServiceError, ErrorCode, WorkerConfig } from '../types';
import { YouTubeService } from '../services/youtube/youtubeService';
import { Validation } from '../utils/validation';
import { Logger } from '../utils/logger';

export class ExtractTracksOnlyHandler {
  private youtubeService: YouTubeService;

  constructor(private config: WorkerConfig) {
    this.youtubeService = new YouTubeService();
  }

  async handle(args: ExtractTracksOnlyArgs): Promise<ExtractTracksOnlyResult> {
    const logger = new Logger('extract-only');

    logger.info('handler', 'Starting track extraction only', {
      url: args.url,
      includeTimestamps: args.includeTimestamps
    });

    try {
      // Validate input
      const validatedUrl = Validation.validateYouTubeUrl(args.url);

      // Fetch YouTube HTML
      logger.info('youtube', 'Fetching YouTube page');
      const html = await this.youtubeService.fetchHtml(validatedUrl);

      // Extract mix title
      const mixTitle = this.youtubeService.extractMixTitle(html);
      logger.info('youtube', 'Extracted mix title', { mixTitle });

      // Extract tracks from chapters or description
      let tracks: RawTrack[] = [];
      const chapters = this.youtubeService.extractChapters(html);

      if (chapters && chapters.length > 0) {
        tracks = chapters;
        logger.info('youtube', 'Extracted tracks from chapters', { trackCount: chapters.length });
      } else {
        const description = this.youtubeService.extractDescription(html);
        tracks = this.youtubeService.parseDescriptionTracks(description);
        logger.info('youtube', 'Extracted tracks from description', { trackCount: tracks.length });
      }

      if (tracks.length === 0) {
        throw new ServiceError(
          ErrorCode.NO_TRACKS_FOUND,
          'No tracks found in YouTube video chapters or description',
          false
        );
      }

      // Filter out timestamps if not requested
      if (!args.includeTimestamps) {
        tracks = tracks.map(track => ({
          ...track,
          timestamp: undefined
        }));
      }

      logger.info('handler', 'Track extraction completed', {
        trackCount: tracks.length,
        mixTitle
      });

      return {
        mixTitle,
        trackCount: tracks.length,
        tracks
      };

    } catch (error) {
      if (error instanceof ServiceError) {
        logger.error('handler', 'Track extraction failed with service error', {
          error: error.message,
          code: error.code
        });
        throw error;
      }

      logger.error('handler', 'Track extraction failed with unexpected error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new ServiceError(
        ErrorCode.YOUTUBE_FETCH_FAILED,
        `Unexpected error during track extraction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    }
  }
}