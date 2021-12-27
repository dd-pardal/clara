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

export interface GuildRecord {
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
			getGuildRecord: this.#sqliteDB.prepare("SELECT broadcastChannelID, statusMessageID FROM guilds WHERE guildID=?"),
			getBroadcastInfo: this.#sqliteDB.prepare("SELECT guildID, broadcastChannelID, statusMessageID, announcementMentions FROM guilds WHERE broadcastChannelID IS NOT NULL"),
			updateGuildBroadcastChannel: this.#sqliteDB.prepare("UPDATE guilds SET broadcastChannelID=? WHERE guildID=?"),
			updateGuildAnnouncementMentions: this.#sqliteDB.prepare("UPDATE guilds SET announcementMentions=? WHERE guildID=?"),
			updateGuildStatusMessage: this.#sqliteDB.prepare("UPDATE guilds SET statusMessageID=? WHERE guildID=?"),
			createGuildRecord: this.#sqliteDB.prepare("INSERT INTO guilds (guildID) VALUES (?)"),
			deleteGuildRecord: this.#sqliteDB.prepare("DELETE FROM guilds WHERE guildID=?"),

			getSPBPathRecords: this.#sqliteDB.prepare("SELECT path, hash, eTag FROM spbFiles"),
			setSPBPathRecord: this.#sqliteDB.prepare("INSERT OR REPLACE INTO spbFiles (path, hash, eTag) VALUES (?, ?, ?)"),

			getValue: this.#sqliteDB.prepare("SELECT value FROM map WHERE key=?"),
			setValue: this.#sqliteDB.prepare("UPDATE map SET value=? WHERE key=?"),
		};
	}


	getGuildIDs(): Discord.Snowflake[] {
		return this.#preparedStatements.getGuildIDs.all().map(o => bigIntToSnowflake(o.guildID)) as Discord.Snowflake[];
	}
	getGuildRecord(guildID: Discord.Snowflake): GuildRecord {
		const record = this.#preparedStatements.getGuildRecord.get(guildID);
		record.broadcastChannelID = bigIntToSnowflake(record.broadcastChannelID);
		record.statusMessageID = bigIntToSnowflake(record.statusMessageID);
		return record;
	}
	getBroadcastInfo(): { guildID: Discord.Snowflake; broadcastChannelID: Discord.Snowflake; statusMessageID: Discord.Snowflake | null; announcementMentions: string; }[] {
		const array = this.#preparedStatements.getBroadcastInfo.all();
		for (const record of array) {
			record.guildID = bigIntToSnowflake(record.guildID);
			record.broadcastChannelID = bigIntToSnowflake(record.broadcastChannelID);
			record.statusMessageID = bigIntToSnowflake(record.statusMessageID);
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

	createGuildRecord(guildID: Discord.Snowflake): void {
		this.#preparedStatements.createGuildRecord.run(guildID);
	}
	deleteGuildRecord(guildID: Discord.Snowflake): void {
		this.#preparedStatements.deleteGuildRecord.run(guildID);
	}


	getSPBPathRecords(): SPB.PathInfo[] {
		return this.#preparedStatements.getSPBPathRecords.all() as SPB.PathInfo[];
	}
	setSPBPathRecord({ path, hash, eTag }: SPB.PathInfo): void {
		this.#preparedStatements.setSPBPathRecord.run(path, hash, eTag);
	}

	getValue(key: string): null | bigint | number | string | Buffer {
		return this.#preparedStatements.getValue.get(key).value;
	}
	setValue(key: string, value: null | bigint | number | string | Buffer): void {
		const result = this.#preparedStatements.setValue.run(value, key);
		if (result.changes !== 1) {
			throw new Error("The specified key doesn't exist.");
		}
	}

	close(): void {
		this.#sqliteDB.close();
	}
}
