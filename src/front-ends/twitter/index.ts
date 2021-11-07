/**
 * @fileoverview Front end for Twitter. Announces stuff via tweets.
 */

import { TwitterApiReadWrite } from "twitter-api-v2";

import { FrontEnd } from "../front-end.js";
import { Bot } from "../../bot.js";
import { botStatusToStringMap } from "../common/string-maps.js";
import { Database } from "../../db.js";
import { SoundDetector } from "../../sound-detector/index.js";
import * as AI from "../../sound-detector/ai.js";
import { formatUTCTimeDownToSeconds } from "../../util/format-time.js";
import { Changes, SPBChangeDetector, PollerChangeType } from "../../starrpark.biz/change-detector.js";

export class TwitterFrontEnd implements FrontEnd {
	#db: Database;
	#bot: Bot;
	#client: TwitterApiReadWrite;
	#sd: SoundDetector | undefined;
	#spbDetector: SPBChangeDetector | undefined;

	constructor({
		db,
		bot,
		client,
		soundDetector,
		spbDetector
	}: {
		db: Database;
		bot: Bot;
		client: TwitterApiReadWrite;
		soundDetector?: SoundDetector | undefined;
		spbDetector?: SPBChangeDetector | undefined;
	}) {
		this.#db = db;
		this.#bot = bot;
		this.#client = client;
		this.#sd = soundDetector;
		this.#spbDetector = spbDetector;

		this.#sd?.on("detection", ({ detection, date }: { detection: AI.Class; date: Date; }) => {
			if (detection !== AI.Class.THIS_IS_NORMAL) {
				this.#client.v1.tweet(
					`I’ve detected ${detection === AI.Class.SILENCE ? "silence" : "something"} in the #WKBRL livestream at ${formatUTCTimeDownToSeconds(date)} UTC!\nCheck it out: https://wkbrl.netlify.app/redir?t=${Math.floor(date.getTime() / 1000 - 5)}`
				).catch(() => {/* ignore error */});
			}
		});
		this.#spbDetector?.on("change", async (
			{ firstDetectionPath, firstDetectionChangeType, changesPromise }:
			{ firstDetectionPath: string; firstDetectionChangeType: PollerChangeType; changesPromise: Promise<Changes>; }
		) => {
			const changes = await changesPromise;
			this.#client.v1.tweet(
				`I’ve detected a change in the StarrPark.biz website! ${changes.added.length} URLs were added and ${changes.modified.length} were modified.`,
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
I’m a bot that detects changes on StarrPark.biz! | she/it | Not affiliated with Supercell.

CURRENT STATUS: ${botStatusToStringMap.get(this.#bot.status)}`
		}).catch(() => {/* ignore error */});
	}

	async destroy(): Promise<void> {
		// Nothing to clean up.
	}
}
