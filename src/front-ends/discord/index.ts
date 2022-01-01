/**
 * @fileoverview Front end for Discord. Announces stuff via messages in user-defined channels and handles all Discord commands.
 */

// I wish discord.js allowed users to send/delete/edit messages by the channel/message IDs without
// needing to commit the crimes I have committed in this file. Still faster than fetching the channel, though.
// And no, the channels aren't in the cache for some reason. I don't even care anymore. I'm probably
// switching to Eris when they add support for interactions.

import * as os from "os";

import * as Discord from "discord.js";
import { MessageButtonStyles, MessageComponentTypes } from "discord.js/typings/enums.js";

import { FrontEnd } from "../front-end.js";
import { Bot } from "../../bot.js";
import { botStatusToStringMap } from "../common/string-maps.js";
import * as tconsole from "../../util/time-log.js";
import { Database } from "../../db.js";
import * as SPB from "../../starrpark.biz/change-detector.js";
import * as YT from "../../youtube/change-detector.js";
import { getCPUTemp } from "../../util/cpu-temp.js";
import { CLARAS_BIRTH_TIMESTAMP } from "../../constants.js";
import { formatBigInterval } from "../../util/format-time-interval.js";

const conjunctionFormatter = new Intl.ListFormat("en", { type: "conjunction" });

export class DiscordFrontEnd implements FrontEnd {
	#db: Database;
	#bot: Bot;
	#client: Discord.Client;

	#spbDetector: SPB.SPBChangeDetector | undefined;
	#youtubeDetector: YT.YoutubeChangeDetector | undefined;

	#statusTimeout: NodeJS.Timeout | undefined;

	constructor({
		db,
		bot,
		client,
		spbDetector,
		youtubeDetector
	}: {
		db: Database;
		bot: Bot;
		client: Discord.Client;
		spbDetector?: SPB.SPBChangeDetector | undefined;
		youtubeDetector?: YT.YoutubeChangeDetector | undefined;
	}) {
		this.#db = db;
		this.#bot = bot;
		this.#client = client;

		this.#spbDetector = spbDetector;
		this.#youtubeDetector = youtubeDetector;

		// Discord status
		{
			const statuses: Discord.ActivityOptions[] = [
				{ type: "WATCHING", name: "StarrPark.biz" },
				{ type: "WATCHING", name: "the WKBRL channel" }
			];
			let i = 0;

			const setStatus = () => {
				this.#client.user?.setActivity(statuses[i]);
				i = (i + 1) % statuses.length;
			};
			setStatus();
			this.#statusTimeout = setInterval(setStatus, 300_000);
			for (const shard of this.#client.ws.shards.values()) {
				shard.on("ready", setStatus);
				shard.on("resumed", setStatus);
			}
		}

		const readyHandler = async () => {
			{
				// Sync guilds with the database

				const guildIDsFromDB = db.getGuildIDs();
				const guildIDsFromDiscord = [...this.#client.guilds.cache.keys()];

				// Addition
				for (const guildID of guildIDsFromDiscord) {
					if (!guildIDsFromDB.includes(guildID)) {
						console.log(`The bot was added to the guild "${this.#client.guilds.cache.get(guildID)!.name}" (ID: ${guildID}).`);
						db.createGuildRecord(guildID);
					}
				}
				// Removal
				for (const guildID of guildIDsFromDB) {
					if (!guildIDsFromDiscord.includes(guildID)) {
						console.log(`The bot was removed from the guild with ID ${guildID}.`);
						db.deleteGuildRecord(guildID);
					}
				}
			}
		};
		if (this.#client.readyTimestamp == null) {
			this.#client.on("ready", readyHandler);
		} else {
			readyHandler();
		}
		this.#client.on("guildCreate", (guild) => {
			tconsole.log(`The bot was added to the guild "${guild.name}" (ID: ${guild.id}).`);
			db.createGuildRecord(guild.id);
		});
		this.#client.on("guildDelete", (guild) => {
			tconsole.log(`The bot was removed from the guild "${guild.name}" (ID: ${guild.id}).`);
			db.deleteGuildRecord(guild.id);
		});

		this.#spbDetector?.on("change", async (
			{ firstDetectionPath, firstDetectionChangeType, changesPromise }:
			{ firstDetectionPath: string; firstDetectionChangeType: SPB.PollerChangeType; changesPromise: Promise<SPB.Changes>; }
		) => {
			const changes = await changesPromise;
			this.#broadcast({
				content: `I’ve detected a change in the StarrPark.biz website! ${changes.added.length} URLs were added and ${changes.modified.length} were modified.`,
			});
		});

		this.#youtubeDetector?.on("change", (change: YT.Change) => {
			this.#broadcast({
				content:
					`I’ve detected a change in ${change.record.displayName ?? change.record.name}:\n` +
					(change.nameChanged ? `The name has changed: ~~${change.record.name}~~ **${change.newData.name}**\n` : "") +
					(change.descriptionChanged ? "The description has changed.\n" : "") +
					(change.profilePictureChanged ? `The profile picture has changed.\n` : "") +
					(change.bannerChanged ? `The banner has changed.\n` : "") +
					(change.newVideos === null ? "The video list has changed.\n" : "") +
					(change.newVideos !== null && change.newVideos > 0 ? `New videos: ${change.newData.newestVideos.slice(0, change.newVideos).reverse().map(video => `https://youtu.be/${video.videoID}`).join(", ")}\n` : ""),
				components: [
					{
						type: MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: MessageComponentTypes.BUTTON,
								label: "Check the channel out!",
								style: MessageButtonStyles.LINK,
								url: `https://www.youtube.com/channel/${change.newData.channelID}/${change.descriptionChanged ? "/about" : ""}`
							}
						]
					}
				]
			});
		});

		// Status updates
		this.#bot.on("ready", () => {
			this.#updateStatus();
		});
		this.#bot.on("shutdown", (ev) => {
			ev.waitUntil(this.#updateStatus());
		});


		// Commands
		this.#client.on("interactionCreate", async (interaction) => {
			if (interaction.isCommand()) {

				const checkGuild = <R>(callback: (interaction: Discord.BaseGuildCommandInteraction<"present"> & Discord.CommandInteraction) => R) => {
					if (interaction.inGuild()) {
						return callback(interaction);
					} else {
						interaction.reply({ content: "You may only use this command inside a server.", ephemeral: true });
					}
				};
				const checkPermission = <R>(callback: (interaction: Discord.BaseGuildCommandInteraction<"present"> & Discord.CommandInteraction) => R) => {
					return checkGuild((interaction) => {
						const permissions = interaction.member.permissions;
						if (permissions instanceof Discord.Permissions && permissions.has(Discord.Permissions.FLAGS.MANAGE_GUILD)) {
							return callback(interaction);
						} else {
							interaction.reply({ content: "You must have the Manage Server permission in order to use this command.", ephemeral: true });
						}
					});
				};

				try {
					switch (interaction.commandName) {
						case "bot_stats": {
							let cpuTemp;
							try {
								cpuTemp = (await getCPUTemp()).toFixed(0) + " °C";
							} catch(err) {
								cpuTemp = "[unavailable]";
							}

							await interaction.reply({
								embeds: [
									{
										title: "Bot stats",
										fields: [
											{ name: "Discord websocket latency (ping)", value: `${this.#client.ws.ping}ms` },
											{ name: "Uptime", value: `Total: ${Math.round((Date.now() - CLARAS_BIRTH_TIMESTAMP) / 86400000)} days\nSystem: ${formatBigInterval(Math.round(os.uptime() / 60))}\nProcess: ${formatBigInterval(Math.round(process.uptime() / 60))}` },
											{ name: "CPU temperature", value: cpuTemp },
											{ name: "Load averages", value: process.platform !== "win32" ? os.loadavg().map(n => n.toFixed(2)).join(", ") : "[unavailable]" }
										],
										color: 0xed1e79
									}
								]
							});
							break;
						}

						case "help": {
							const broadcastChannel = interaction.guildId && db.getGuildRecord(interaction.guildId).broadcastChannelID;

							await interaction.reply(`\
Hello there! My name is Clara and I watch for changes on [StarrPark.biz](http://starrpark.biz/) 24/7 so you don’t have to. In case a change is detected, I send a message to ${broadcastChannel ? `<#${broadcastChannel}>` : "the chosen text channel"}.

I was made with the intention of being useful, but I come with **no warranty**. It’s possible that I fail to detect a change or detect one when there is none.

Commands:
• \`/help\`: Show this message
• \`/credits_and_links\`: Show the people who made this bot and links you might be interested in
• \`/invite\`: Send the link for inviting me
• \`/set_channel\` (requires the Manage Server permission): Set the channel for which to send detections
• \`/set_mentions\` (requires the Manage Server permission): Change who I should mention when something is detected`);
							break;
						}

						case "credits_and_links":
							await interaction.reply({
								content: `\
Credits:
• Main developer: dd.pardal#3661`,
								embeds: [
									{
										title: "C.L.A.R.A.’s Discord server",
										description: "My server.",
										url: "https://discord.gg/rMfURQ98y5",
										thumbnail: {
											url: "https://cdn.discordapp.com/icons/834849541303042069/6ea27712cd8be6ddb182dc08346a852e.webp"
										}
									},
									{
										title: "Starrchive",
										description: "A YouTube channel where the WKBRL sounds are uploaded to. (Not affiliated with Supercell.)",
										url: "https://www.youtube.com/channel/UCVewbwbOQLUofNVpFidGTSA",
										thumbnail: {
											url: "https://cdn.discordapp.com/attachments/867972618429538315/887318726725214258/starrchive_logo.webp"
										}
									},
									{
										title: "WKBRL Discord server",
										description: "A Discord server for discussing WKBRL and Brawl Stars lore. (Not affiliated with Supercell.)",
										url: "https://discord.gg/Q3PdCwAKNQ",
										thumbnail: {
											url: "https://cdn.discordapp.com/icons/739868777050669056/a_b2404d9081675fc978d6edb6344274c4.gif"
										}
									},
									{
										title: "C.L.A.R.A.’s GitHub repository",
										description: "Here you can see my code.",
										url: "https://github.com/dd-pardal/clara",
										thumbnail: {
											url: "https://cdn.discordapp.com/attachments/840924631254171688/900864222177681528/github-mark.png"
										}
									}
								]
							});
							break;

						case "invite":
							await interaction.reply('[Click here to add me to your server!](<https://wkbrl.netlify.app/clara/invite>) You should also join [my server](<https://discord.gg/rMfURQ98y5>) to be updated about new features and changes.');
							break;

						case "set_channel":
							await checkPermission(async (interaction) => {
								const channel = interaction.options.getChannel("channel");
								if (channel) {
									if (!(channel instanceof Discord.Channel)) {
										throw new TypeError("The channel was not serialized.");
									}
									if (channel.type !== "GUILD_TEXT" && channel.type !== "GUILD_NEWS") {
										await interaction.reply("The provided channel must be a text channel.");
									} else if (
										!channel.permissionsFor(interaction.guild!.me!)?.has([
											Discord.Permissions.FLAGS.SEND_MESSAGES,
											Discord.Permissions.FLAGS.VIEW_CHANNEL
										])
									) {
										await interaction.reply({ content: "I don’t have permission to send messages in that channel.", ephemeral: true });
									} else {
										const promises = [];

										const guildInfo = db.getGuildRecord(interaction.guildId);
										if (guildInfo.broadcastChannelID && guildInfo.statusMessageID) {
											promises.push(this.#deleteStatusMessage(guildInfo.broadcastChannelID, guildInfo.statusMessageID).catch(() => {/* ignore error */}));
										}
										db.updateGuildBroadcastChannel(interaction.guildId, channel.id);
										promises.push(this.#sendStatusMessage(interaction.guildId, channel.id, this.#getStatusMessage()));
										promises.push(interaction.reply(`Detections will be sent to <#${channel}>.`));

										await Promise.all(promises);
									}
								} else {
									db.updateGuildBroadcastChannel(interaction.guildId, null);
									await interaction.reply(`Detections will not be announced in this server.`);
								}
							});
							break;

						case "set_mentions":
							await checkPermission(async (interaction) => {
								if (interaction.options.data.length > 0) {
									const mentions: string[] = interaction.options.data.map((opt) => {
										if (opt.role?.id === interaction.guildId)
											return "@everyone";
										else if (opt.role)
											return `<@&${opt.role.id}>`;
										else if (opt.member)
											return `<@${(opt.member as Discord.GuildMember).id}>`;
										else if (opt.user)
											return `<@${opt.user.id}>`;
										else
											throw new TypeError(`It wasn't possible to find out the type of the mention with ID ${opt.value}.`);
									});
									db.updateGuildAnnouncementMentions(interaction.guildId, mentions.map(s => s + " ").join(""));
									await interaction.reply(`I will mention ${conjunctionFormatter.format(mentions)} when something is detected.`);
								} else {
									db.updateGuildAnnouncementMentions(interaction.guildId, "");
									await interaction.reply("I won’t mention anyone when something is detected.");
								}
							});
							break;

						case "manage":
							switch (interaction.options.getSubcommand(true)) {
								case "shutdown": {
									const reason = interaction.options.getString("reason");
									tconsole.log(`Shutdown requested by ${interaction.user.username}#${interaction.user.discriminator} (ID: ${interaction.user.id})${ reason ? `with reason «${reason}»` : ""}.`);
									await interaction.reply("Shutting down…");
									this.#bot.shutdown();
									break;
								}

								case "restart": {
									const reason = interaction.options.getString("reason");
									tconsole.log(`Restart requested by ${interaction.user.username}#${interaction.user.discriminator} (ID: ${interaction.user.id})${ reason ? `with reason «${reason}»` : ""}.`);
									await interaction.reply("Restarting…");
									this.#bot.restart();
									break;
								}
							}
							break;

						default:
							console.log("Unimplemented command. Interaction data: %o", interaction);
							await interaction.reply({ content: `This is awkward… The command \`/${interaction.commandName}\` does not exist.`, ephemeral: true });
							break;
					}
				} catch (error) {
					interaction.reply("An unexpected error has occured. Please try again later.").catch(() => {/* ignore error */});
					console.log("An unexpected error has occured while responding to an interaction: %o", {
						interaction: {
							commandName: interaction.commandName,
							deferred: interaction.deferred,
							ephemeral: interaction.ephemeral,
							options: interaction.options.data
						},
						error
					});
				}
			}
		});
	}

	#getStatusMessage(): string {
		return `**Current status:** ${botStatusToStringMap.get(this.#bot.status)}`;
	}

	/**
	 * Sends a status message and updates the DB.
	 */
	async #sendStatusMessage(guildID: string, broadcastChannelID: string, statusMessage: string): Promise<void> {
		// @ts-ignore
		const msg = new Discord.Message(this.#client, await this.#client.api.channels[broadcastChannelID].messages.post({ data: { content: statusMessage } }));
		this.#db.updateGuildStatusMessageID(guildID, msg.id);
	}

	/**
	 * Deletes a status message.
	 */
	async #deleteStatusMessage(broadcastChannelID: string, statusMessageID: string, guildID?: string): Promise<void> {
		if (guildID !== undefined) {
			this.#db.updateGuildStatusMessageID(guildID, null);
		}
		// @ts-ignore
		return await new Discord.MessageManager({ client: this.#client, id: broadcastChannelID } as Discord.TextChannel).delete(statusMessageID);
	}

	async #editStatusMessage(broadcastChannelID: string, statusMessageID: string, statusMessage: string): Promise<Discord.Message> {
		// @ts-ignore
		return await new Discord.MessageManager({ client: this.#client, id: broadcastChannelID } as Discord.TextChannel).edit(statusMessageID, { content: statusMessage });
	}

	/**
	 * Broadcasts a message.
	 */
	async #sendBroadcastMessage(broadcastChannelID: string, broadcastMessageOptions: Discord.MessageOptions): Promise<Discord.Message> {
		// @ts-ignore
		return new Discord.Message(this.#client, await this.#client.api.channels[broadcastChannelID].messages.post({ data: broadcastMessageOptions }));
	}

	async #updateStatus(): Promise<void> {
		const statusMessage = this.#getStatusMessage();

		const promises = [];

		for (const { guildID, broadcastChannelID, statusMessageID } of this.#db.getBroadcastInfo()) {
			if (broadcastChannelID !== null) {
				if (statusMessageID !== null) {
					promises.push(
						this.#editStatusMessage(broadcastChannelID, statusMessageID, statusMessage)
							.catch((err: unknown) => {
								if (err instanceof Discord.DiscordAPIError && err.code === 10008) {
									return this.#sendStatusMessage(guildID, broadcastChannelID, statusMessage);
								}
							})
							.catch(() => {/* ignore error */})
					);
				} else {
					promises.push(
						this.#sendStatusMessage(guildID, broadcastChannelID, statusMessage)
							.catch(() => {/* ignore error */})
					);
				}
			}
		}

		await Promise.all(promises);
	}

	#broadcast(message: Discord.MessageOptions): Promise<(Discord.Message | undefined)[]> {
		const promises:Promise<(Discord.Message | undefined)>[]  = [];

		const statusMessage = this.#getStatusMessage();

		for (const { guildID, broadcastChannelID, statusMessageID, announcementMentions } of this.#db.getBroadcastInfo()) {
			const msgOptions = Object.assign({}, message);
			if (msgOptions.content) {
				msgOptions.content = announcementMentions + msgOptions.content;
			}

			if (statusMessageID !== null) {
				this.#deleteStatusMessage(broadcastChannelID, statusMessageID, guildID)
					.catch(() => {/* ignore error */});
			}

			const promise = this.#sendBroadcastMessage(broadcastChannelID, msgOptions);
			promises.push(promise.catch(() => undefined /* ignore error */));
			promise
				.then(() => this.#sendStatusMessage(guildID, broadcastChannelID, statusMessage))
				.catch(() => {/* ignore error */});
		}

		return Promise.all(promises);
	}

	destroy(): void {
		clearInterval(this.#statusTimeout);

		this.#client.destroy();

		this.#client.ws.shards.get(0)?.on("close", () => {
			tconsole.log("Disconnected from Discord.");
		});
	}
}
