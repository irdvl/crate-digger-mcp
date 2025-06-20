import { v4 as uuidv4 } from 'uuid';
import {
  AnalyzeYoutubeMixArgs,
  AnalyzeYoutubeMixResult,
  RawTrack,
  CleanedTrack,
  TrackSearchResult,
  ProcessingSummary,
  WorkerConfig,
  ServiceError,
  ErrorCode
} from '../types';
import { YouTubeService } from '../services/youtube/youtubeService';
import { LLMService } from '../services/llm/llmService';
import { NotSliderService } from '../services/resolver/notsliderService';
import { SoundCloudService } from '../services/resolver/soundcloudService';
import { YouTubeDlService } from '../services/resolver/youtubeDlService';
import { ScriptBuilder } from '../services/script/scriptBuilder';
import { RateLimiter } from '../utils/rateLimiter';
import { Logger } from '../utils/logger';
import { Validation } from '../utils/validation';

export class AnalyzeYoutubeMixHandler {
  private youtubeService: YouTubeService;
  private llmService: LLMService;
  private notsliderService: NotSliderService;
  private soundcloudService: SoundCloudService;
  private youtubeDlService: YouTubeDlService;
  private scriptBuilder: ScriptBuilder;
  private rateLimiter: RateLimiter;

  constructor(private config: WorkerConfig) {
    this.youtubeService = new YouTubeService();
    this.llmService = new LLMService(config);
    this.notsliderService = new NotSliderService(config);
    this.soundcloudService = new SoundCloudService(config);
    this.youtubeDlService = new YouTubeDlService(config);
    this.scriptBuilder = new ScriptBuilder();
    this.rateLimiter = new RateLimiter();
  }

  async handle(args: AnalyzeYoutubeMixArgs): Promise<AnalyzeYoutubeMixResult> {
    const jobId = uuidv4().substring(0, 8);
    const logger = new Logger(jobId);
    const startTime = Date.now();

    logger.info('handler', 'Starting YouTube mix analysis', {
      url: args.url,
      skipLLMCleanup: args.skipLLMCleanup,
      maxTracks: args.maxTracks
    });

    try {
      // 1. Validate input
      const validatedUrl = Validation.validateYouTubeUrl(args.url);
      const validatedMaxTracks = Validation.validateMaxTracks(args.maxTracks);
      const validatedOutputPath = Validation.validateCustomOutputPath(args.customOutputPath);

      // 2. Fetch YouTube HTML
      logger.info('youtube', 'Fetching YouTube page');
      const html = await logger.time('youtube', () => this.youtubeService.fetchHtml(validatedUrl));

      // 3. Extract mix title
      const mixTitle = this.youtubeService.extractMixTitle(html);
      logger.info('youtube', 'Extracted mix title', { mixTitle });

      // 4. Extract tracks from chapters or description
      let rawTracks: RawTrack[] = [];
      const chapters = this.youtubeService.extractChapters(html);

      if (chapters && chapters.length > 0) {
        rawTracks = chapters;
        logger.info('youtube', 'Extracted tracks from chapters', { trackCount: chapters.length });
      } else {
        const description = this.youtubeService.extractDescription(html);
        rawTracks = this.youtubeService.parseDescriptionTracks(description);
        logger.info('youtube', 'Extracted tracks from description', { trackCount: rawTracks.length });
      }

      if (rawTracks.length === 0) {
        throw new ServiceError(
          ErrorCode.NO_TRACKS_FOUND,
          'No tracks found in YouTube video chapters or description',
          false
        );
      }

      // 5. Apply track limit if specified
      if (validatedMaxTracks && rawTracks.length > validatedMaxTracks) {
        rawTracks = rawTracks.slice(0, validatedMaxTracks);
        logger.info('handler', 'Limited tracks to maxTracks', { maxTracks: validatedMaxTracks });
      }

      // 6. Clean tracks using LLM (unless skipped)
      let cleanedTracks: CleanedTrack[] = [];
      if (!args.skipLLMCleanup) {
        logger.info('llm', 'Cleaning tracks with LLM');
        const rawText = rawTracks.map(t => t.rawText).join('\n');
        cleanedTracks = await logger.time('llm', () => this.llmService.parseTracklist(rawText));
        logger.info('llm', 'LLM track cleaning completed', {
          inputTracks: rawTracks.length,
          outputTracks: cleanedTracks.length
        });
      } else {
        // Convert raw tracks to cleaned tracks without LLM processing
        cleanedTracks = rawTracks.map(track => ({
          index: track.index,
          original: track.rawText,
          artist: track.rawText.split(' - ')[0] || 'Unknown Artist',
          title: track.rawText.split(' - ').slice(1).join(' - ') || 'Unknown Title',
          certainty: 0.3, // Low certainty for non-LLM processed tracks
          isValid: true
        }));
        logger.info('handler', 'Skipped LLM cleanup, using raw tracks');
      }

      // 7. Search for download URLs using waterfall approach
      logger.info('resolver', 'Starting track search with waterfall approach');
      const searchResults = await this.searchTracksWithWaterfall(cleanedTracks, logger);

      // 8. Generate download script
      logger.info('script', 'Generating download script');
      const downloadScript = this.scriptBuilder.build(searchResults, mixTitle);

      // 9. Calculate processing summary
      const processingTime = Date.now() - startTime;
      const summary = this.calculateSummary(searchResults, processingTime);

      // 10. Prepare response
      const result: AnalyzeYoutubeMixResult = {
        success: true,
        id: jobId,
        downloadScript,
        qualityReport: searchResults,
        summary,
        failedTracks: searchResults.filter(r => !r.found).map(r => `${r.track.artist} - ${r.track.title}`),
        warnings: this.generateWarnings(searchResults, args)
      };

      logger.info('handler', 'Analysis completed successfully', {
        processingTime,
        foundTracks: summary.foundTracks,
        totalTracks: summary.totalTracks
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      if (error instanceof ServiceError) {
        logger.error('handler', 'Analysis failed with service error', {
          error: error.message,
          code: error.code,
          processingTime
        });
        throw error;
      }

      logger.error('handler', 'Analysis failed with unexpected error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      });

      throw new ServiceError(
        ErrorCode.YOUTUBE_FETCH_FAILED,
        `Unexpected error during analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true
      );
    }
  }

  private async searchTracksWithWaterfall(tracks: CleanedTrack[], logger: Logger): Promise<TrackSearchResult[]> {
    const results: TrackSearchResult[] = [];
    const maxConcurrent = this.config.MAX_CONCURRENT_SEARCHES;

    // Process tracks in batches to respect concurrency limits
    for (let i = 0; i < tracks.length; i += maxConcurrent) {
      const batch = tracks.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(track => this.searchSingleTrack(track, logger));

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  private async searchSingleTrack(track: CleanedTrack, logger: Logger): Promise<TrackSearchResult> {
    const trackLogger = logger.child({ track: `${track.artist} - ${track.title}` });

    try {
      // 1. Try NotSlider first (primary source)
      await this.rateLimiter.throttle('notslider');
      trackLogger.info('resolver', 'Searching NotSlider');
      const notsliderResult = await this.notsliderService.search(track);

      if (notsliderResult.found) {
        trackLogger.info('resolver', 'Found track on NotSlider', {
          source: 'notslider',
          quality: notsliderResult.quality
        });
        return notsliderResult;
      }

      // 2. Try SoundCloud (secondary source)
      await this.rateLimiter.throttle('soundcloud');
      trackLogger.info('resolver', 'Searching SoundCloud');
      const soundcloudResult = await this.soundcloudService.search(track);

      if (soundcloudResult.found) {
        trackLogger.info('resolver', 'Found track on SoundCloud', {
          source: 'soundcloud',
          quality: soundcloudResult.quality
        });
        return soundcloudResult;
      }

      // 3. Try YouTube-dl (tertiary fallback)
      trackLogger.info('resolver', 'Searching YouTube-dl');
      const youtubeDlResult = await this.youtubeDlService.search(track);

      if (youtubeDlResult.found) {
        trackLogger.info('resolver', 'Found track via YouTube-dl', {
          source: 'youtube',
          quality: youtubeDlResult.quality
        });
        return youtubeDlResult;
      }

      // All sources failed
      trackLogger.warn('resolver', 'Track not found on any source', {
        notsliderError: notsliderResult.error,
        soundcloudError: soundcloudResult.error,
        youtubeDlError: youtubeDlResult.error
      });

      return {
        track,
        found: false,
        error: `Not found on any source. NotSlider: ${notsliderResult.error}, SoundCloud: ${soundcloudResult.error}, YouTube-dl: ${youtubeDlResult.error}`
      };

    } catch (error) {
      trackLogger.error('resolver', 'Track search failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        track,
        found: false,
        error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private calculateSummary(results: TrackSearchResult[], processingTime: number): ProcessingSummary {
    const found = results.filter(r => r.found);
    const failed = results.filter(r => !r.found);

    const sourcesUsed = {
      notslider: found.filter(r => r.source === 'notslider').length,
      soundcloud: found.filter(r => r.source === 'soundcloud').length,
      youtube: found.filter(r => r.source === 'youtube').length
    };

    // Calculate the most frequent quality (mode)
    const qualityCounts = found
      .map(r => r.quality)
      .filter(Boolean)
      .reduce((acc, quality) => {
        acc[quality!] = (acc[quality!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const averageQuality = Object.keys(qualityCounts).length > 0
      ? Object.entries(qualityCounts).reduce((a, b) => qualityCounts[a[0]] > qualityCounts[b[0]] ? a : b)[0]
      : 'unknown';

    // Estimate cost (very rough approximation)
    const estimatedCost = 0.0008; // Base cost per mix as specified in project description

    return {
      totalTracks: results.length,
      foundTracks: found.length,
      failedTracks: failed.length,
      processingTime,
      sourcesUsed,
      averageQuality: averageQuality as any,
      estimatedCost,
      modelUsed: 'gpt-4o-mini' // The model used for track parsing
    };
  }

  private generateWarnings(results: TrackSearchResult[], args: AnalyzeYoutubeMixArgs): string[] {
    const warnings: string[] = [];

    const foundCount = results.filter(r => r.found).length;
    const successRate = (foundCount / results.length) * 100;

    if (successRate < 50) {
      warnings.push(`Low success rate: ${successRate.toFixed(1)}% of tracks found`);
    }

    if (args.skipLLMCleanup) {
      warnings.push('LLM cleanup was skipped - track quality may be lower');
    }

    const notsliderCount = results.filter(r => r.source === 'notslider').length;
    if (notsliderCount === 0) {
      warnings.push('No tracks found on NotSlider - primary source unavailable');
    }

    return warnings;
  }
}