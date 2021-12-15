/**
 * @fileoverview Manages the connection to the SQLite database and provides wrapper functions for all of the operations.
 */

import SQLite from "better-sqlite3";

import * as Discord from "discord.js";
import * as SPB from "./starrpark.biz/types.js";

function bigIntToSnowflake(int: BigInt | null) {
	if (int === null)
		return null;
	else
		return int.toString();
}

export interface GuildInfo {
	guildID: Discord.Snowflake;
	broadcastChannelID: Discord.Snowflake | null;
	statusMessageID: Discord.Snowflake | null;
}

export class Database {
	#sqliteDB: SQLite.Database;
	#preparedStatements: { [key: string]: SQLite.Statement; };

	constructor(path: string) {
		this.#sqliteDB = new SQLite(path);
		this.#sqliteDB.defaultSafeIntegers(true);

		this.#preparedStatements = {
			getGuildIDs: this.#sqliteDB.prepare("SELECT guildID FROM guilds"),
			getGuildInfo: this.#sqliteDB.prepare("SELECT broadcastChannelID, statusMessageID FROM guilds WHERE guildID=?"),
			getBroadcastInfo: this.#sqliteDB.prepare("SELECT guildID, broadcastChannelID, statusMessageID, announcementMentions FROM guilds WHERE broadcastChannelID IS NOT NULL"),
			updateGuildBroadcastChannel: this.#sqliteDB.prepare("UPDATE guilds SET broadcastChannelID=? WHERE guildID=?"),
			updateGuildAnnouncementMentions: this.#sqliteDB.prepare("UPDATE guilds SET announcementMentions=? WHERE guildID=?"),
			updateGuildStatusMessage: this.#sqliteDB.prepare("UPDATE guilds SET statusMessageID=? WHERE guildID=?"),
			createGuildInfo: this.#sqliteDB.prepare("INSERT INTO guilds (guildID) VALUES (?)"),
			deleteGuildInfo: this.#sqliteDB.prepare("DELETE FROM guilds WHERE guildID=?"),

			getSPBPathInfos: this.#sqliteDB.prepare("SELECT path, hash, eTag FROM spbFiles"),
			setSPBPathInfo: this.#sqliteDB.prepare("INSERT OR REPLACE INTO spbFiles (path, hash, eTag) VALUES (?, ?, ?)"),
		};
	}


	getGuildIDs(): Discord.Snowflake[] {
		return this.#preparedStatements.getGuildIDs.all().map(o => bigIntToSnowflake(o.guildID)) as Discord.Snowflake[];
	}
	getGuildInfo(guildID: Discord.Snowflake): GuildInfo {
		const info = this.#preparedStatements.getGuildInfo.get(guildID);
		info.broadcastChannelID = bigIntToSnowflake(info.broadcastChannelID);
		info.statusMessageID = bigIntToSnowflake(info.statusMessageID);
		return info;
	}
	getBroadcastInfo(): { guildID: Discord.Snowflake; broadcastChannelID: Discord.Snowflake; statusMessageID: Discord.Snowflake | null; announcementMentions: string; }[] {
		const array = this.#preparedStatements.getBroadcastInfo.all();
		for (const info of array) {
			info.guildID = bigIntToSnowflake(info.guildID);
			info.broadcastChannelID = bigIntToSnowflake(info.broadcastChannelID);
			info.statusMessageID = bigIntToSnowflake(info.statusMessageID);
		}
		return array;
	}

	updateGuildBroadcastChannel(guildID: Discord.Snowflake, broadcastChannelID: Discord.Snowflake | null): void {
		this.#preparedStatements.updateGuildBroadcastChannel.run(broadcastChannelID, guildID);
	}
	updateGuildAnnouncementMentions(guildID: Discord.Snowflake, announcementMentions: string): void {
		this.#preparedStatements.updateGuildAnnouncementMentions.run(announcementMentions, guildID);
	}
	updateGuildStatusMessageID(guildID: Discord.Snowflake, statusMessageID: Discord.Snowflake | null): void {
		this.#preparedStatements.updateGuildStatusMessage.run(statusMessageID, guildID);
	}

	createGuildInfo(guildID: Discord.Snowflake): void {
		this.#preparedStatements.createGuildInfo.run(guildID);
	}
	deleteGuildInfo(guildID: Discord.Snowflake): void {
		this.#preparedStatements.deleteGuildInfo.run(guildID);
	}


	getSPBPathInfos(): SPB.PathInfo[] {
		return this.#preparedStatements.getSPBPathInfos.all() as SPB.PathInfo[];
	}
	setSPBPathInfo({ path, hash, eTag }: SPB.PathInfo): void {
		this.#preparedStatements.setSPBPathInfo.run(path, hash, eTag);
	}


	close(): void {
		this.#sqliteDB.close();
	}
}
