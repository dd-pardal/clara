import { SqliteError } from "better-sqlite3";

import { loadConfigsFromFileSync } from "../configs.js";
import { Database } from "../db.js";
import { fetchChannelData } from "../youtube/fetch.js";

const configsPath = process.argv[2] as string | undefined;
const action = process.argv[3] as string | undefined;
const channelID = process.argv[4] as string | undefined;
if (!configsPath || (action !== "add" && action !== "remove") || !channelID) {
	console.error("Syntax: node youtube-channels.js <configs file> (add <channel id> [display name] | remove <channel id>)");
	process.exit(1);
}
const configs = loadConfigsFromFileSync(configsPath);

const db = new Database(configs.databasePath);

if (action === "remove") {
	console.log("Deleting the channel record…");
	db.deleteYTChannelRecord(channelID);
} else {
	const displayName = process.argv[5] ?? null;

	console.log("Fetching the channel data…");
	const { name, description, profilePictureURL, bannerURL, newestVideos } = await fetchChannelData(channelID);

	console.log(`Fetched channel “${name}”. Creating the channel record…`);
	try {
		db.createYTChannelRecord({
			channelID,
			displayName,
			name,
			description,
			profilePictureURL,
			bannerURL,
			newestVideoID: newestVideos[0]?.videoID ?? null
		});
	} catch (err: unknown) {
		if (err instanceof SqliteError && err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
			console.log("The record already existed. Updating it instead…");
			db.updateYTChannelRecord({
				channelID,
				displayName,
				name,
				description,
				profilePictureURL,
				bannerURL,
				newestVideoID: newestVideos[0]?.videoID ?? null
			});
		} else {
			throw err;
		}
	}
}
console.log("Done!");
db.close();
