/**
 * @fileoverview Fetches and parses data from YouTube.
 */

// Using WebSub to get updates in real-time only works for video uploads, so I'm forced to use
// polling and to parse internal YouTube data. Too bad.

import * as https from "https";
import { ChannelData, PartialVideoData } from "./types.js";

export class YTParsingError extends Error {
	innerError: Error;

	constructor(error: Error) {
		super("Couldn't parse the YouTube data.");
		this.innerError = error;
	}
}
YTParsingError.prototype.name = "YTParsingError";

const NONCE_REGEX = /(?<=<script nonce=").+(?=">)/;
const PLUS_REGEX = /\+/g;
const IMG_URL_OPTIONS_REGEX = /(?<==).*$/;

function getOriginalImageURL(url: string) {
	return url.replace(IMG_URL_OPTIONS_REGEX, "s9999");
}

// TODO: Using the /youtubei/v1/browse endpoint would save bandwidth.

export async function fetchChannelData(channelID: string): Promise<ChannelData> {
	const html: string = await new Promise((res, rej) => {
		let str = "";
		const req = https.request(`https://www.youtube.com/channel/${channelID}/videos`);
		req.on("response", (resp) => {
			resp.setEncoding("utf-8");
			resp.on("data", (chunk: string) => {
				str += chunk;
			});
			resp.on("end", () => {
				res(str);
			});
			resp.on("error", rej);
		});
		req.on("error", rej);
		req.end();
	});

	try {
		const nonce = html.match(NONCE_REGEX)?.[0];
		if (nonce === undefined) {
			throw new Error("Couldn't find the nonce.");
		}
		const json = html.match(`(?<=<script nonce="${nonce.replace(PLUS_REGEX, "\\+")}">var ytInitialData = )(?:[^"]|"(?:[^\\\\]|\\\\.)*?")+?(?=;)`)?.[0];
		if (json === undefined) {
			throw new Error("Couldn't find ytInitialData.");
		}
		const data = JSON.parse(json);

		const newestVideos: PartialVideoData[] = [];

		for (const item of data.contents.twoColumnBrowseResultsRenderer.tabs[1].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].gridRenderer?.items ?? []) {
			if ("gridVideoRenderer" in item) {
				newestVideos.push({
					videoID: item.gridVideoRenderer.videoId,
					title: item.gridVideoRenderer.title.runs[0].text,
				});
			}
		}

		return {
			channelID,
			name: data.metadata.channelMetadataRenderer.title,
			description: data.metadata.channelMetadataRenderer.description,
			profilePictureURL: getOriginalImageURL(data.metadata.channelMetadataRenderer.avatar.thumbnails[0].url),
			bannerURL: "banner" in data.header.c4TabbedHeaderRenderer ? getOriginalImageURL(data.header.c4TabbedHeaderRenderer.banner.thumbnails[0].url) : null,
			newestVideos
		};
	} catch(err) {
		throw new YTParsingError(err as Error);
	}
}
