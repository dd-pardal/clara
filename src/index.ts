/**
 * @fileoverview Entry point for normal operation. Glues it all together.
 */

import EventEmitter from "events";

import * as Discord from "discord.js";
import { TwitterApi } from "twitter-api-v2";

import { Bot, Status } from "./bot.js";
import { createExtendableEvent } from "./util/extendable-event.js";
import * as tconsole from "./util/time-log.js";
import { Database } from "./db.js";
import { DiscordFrontEnd } from "./front-ends/discord/index.js";
import { TwitterFrontEnd } from "./front-ends/twitter/index.js";
import { SPBChangeDetector } from "./starrpark.biz/change-detector.js";
import { FrontEnd } from "./front-ends/front-end.js";


const argv = process.argv.slice(2);
const DEBUG = argv.includes("-dbg");


// Exit codes:
// 0: Ctrl+C
// 1: Fatal error
// 100: /manage shutdown
// 101: /manage restart
function die(exitCode: number = 0) {
	spbDetector?.destroy();
	for (const frontEnd of frontEnds) {
		frontEnd.destroy();
	}
	db.updateConfigs();
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


const db = new Database("./db.sqlite");

const spbDetector = new SPBChangeDetector({
	requestOptions: db.configs.spb.requestOptions,
	pollingInterval: db.configs.spb.pollingInterval,
	pathInfoMap: new Map(db.getSPBPathInfos().map(i => [i.path, i])),
	setPathInfo: db.setSPBPathInfo.bind(db)
}) as SPBChangeDetector | undefined;

const frontEnds: FrontEnd[] = [];

if (db.configs.discord?.enabled) {
	const discordClient = new Discord.Client({
		intents: ["GUILDS"]
	});
	await discordClient.login(db.configs.discord.auth.token);
	tconsole.log("Connected to Discord.");
	frontEnds.push(new DiscordFrontEnd({
		db,
		bot,
		client: discordClient,
		spbDetector
	}));
}
if (db.configs.twitter?.enabled) {
	const twitterClient = new TwitterApi(db.configs.twitter.auth).readWrite;
	frontEnds.push(new TwitterFrontEnd({
		db,
		bot,
		client: twitterClient,
		spbDetector
	}));
}

spbDetector?.start();

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
		db.updateConfigs();
		db.close();
	} catch(err) {/* ignore error */}
	process.exit(1);
}
process.on("uncaughtException", onError);
process.on("unhandledRejection", onError);

bot.status = Status.OK;
bot.emit("ready");
