/**
 * @fileoverview Entry point for normal operation. Glues it all together.
 */

import EventEmitter from "events";

import * as Discord from "discord.js";
import { TwitterApi } from "twitter-api-v2";

import { loadConfigsFromFileSync } from "./configs.js";
import { Bot, Status } from "./bot.js";
import { createExtendableEvent } from "./util/extendable-event.js";
import * as tconsole from "./util/time-log.js";
import { Database } from "./db.js";
import { DiscordFrontEnd } from "./front-ends/discord/index.js";
import { TwitterFrontEnd } from "./front-ends/twitter/index.js";
import { SPBChangeDetector } from "./starrpark.biz/change-detector.js";
import { YoutubeChangeDetector } from "./youtube/change-detector.js";
import { FrontEnd } from "./front-ends/front-end.js";

const configsPath = process.argv[2] as string | undefined;
if (!configsPath) {
	console.error("ERROR: You must specify the configuration file’s path in the first argument.");
	process.exit(1);
}
const configs = loadConfigsFromFileSync(configsPath);

// Exit codes:
// 0: Ctrl+C
// 1: Fatal error
// 100: /manage shutdown
// 101: /manage restart
function die(exitCode: number = 0) {
	spbDetector?.destroy();
	youtubeDetector?.stop();
	for (const frontEnd of frontEnds) {
		frontEnd.destroy();
	}
	db.close();
	process.exitCode = exitCode;

	setTimeout(() => {
		tconsole.log("`die()` was called but the process didn't exit within 5 seconds.");
		process.exit(exitCode);
	}, 5000).unref();
}

/**
 * Represents the whole bot process.
 */
class MainBot extends EventEmitter implements Bot {
	status: Status = Status.STARTING_UP;

	async #emitExtendable(event: string | symbol, arg: Record<string | number | symbol, unknown> = {}): Promise<void> {
		const { waitUntil, done } = createExtendableEvent();
		this.emit(event, Object.assign(arg, { waitUntil }));
		await done();
	}

	shutdown(): void {
		this.status = Status.OFFLINE;
		this.#emitExtendable("shutdown", { restart: false }).then(() => {
			die(0);
		});
	}
	restart(): void {
		this.status = Status.RESTARTING;
		this.#emitExtendable("shutdown", { restart: true }).then(() => {
			die(101);
		});
	}
}
const bot = new MainBot();

const db = new Database(configs.databasePath);

const spbDetector = new SPBChangeDetector({
	db,
	requestOptions: configs.spb.requestOptions,
	archiveOptions: configs.spb.archive,
	pollingInterval: configs.spb.pollingInterval,
	pathInfoMap: new Map(db.getSPBPathRecords().map(i => [i.path, i])),
	setPathInfo: db.setSPBPathRecord.bind(db)
}) as SPBChangeDetector | undefined;
const youtubeDetector = new YoutubeChangeDetector({
	records: db.getYTChannelRecords(),
	updateYTChannelRecord: db.updateYTChannelRecord.bind(db),
	pollingInterval: configs.youtube.pollingInterval
}) as YoutubeChangeDetector | undefined;

const frontEnds: FrontEnd[] = [];

if (configs.discord?.enabled) {
	const discordClient = new Discord.Client({
		intents: ["GUILDS"]
	});
	await discordClient.login(configs.discord.auth.token);
	tconsole.log("Connected to Discord.");
	frontEnds.push(new DiscordFrontEnd({
		db,
		bot,
		client: discordClient,
		spbDetector,
		youtubeDetector
	}));
}
if (configs.twitter?.enabled) {
	const twitterClient = new TwitterApi(configs.twitter.auth).readWrite;
	frontEnds.push(new TwitterFrontEnd({
		db,
		bot,
		client: twitterClient,
		spbDetector,
		youtubeDetector
	}));
}

spbDetector?.start();
youtubeDetector?.start();

function shutdown() {
	tconsole.log("Shutting down gracefully.");
	bot.shutdown();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Error handling
function onError(err: unknown) {
	try {
		console.error("%o", err);
		db.close();
	} catch(err) {/* ignore error */}
	process.exit(1);
}
process.on("uncaughtException", onError);
process.on("unhandledRejection", onError);

bot.status = Status.OK;
bot.emit("ready");
