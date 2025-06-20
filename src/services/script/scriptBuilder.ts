import { TrackSearchResult, DownloadScript } from '../../types';

export class ScriptBuilder {
  build(results: TrackSearchResult[], mixTitle: string): DownloadScript {
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
        lines.push(`# Source: ${result.source} | Quality: ${result.quality || 'unknown'}`);
        lines.push(`wget $WGET_OPTS -O "${filename}" "${result.downloadUrl}"`);
      } else {
        lines.push(`# Track ${num}: NOT FOUND`);
        lines.push(`# ${result.track.artist} - ${result.track.title}`);
        lines.push(`echo "SKIPPED: ${result.track.artist} - ${result.track.title}" >&2`);
        if (result.error) {
          lines.push(`echo "  Error: ${result.error}" >&2`);
        }
      }
      lines.push('');
    });

    lines.push('echo "Download complete!"');
    lines.push(`echo "Downloaded: $(ls -1 *.mp3 2>/dev/null | wc -l) tracks"`);
    lines.push(`echo "Failed: $(echo "SKIPPED:" | grep -c "SKIPPED:" || echo "0") tracks"`);

    const scriptContent = lines.join('\n');
    const fileName = `download-${sanitizedTitle}-${new Date().toISOString().split('T')[0]}.sh`;

    return {
      scriptContent: btoa(scriptContent), // Base64 encode
      fileName,
      mixTitle,
      timestamp,
      trackCount: results.length
    };
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^\w\s-]/g, '') // Remove special characters except spaces, hyphens, and underscores
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/-+/g, '-')      // Replace multiple hyphens with single hyphen
      .toLowerCase()
      .trim()
      .substring(0, 100);       // Filesystem limit
  }

  // Generate a summary report
  generateSummary(results: TrackSearchResult[]): string {
    const found = results.filter(r => r.found);
    const failed = results.filter(r => !r.found);

    const sources = found.reduce((acc, result) => {
      if (result.source) {
        acc[result.source] = (acc[result.source] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const qualities = found.reduce((acc, result) => {
      if (result.quality) {
        acc[result.quality] = (acc[result.quality] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const lines = [
      '# Download Summary',
      `# Total Tracks: ${results.length}`,
      `# Found: ${found.length}`,
      `# Failed: ${failed.length}`,
      `# Success Rate: ${((found.length / results.length) * 100).toFixed(1)}%`,
      '',
      '# Sources Used:',
      ...Object.entries(sources).map(([source, count]) => `#   ${source}: ${count}`),
      '',
      '# Quality Distribution:',
      ...Object.entries(qualities).map(([quality, count]) => `#   ${quality}: ${count}`),
      '',
      '# Failed Tracks:',
      ...failed.map(result => `#   ${result.track.artist} - ${result.track.title} (${result.error || 'Unknown error'})`)
    ];

    return lines.join('\n');
  }
}