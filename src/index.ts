import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { loadWorkerConfig, WorkerConfig } from "./types";
import { AnalyzeYoutubeMixHandler } from "./handlers/analyzeYoutubeMix";
import { ExtractTracksOnlyHandler } from "./handlers/extractTracksOnly";
import { CleanTracksOnlyHandler } from "./handlers/cleanTracksOnly";
import { GenerateScriptOnlyHandler } from "./handlers/generateScriptOnly";

export class DJMixDownloaderMCP extends McpAgent {
	server = new McpServer({
		name: "DJ Mix Track Downloader",
		version: "1.0.0",
	});

	async init() {
		// Load configuration from environment
		const config = loadWorkerConfig(globalThis as any);

		// Main handler - complete pipeline from YouTube URL to download script
		this.server.tool("analyzeYoutubeMix", {
			url: z.string().describe("YouTube URL of the DJ mix video"),
			skipLLMCleanup: z.boolean().optional().describe("Skip LLM track name cleanup (default: false)"),
			customOutputPath: z.string().optional().describe("Custom output path for downloads (default: './downloads')"),
			maxTracks: z.number().optional().describe("Maximum number of tracks to process (default: unlimited)")
		}, async (args) => {
			const handler = new AnalyzeYoutubeMixHandler(config);
			const result = await handler.handle(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		});

		// Utility handler - extract tracks only
		this.server.tool("extractTracksOnly", {
			url: z.string().describe("YouTube URL of the DJ mix video"),
			includeTimestamps: z.boolean().optional().describe("Include timestamps in track data (default: false)")
		}, async (args) => {
			const handler = new ExtractTracksOnlyHandler(config);
			const result = await handler.handle(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		});

		// Utility handler - clean tracks only
		this.server.tool("cleanTracksOnly", {
			tracks: z.array(z.string()).describe("Array of raw track strings to clean"),
			provider: z.enum(["anthropic"]).optional().describe("LLM provider to use (default: 'anthropic')")
		}, async (args) => {
			const handler = new CleanTracksOnlyHandler(config);
			const result = await handler.handle(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		});

		// Utility handler - generate script only
		this.server.tool("generateScriptOnly", {
			searchResults: z.array(z.any()).describe("Array of track search results"),
			mixTitle: z.string().describe("Title of the DJ mix")
		}, async (args) => {
			const handler = new GenerateScriptOnlyHandler(config);
			const result = await handler.handle(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		});
	}
}

// Export the OAuth handler as the default
export default new OAuthProvider({
	apiRoute: "/sse",
	// TODO: fix these types
	// @ts-expect-error
	apiHandler: DJMixDownloaderMCP.mount("/sse"),
	// @ts-expect-error
	defaultHandler: app,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
