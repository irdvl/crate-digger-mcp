# DJ Mix Track Downloader MCP Server - Unified Design Document

## Executive Summary

The DJ Mix Track Downloader is a Model Context Protocol (MCP) server deployed as a Cloudflare Worker that analyzes YouTube DJ mix videos, extracts track lists from descriptions/chapters, cleans track names using Claude 3.5 Haiku (configurable), searches for high-quality download URLs using a waterfall approach (NotSlider → SoundCloud → YouTube-dl fallback), and generates executable shell scripts for downloading tracks. The service prioritizes 320kbps MP3 files, operates within Cloudflare's constraints (10MB bundle, 128MB RAM, 5-minute CPU limit), and costs approximately $0.0024 per mix processed.

## 1. PROJECT OVERVIEW

### 1.1 Purpose
Create an MCP server for educational/personal use that automates the process of:
- Extracting track lists from YouTube DJ mixes
- Finding high-quality (320kbps) download sources
- Generating download scripts with quality reporting

### 1.2 Core Workflow
```
YouTube URL → Extract Tracks → LLM Cleanup → Multi-Platform Search → Download Script + Report
```

### 1.3 Key Constraints
- **Runtime**: Cloudflare Workers (no binary execution, no ffmpeg/yt-dlp)
- **Memory**: 128MB per isolate (hard limit)
- **CPU Time**: 5 minutes maximum per request
- **Bundle Size**: ≤10MB compressed (paid plan)
- **Cost Target**: <$25/month (~30 mixes/day)

## 2. TECHNOLOGY STACK

### 2.1 Core Technologies
| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Cloudflare Workers | Edge deployment, no server ops |
| Language | TypeScript 5.x | Type safety, native Worker support |
| Framework | MCP SDK TypeScript v1.0.0+ | Standardized protocol |
| LLM | Anthropic Claude 3.5 Haiku (configurable) | Cost-effective ($0.80/1M in, $4.00/1M out) |
| Primary Source | NotSlider.nl | Guaranteed 320kbps MP3s |
| Package Manager | npm + Wrangler 3.x | Cloudflare standard tooling |
| Testing | Vitest + MSW | Worker-compatible testing |

### 2.2 Dependencies
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk-typescript": "^1.0.0",
    "node-fetch": "^3.3.2",
    "cheerio": "^1.0.0-rc.12",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "wrangler": "^3.0.0",
    "vitest": "^2.0.0",
    "msw": "^2.0.0"
  }
}
```

### 2.3 Platform Integrations
1. **YouTube** - Track extraction via HTML scraping
2. **NotSlider.nl** - Primary 320kbps MP3 source
3. **SoundCloud API v2** - Secondary source (optional)
4. **YouTube-dl API** - Tertiary fallback (external service)
5. **Anthropic API** - Track name cleanup (configurable model)

## 3. SYSTEM ARCHITECTURE

### 3.1 Repository Structure
```
dj-mix-downloader-mcp/
├── wrangler.toml
├── .dev.vars.example        # ANTHROPIC_API_KEY, SOUNDCLOUD_CLIENT_ID
├── src/
│   ├── index.ts            # MCP server entry point
│   ├── handlers/
│   │   ├── analyzeYoutubeMix.ts
│   │   ├── extractTracksOnly.ts
│   │   ├── cleanTracksOnly.ts
│   │   └── generateScriptOnly.ts
│   ├── services/
│   │   ├── youtube/
│   │   │   ├── fetchHtml.ts
│   │   │   ├── extractChapters.ts
│   │   │   └── extractDescription.ts
│   │   ├── llm/
│   │   │   └── parseTracklist.ts
│   │   ├── resolver/
│   │   │   ├── notslider.ts
│   │   │   ├── soundcloud.ts
│   │   │   └── youtubeDl.ts
│   │   └── script/
│   │       └── buildScript.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── logger.ts
│       ├── rateLimiter.ts
│       └── validation.ts
└── test/
    └── *.spec.ts
```

### 3.2 Data Flow Diagram
```
1. MCP Request (analyzeYoutubeMix)
   │
   ├─▶ 2. YouTube HTML Fetch (25s timeout)
   │      └─▶ Extract chapters (JSON-LD) or description
   │
   ├─▶ 3. LLM Track Parsing (Claude 3.5 Haiku)
   │      └─▶ Structured JSON: [{artist, title, certainty}]
   │
   ├─▶ 4. Multi-Platform Search (concurrent, rate-limited)
   │      ├─▶ NotSlider (320kbps MP3)
   │      ├─▶ SoundCloud (if NotSlider fails)
   │      └─▶ YouTube-dl API (last resort)
   │
   ├─▶ 5. Download Script Generation
   │      └─▶ Bash script with wget/curl commands
   │
   └─▶ 6. Response with script + quality report
```

## 4. DATA MODELS

### 4.1 Core Types
```typescript
// Track representation through the pipeline
interface RawTrack {
  index: number;
  timestamp?: string;      // "1:23:45" format
  rawText: string;        // Original text from YouTube
}

interface CleanedTrack {
  index: number;
  original: string;
  artist: string;
  title: string;
  remixInfo?: string;     // "(Remix Artist Remix)"
  certainty: number;      // 0.0-1.0 from LLM
  isValid: boolean;
}

interface TrackSearchResult {
  track: CleanedTrack;
  found: boolean;
  source?: 'notslider' | 'soundcloud' | 'youtube';
  downloadUrl?: string;
  quality?: string;       // "320kbps", "256kbps", etc.
  format?: 'mp3' | 'm4a' | 'opus';
  duration?: number;      // seconds
  fileSize?: number;      // bytes
  error?: string;
}

// Response types
interface ProcessingSummary {
  totalTracks: number;
  foundTracks: number;
  failedTracks: number;
  processingTime: number;
  sourcesUsed: {
    notslider: number;
    soundcloud: number;
    youtube: number;
  };
  averageQuality: string;
  estimatedCost: number;  // in USD
  modelUsed: string;
}

interface DownloadScript {
  scriptContent: string;  // Base64 encoded
  fileName: string;
  mixTitle: string;
  timestamp: string;
  trackCount: number;
}
```

### 4.2 Configuration
```typescript
interface WorkerConfig {
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
```

## 5. MCP HANDLERS

### 5.1 Primary Handler
```typescript
// Handler: analyzeYoutubeMix
// Description: Complete pipeline from YouTube URL to download script

interface AnalyzeYoutubeMixArgs {
  url: string;                    // YouTube URL (required)
  skipLLMCleanup?: boolean;      // Default: false
  customOutputPath?: string;     // Default: "./downloads"
  maxTracks?: number;            // Limit processing (default: unlimited)
}

interface AnalyzeYoutubeMixResult {
  success: boolean;
  id: string;                    // Unique job ID
  downloadScript: DownloadScript;
  qualityReport: QualityReport[];
  summary: ProcessingSummary;
  failedTracks: string[];
  warnings: string[];
}
```

### 5.2 Utility Handlers
```typescript
// Extract tracks without processing
interface ExtractTracksOnly {
  args: { url: string; includeTimestamps?: boolean };
  result: {
    mixTitle: string;
    trackCount: number;
    tracks: RawTrack[];
  };
}

// Clean tracks via LLM
interface CleanTracksOnly {
  args: { tracks: string[]; provider?: 'openai' };
  result: { cleaned: CleanedTrack[]; cost: number };
}

// Generate script from results
interface GenerateScriptOnly {
  args: {
    searchResults: TrackSearchResult[];
    mixTitle: string;
  };
  result: { script: DownloadScript };
}
```

## 6. SERVICE IMPLEMENTATIONS

### 6.1 YouTube Extraction Service
```typescript
class YouTubeService {
  private readonly timeout = 25000;

  async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cf: { cacheTtl: 300 } // 5-minute edge cache
      });
      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  extractChapters(html: string): RawTrack[] | null {
    // Extract JSON-LD VideoObject.hasPart
    const jsonLdMatch = html.match(
      /<script[^>]+type="application\/ld\+json"[^>]*>([^<]+)<\/script>/
    );

    if (jsonLdMatch) {
      const data = JSON.parse(jsonLdMatch[1]);
      // Parse hasPart array for Clip objects
      return this.parseChapters(data);
    }
    return null;
  }

  extractDescription(html: string): string {
    // Fallback to raw description
    const match = html.match(/"shortDescription":"(.*?)"/);
    return match ? this.unescapeDescription(match[1]) : '';
  }
}
```

### 6.2 LLM Track Parser
```typescript
class LLMService {
  private readonly prompt = `
You are given raw text from a DJ mix. Extract an ordered JSON array of tracks.
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

Output ONLY valid JSON array, no other text.`;

  async parseTracklist(rawText: string): Promise<CleanedTrack[]> {
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
  }
}
```

### 6.3 NotSlider Resolver
```typescript
class NotSliderService {
  private readonly baseUrl = 'https://notslider.nl';
  private readonly retryAttempts = 2;

  async search(track: CleanedTrack): Promise<TrackSearchResult> {
    const query = `${track.artist} - ${track.title}`;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        // Search for track
        const searchUrl = `${this.baseUrl}?q=${encodeURIComponent(query)}`;
        const html = await fetch(searchUrl).then(r => r.text());

        // Extract first 320kbps MP3 link
        const linkMatch = html.match(
          /<a[^>]+href="([^"]+\.mp3)"[^>]*>.*?320\s*kbps/i
        );

        if (linkMatch) {
          const downloadUrl = await this.followRedirect(linkMatch[1]);

          return {
            track,
            found: true,
            source: 'notslider',
            downloadUrl,
            quality: '320kbps',
            format: 'mp3'
          };
        }
      } catch (error) {
        if (attempt === this.retryAttempts - 1) throw error;
        await this.delay(1000 * Math.pow(2, attempt)); // Exponential backoff
      }
    }

    return { track, found: false, error: 'No 320kbps MP3 found' };
  }
}
```

### 6.4 Download Script Builder
```typescript
class ScriptBuilder {
  build(results: TrackSearchResult[], mixTitle: string): string {
    const sanitizedTitle = this.sanitizeFilename(mixTitle);
    const timestamp = new Date().toISOString();

    const lines = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      `# DJ Mix: ${mixTitle}`,
      `# Generated: ${timestamp}`,
      `# Tracks: ${results.filter(r => r.found).length}/${results.length}`,
      '',
      `mkdir -p "${sanitizedTitle}"`,
      `cd "${sanitizedTitle}"`,
      '',
      '# Download options',
      'WGET_OPTS="--continue --quiet --show-progress"',
      ''
    ];

    results.forEach((result, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const filename = this.sanitizeFilename(
        `${num}-${result.track.artist}-${result.track.title}.${result.format || 'mp3'}`
      );

      if (result.found && result.downloadUrl) {
        lines.push(`# Track ${num}: ${result.track.artist} - ${result.track.title}`);
        lines.push(`wget $WGET_OPTS -O "${filename}" "${result.downloadUrl}"`);
      } else {
        lines.push(`# Track ${num}: NOT FOUND`);
        lines.push(`echo "SKIPPED: ${result.track.artist} - ${result.track.title}" >&2`);
      }
      lines.push('');
    });

    lines.push('echo "Download complete!"');
    lines.push(`echo "Downloaded: $(ls -1 *.mp3 2>/dev/null | wc -l) tracks"`);

    return lines.join('\n');
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .substring(0, 100); // Filesystem limit
  }
}
```

## 7. OPERATIONAL SPECIFICATIONS

### 7.1 Performance Limits
| Parameter | Limit | Notes |
|-----------|-------|-------|
| Request timeout | 25s | Worker default is 30s |
| CPU time | 5 min | Via `limits.cpu_ms = 300000` |
| Memory | 128 MB | Per isolate, non-configurable |
| Bundle size | 10 MB | Compressed, paid plan |
| Concurrent requests | ~8/s | Per isolate capacity |

### 7.2 Rate Limiting
```typescript
class RateLimiter {
  private readonly limits = {
    notslider: { rpm: 60, delayMs: 1000 },
    soundcloud: { rpm: 100, delayMs: 600 },
    openai: { rpm: 60, delayMs: 1000 }
  };

  private lastRequest = new Map<string, number>();

  async throttle(service: string): Promise<void> {
    const config = this.limits[service];
    const last = this.lastRequest.get(service) || 0;
    const elapsed = Date.now() - last;

    if (elapsed < config.delayMs) {
      await new Promise(r => setTimeout(r, config.delayMs - elapsed));
    }

    this.lastRequest.set(service, Date.now());
  }
}
```

### 7.3 Error Handling
```typescript
enum ErrorCode {
  INVALID_URL = 'INVALID_URL',
  YOUTUBE_FETCH_FAILED = 'YOUTUBE_FETCH_FAILED',
  NO_TRACKS_FOUND = 'NO_TRACKS_FOUND',
  LLM_PARSE_FAILED = 'LLM_PARSE_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT'
}

class ServiceError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
  }
}
```

### 7.4 Logging
```typescript
interface LogEntry {
  ts: string;           // ISO 8601
  level: 'info' | 'warn' | 'error';
  stage: string;        // Component name
  jobId: string;       // Request correlation ID
  message: string;
  duration?: number;    // Milliseconds
  [key: string]: any;  // Additional context
}

// Example log output
{
  "ts": "2025-06-19T21:30:12.123Z",
  "level": "info",
  "stage": "resolver",
  "jobId": "xz8k9",
  "message": "Track search completed",
  "track": "Artist - Title",
  "found": true,
  "source": "notslider",
  "duration": 207
}
```

## 8. DEPLOYMENT

### 8.1 Wrangler Configuration
```toml
name = "dj-mix-downloader-mcp"
main = "src/index.ts"
compatibility_date = "2025-06-19"
node_compat = true

[limits]
cpu_ms = 300000  # 5 minutes

[env.production]
vars = { ENVIRONMENT = "production" }

[[env.production.secrets]]
name = "ANTHROPIC_API_KEY"

[build]
command = "npm run build"

[dev]
port = 8787
local_protocol = "http"
```

### 8.2 Environment Variables
```bash
# .dev.vars
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-haiku  # Optional, defaults to Claude 3.5 Haiku
SOUNDCLOUD_CLIENT_ID=optional-client-id
NOTSLIDER_BASE_URL=https://notslider.nl
MAX_CONCURRENT_SEARCHES=3
PREFERRED_QUALITY=320kbps
```

### 8.3 Deployment Steps
1. **Install dependencies**: `npm install`
2. **Configure environment**: Copy `.dev.vars.example` to `.dev.vars`
3. **Local development**: `wrangler dev --env-file .dev.vars`
4. **Run tests**: `npm test`
5. **Verify bundle size**: `wrangler deploy --dry-run`
6. **Deploy to production**: `wrangler deploy --env production`
7. **Set secrets**: `wrangler secret put ANTHROPIC_API_KEY --env production`

### 8.4 Cost Analysis
| Component | Unit Cost | Usage/Day | Daily Cost |
|-----------|-----------|-----------|------------|
| Claude 3.5 Haiku | $0.0024/mix | 30 mixes | $0.072 |
| Workers CPU | $0.00001/ms | 90s × 30 | $0.027 |
| Workers Requests | Free tier | <100k/day | $0.00 |
| **Total** | | | **~$0.99/month** |

**Cost Breakdown per Mix:**
- Input tokens: ~1,000 × $0.80/1M = $0.0008
- Output tokens: ~500 × $4.00/1M = $0.002
- **Total per mix: ~$0.0028**

**Model Options (2025 Pricing):**
- **Claude 3.5 Haiku** (default): $0.0028/mix - Fast, cost-effective
- **Claude Sonnet 4**: $0.0045/mix - Better accuracy, moderate cost
- **Claude Opus 4**: $0.0225/mix - Highest accuracy, premium cost

## 9. TESTING STRATEGY

### 9.1 Unit Tests
```typescript
// test/youtube.spec.ts
describe('YouTubeService', () => {
  it('extracts chapters from JSON-LD', async () => {
    const mockHtml = readFixture('youtube-chapters.html');
    const tracks = service.extractChapters(mockHtml);
    expect(tracks).toHaveLength(15);
    expect(tracks[0]).toMatchObject({
      index: 1,
      timestamp: '0:00',
      rawText: 'Artist - Track Name'
    });
  });
});
```

### 9.2 Integration Tests
```typescript
// test/e2e.spec.ts
describe('Full Pipeline', () => {
  it('processes known mix successfully', async () => {
    const result = await handler.analyzeYoutubeMix({
      url: 'https://youtube.com/watch?v=dQw4w9WgXcQ'
    });

    expect(result.success).toBe(true);
    expect(result.summary.foundTracks).toBeGreaterThan(10);
    expect(result.downloadScript.scriptContent).toContain('#!/bin/bash');
  });
});
```

### 9.3 Load Testing
```bash
# Using autocannon for load testing
autocannon -c 10 -d 30 -m POST \
  -H "Content-Type: application/json" \
  -b '{"url":"https://youtube.com/watch?v=test"}' \
  http://localhost:8787/mcp
```

## 10. SECURITY & PRIVACY

### 10.1 Security Measures
- No user authentication (single-user design)
- Input validation on all URLs
- Sanitized filenames in scripts
- No PII storage
- HTTPS-only external requests

### 10.2 API Key Management
- OpenAI key stored as Cloudflare secret
- SoundCloud client ID with public fallbacks
- No keys in code or logs

## 11. MONITORING & OBSERVABILITY

### 11.1 Metrics to Track
- Success rate by source (NotSlider/SoundCloud/YouTube)
- Average processing time per mix
- LLM token usage and costs
- Error rates by type
- Bundle size trends

### 11.2 Alerting Thresholds
- Success rate < 80%
- Processing time > 20s average
- Daily cost > $1
- Error rate > 5%

## 12. FUTURE ENHANCEMENTS

### 12.1 Documented but Disabled
```typescript
// Placeholder for future binary service integration
async function resolveViaYtDlp(track: CleanedTrack): Promise<TrackSearchResult> {
  // TODO: Implement when external yt-dlp service available
  throw new Error('yt-dlp service not yet implemented');
}

// Caching layer (currently disabled)
async function getCached(key: string): Promise<any> {
  // TODO: Enable when KV namespace configured
  return null;
}
```

### 12.2 Potential Improvements
1. **Batch processing**: Multiple mixes in one request
2. **Webhook notifications**: Async processing with callbacks
3. **Format conversion**: External service for MP3 conversion
4. **Metadata enrichment**: MusicBrainz integration
5. **Duplicate detection**: Fuzzy matching for similar tracks

## 13. APPENDICES

### A. Example MCP Request/Response
```json
// Request
{
  "method": "analyzeYoutubeMix",
  "params": {
    "url": "https://youtube.com/watch?v=abc123"
  }
}

// Response
{
  "success": true,
  "id": "job-12345",
  "downloadScript": {
    "scriptContent": "IyEvYmluL2Jhc2g=...", // Base64
    "fileName": "download-epic-mix-2025.sh",
    "mixTitle": "Epic Mix 2025",
    "timestamp": "2025-06-19T21:30:00Z",
    "trackCount": 25
  },
  "qualityReport": [
    {
      "track": "Artist - Song Title",
      "source": "notslider",
      "quality": "320kbps",
      "format": "mp3",
      "status": "success"
    }
  ],
  "summary": {
    "totalTracks": 30,
    "foundTracks": 25,
    "failedTracks": 5,
    "processingTime": 15000,
    "sourcesUsed": {
      "notslider": 20,
      "soundcloud": 5,
      "youtube": 0
    },
    "averageQuality": "320kbps",
    "estimatedCost": 0.0028,
    "modelUsed": "claude-3-5-haiku"
  }
}
```

### B. Common Error Responses
```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "Not a valid YouTube URL",
    "retryable": false
  }
}
```

### C. References
1. [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
2. [MCP Protocol Specification](https://github.com/modelcontextprotocol/spec)
3. [Anthropic API Pricing](https://docs.anthropic.com/en/docs/pricing)
4. [YouTube Data API](https://developers.google.com/youtube/v3)
5. [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)

## 14. API KEYS & CONFIGURATION SUMMARY

### Required API Keys

#### 1. **Anthropic API Key** (Required)
- **Purpose**: Track name cleanup and parsing using configurable Claude models
- **Cost**: ~$0.0028 per mix processed (Claude 3.5 Haiku)
- **Setup**:
  - Get from [Anthropic Console](https://console.anthropic.com/)
  - Set as Cloudflare secret: `wrangler secret put ANTHROPIC_API_KEY --env production`
  - For local development: Add to `.dev.vars` file

#### 2. **SoundCloud Client ID** (Optional)
- **Purpose**: Secondary source for track downloads when NotSlider fails
- **Setup**:
  - Register app at [SoundCloud for Developers](https://developers.soundcloud.com/)
  - Get Client ID from your app settings
  - Add to `.dev.vars` as `SOUNDCLOUD_CLIENT_ID=your-client-id`
  - Can use public fallback client IDs if not provided

### Environment Configuration

Create a `.dev.vars` file for local development:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key-here

# Optional - Model Selection
ANTHROPIC_MODEL=claude-3-5-haiku  # Default: Claude 3.5 Haiku (most cost-effective)
# Alternative models:
# ANTHROPIC_MODEL=claude-sonnet-4  # Better accuracy, moderate cost
# ANTHROPIC_MODEL=claude-opus-4    # Highest accuracy, premium cost

# Optional - SoundCloud Integration
SOUNDCLOUD_CLIENT_ID=your-soundcloud-client-id

# Operational settings (with defaults)
MAX_CONCURRENT_SEARCHES=3
RATE_LIMIT_DELAY_MS=1000
REQUEST_TIMEOUT_MS=25000
PREFERRED_QUALITY=320kbps
PREFERRED_FORMAT=mp3
NOTSLIDER_BASE_URL=https://notslider.nl
```

### Model Cost Comparison (2025 Pricing)

| Model | Input Cost | Output Cost | Cost per Mix | Use Case |
|-------|------------|-------------|--------------|----------|
| **Claude 3.5 Haiku** | $0.80/1M | $4.00/1M | $0.0028 | **Default: Fast, cost-effective** |
| Claude Sonnet 4 | $3.00/1M | $15.00/1M | $0.0045 | Better accuracy, moderate cost |
| Claude Opus 4 | $15.00/1M | $75.00/1M | $0.0225 | Highest accuracy, premium cost |

### Setup Steps

1. **Get Anthropic API Key**:
   - Sign up at [Anthropic Console](https://console.anthropic.com/)
   - Create API key in dashboard
   - Add billing info (required for API usage)

2. **Optional SoundCloud Setup**:
   - Go to [SoundCloud for Developers](https://developers.soundcloud.com/)
   - Register new application
   - Copy Client ID from app settings

3. **Local Development**:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your API keys
   npm install
   wrangler dev --env-file .dev.vars
   ```

4. **Production Deployment**:
   ```bash
   wrangler secret put ANTHROPIC_API_KEY --env production
   wrangler deploy --env production
   ```

### Monthly Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Claude 3.5 Haiku | ~$0.99 | 30 mixes/day at $0.0028 each |
| Cloudflare Workers | ~$0.00 | Free tier covers usage |
| **Total** | **~$0.99/month** | Very cost-effective |

The project is designed to work with just the Anthropic API key as the minimum requirement, with SoundCloud integration as an optional enhancement for better track coverage. The default Claude 3.5 Haiku model provides the best balance of cost and performance for this use case.
