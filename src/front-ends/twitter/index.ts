/**
 * @fileoverview Front end for Twitter. Announces stuff via tweets.
 */

import { TwitterApiReadWrite } from "twitter-api-v2";

import { FrontEnd } from "../front-end.js";
import { Bot } from "../../bot.js";
import { botStatusToStringMap } from "../common/string-maps.js";
import { Database } from "../../db.js";
import { formatUTCTimeDownToSeconds } from "../../util/format-time.js";
import * as SPB from "../../starrpark.biz/change-detector.js";
import * as YT from "../../youtube/change-detector.js";

const conjunctionFormatter = new Intl.ListFormat("en", { type: "conjunction" });

export class TwitterFrontEnd implements FrontEnd {
	#db: Database;
	#bot: Bot;
	#client: TwitterApiReadWrite;
	#spbDetector: SPB.SPBChangeDetector | undefined;
	#youtubeDetector: YT.YoutubeChangeDetector | undefined;

	constructor({
		db,
		bot,
		client,
		spbDetector,
		youtubeDetector
	}: {
		db: Database;
		bot: Bot;
		client: TwitterApiReadWrite;
		spbDetector?: SPB.SPBChangeDetector | undefined;
		youtubeDetector?: YT.YoutubeChangeDetector | undefined;
	}) {
		this.#db = db;
		this.#bot = bot;
		this.#client = client;
		this.#spbDetector = spbDetector;
		this.#youtubeDetector = youtubeDetector;

		this.#spbDetector?.on("change", async (
			{ firstDetectionPath, firstDetectionChangeType, changesPromise }:
			{ firstDetectionPath: string; firstDetectionChangeType: SPB.PollerChangeType; changesPromise: Promise<SPB.Changes>; }
		) => {
			const changes = await changesPromise;
			this.#client.v1.tweet(`\
I’ve detected a change in the StarrPark.biz website! ${changes.added.length} URLs were added and ${changes.modified.length} were modified.`
			).catch(/* ignore error */);
		});

		this.#youtubeDetector?.on("change", (change: YT.Change) => {
			const thingsChanged = [];

			if (change.nameChanged) thingsChanged.push("name");
			if (change.descriptionChanged) thingsChanged.push("description");
			if (change.profilePictureChanged) thingsChanged.push("profile picture");
			if (change.bannerChanged) thingsChanged.push("banner");
			if (change.newVideos === null) thingsChanged.push("video list");

			this.#client.v1.tweet(`\
I’ve detected a change in ${change.record.displayName ?? change.record.name}! \
The ${conjunctionFormatter.format(thingsChanged)} ${thingsChanged.length === 1 ? "has" : "have"} changed.\
${change.newVideos !== null && change.newVideos > 0 ? `\nNew videos: ${change.newData.newestVideos.slice(0, change.newVideos).reverse().map(video => `https://youtu.be/${video.videoID}`).join(", ")}` : ""}`,
			).catch(/* ignore error */);
		});

		this.#bot.on("ready", () => {
			this.#updateStatus();
		});
		this.#bot.on("shutdown", (ev) => {
			ev.waitUntil(this.#updateStatus());
		});
	}

	async #updateStatus(): Promise<void> {
		await this.#client.v1.post("account/update_profile.json", {
			description: `\
I’m a bot that detects things related to #BrawlStars lore! | @Starrchive | she/it | Not affiliated with Supercell.

CURRENT STATUS: ${botStatusToStringMap.get(this.#bot.status)}`
		}).catch(() => {/* ignore error */});
	}

	async destroy(): Promise<void> {
		// Nothing to clean up.
	}
}
