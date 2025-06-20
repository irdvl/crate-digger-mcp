import { ServiceError, ErrorCode } from '../types';

export class Validation {
  static validateYouTubeUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'URL is required and must be a string',
        false
      );
    }

    const trimmedUrl = url.trim();

    // Basic URL validation
    try {
      const urlObj = new URL(trimmedUrl);
      if (!urlObj.protocol.startsWith('http')) {
        throw new ServiceError(
          ErrorCode.INVALID_URL,
          'URL must use HTTP or HTTPS protocol',
          false
        );
      }
    } catch (error) {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'Invalid URL format',
        false
      );
    }

    // YouTube URL validation
    const youtubePatterns = [
      /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
      /^https?:\/\/youtu\.be\/[\w-]+/,
      /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/,
      /^https?:\/\/(www\.)?youtube\.com\/v\/[\w-]+/
    ];

    const isValidYouTubeUrl = youtubePatterns.some(pattern => pattern.test(trimmedUrl));

    if (!isValidYouTubeUrl) {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'URL must be a valid YouTube video URL',
        false
      );
    }

    return trimmedUrl;
  }

  static validateMaxTracks(maxTracks?: number): number | undefined {
    if (maxTracks === undefined || maxTracks === null) {
      return undefined;
    }

    if (typeof maxTracks !== 'number' || maxTracks <= 0) {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'maxTracks must be a positive number',
        false
      );
    }

    // Reasonable upper limit to prevent abuse
    if (maxTracks > 100) {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'maxTracks cannot exceed 100',
        false
      );
    }

    return Math.floor(maxTracks);
  }

  static validateCustomOutputPath(path?: string): string | undefined {
    if (!path) {
      return undefined;
    }

    if (typeof path !== 'string') {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'customOutputPath must be a string',
        false
      );
    }

    const trimmedPath = path.trim();

    // Basic path validation (no absolute paths, no parent directory traversal)
    if (trimmedPath.startsWith('/') || trimmedPath.includes('..')) {
      throw new ServiceError(
        ErrorCode.INVALID_URL,
        'customOutputPath cannot be absolute or contain parent directory traversal',
        false
      );
    }

    return trimmedPath;
  }

  static sanitizeString(input: string, maxLength: number = 1000): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .substring(0, maxLength)
      .replace(/[\x00-\x1f\x7f]/g, ''); // Remove control characters
  }
}