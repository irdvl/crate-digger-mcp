// Core data models for DJ Mix Track Downloader

// Track representation through the pipeline
export interface RawTrack {
  index: number;
  timestamp?: string;      // "1:23:45" format
  rawText: string;        // Original text from YouTube
}

export interface CleanedTrack {
  index: number;
  original: string;
  artist: string;
  title: string;
  remixInfo?: string;     // "(Remix Artist Remix)"
  certainty: number;      // 0.0-1.0 from LLM
  isValid: boolean;
}

export interface TrackSearchResult {
  track: CleanedTrack;
  found: boolean;
  source?: 'notslider' | 'soundcloud' | 'youtube';
  downloadUrl?: string;
  quality?: '320kbps' | '256kbps' | '192kbps' | '128kbps' | 'unknown';  // More specific quality values
  format?: 'mp3' | 'm4a' | 'opus';
  duration?: number;      // seconds
  fileSize?: number;      // bytes
  error?: string;
}

// Response types
export interface ProcessingSummary {
  totalTracks: number;
  foundTracks: number;
  failedTracks: number;
  processingTime: number;
  sourcesUsed: {
    notslider: number;
    soundcloud: number;
    youtube: number;
  };
  averageQuality: '320kbps' | '256kbps' | '192kbps' | '128kbps' | 'unknown';  // More specific quality values
  estimatedCost: number;  // in USD
  modelUsed: string;      // Which LLM model was used
}

export interface DownloadScript {
  scriptContent: string;  // Base64 encoded
  fileName: string;
  mixTitle: string;
  timestamp: string;      // ISO 8601 format
  trackCount: number;
}

// Configuration
export interface WorkerConfig {
  // Environment variables
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;        // Default: "claude-3-5-haiku"
  SOUNDCLOUD_CLIENT_ID?: string;   // Optional, with fallbacks

  // Operational limits
  MAX_CONCURRENT_SEARCHES: number;  // Default: 3
  RATE_LIMIT_DELAY_MS: number;     // Default: 1000
  REQUEST_TIMEOUT_MS: number;       // Default: 25000

  // Quality preferences
  PREFERRED_QUALITY: '320kbps' | '256kbps' | 'highest';
  PREFERRED_FORMAT: 'mp3' | 'm4a' | 'any';

  // Service URLs
  NOTSLIDER_BASE_URL: string;      // Default: "https://notslider.nl"
  YOUTUBE_DL_API_URL?: string;     // External service endpoint
}

// MCP Handler arguments and results
export interface AnalyzeYoutubeMixArgs {
  url: string;                    // YouTube URL (required)
  skipLLMCleanup?: boolean;      // Default: false
  customOutputPath?: string;     // Default: "./downloads"
  maxTracks?: number;            // Limit processing (default: unlimited)
}

export interface AnalyzeYoutubeMixResult {
  success: boolean;
  id: string;                    // Unique job ID
  downloadScript: DownloadScript;
  qualityReport: TrackSearchResult[];
  summary: ProcessingSummary;
  failedTracks: string[];
  warnings: string[];
}

export interface ExtractTracksOnlyArgs {
  url: string;
  includeTimestamps?: boolean;
}

export interface ExtractTracksOnlyResult {
  mixTitle: string;
  trackCount: number;
  tracks: RawTrack[];
}

export interface CleanTracksOnlyArgs {
  tracks: string[];
  provider?: 'anthropic';
  model?: string;
}

export interface CleanTracksOnlyResult {
  cleaned: CleanedTrack[];
  cost: number;
}

export interface GenerateScriptOnlyArgs {
  searchResults: TrackSearchResult[];
  mixTitle: string;
}

export interface GenerateScriptOnlyResult {
  script: DownloadScript;
}

// Error handling
export enum ErrorCode {
  INVALID_URL = 'INVALID_URL',
  YOUTUBE_FETCH_FAILED = 'YOUTUBE_FETCH_FAILED',
  NO_TRACKS_FOUND = 'NO_TRACKS_FOUND',
  LLM_PARSE_FAILED = 'LLM_PARSE_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT'
}

export class ServiceError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

// Logging
export interface LogEntry {
  ts: string;           // ISO 8601
  level: 'info' | 'warn' | 'error';
  stage: string;        // Component name
  jobId: string;       // Request correlation ID
  message: string;
  duration?: number;    // Milliseconds
  // Common additional context fields for better type checking
  url?: string;
  track?: string;
  source?: 'notslider' | 'soundcloud' | 'youtube';
  found?: boolean;
  error?: string;
  [key: string]: any;  // Additional context for flexibility
}

// Configuration loader
export function loadWorkerConfig(env: any): WorkerConfig {
  return {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'claude-3-5-haiku',
    SOUNDCLOUD_CLIENT_ID: env.SOUNDCLOUD_CLIENT_ID,
    MAX_CONCURRENT_SEARCHES: parseInt(env.MAX_CONCURRENT_SEARCHES || '3'),
    RATE_LIMIT_DELAY_MS: parseInt(env.RATE_LIMIT_DELAY_MS || '1000'),
    REQUEST_TIMEOUT_MS: parseInt(env.REQUEST_TIMEOUT_MS || '25000'),
    PREFERRED_QUALITY: (env.PREFERRED_QUALITY as '320kbps' | '256kbps' | 'highest') || '320kbps',
    PREFERRED_FORMAT: (env.PREFERRED_FORMAT as 'mp3' | 'm4a' | 'any') || 'mp3',
    NOTSLIDER_BASE_URL: env.NOTSLIDER_BASE_URL || 'https://notslider.nl',
    YOUTUBE_DL_API_URL: env.YOUTUBE_DL_API_URL,
  };
}