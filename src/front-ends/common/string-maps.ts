import { Status as BotStatus } from "../../bot.js";

export const botStatusToStringMap = new Map([
	[BotStatus.OK, "Up and running!"],
	[BotStatus.STARTING_UP, "Starting up."],
	[BotStatus.RESTARTING, "Restarting."],
	[BotStatus.OFFLINE, "Temporarily offline."],
	[BotStatus.ERROR, "An unexpected error has occured."]
]);
