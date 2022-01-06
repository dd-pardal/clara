/**
 * @fileoverview Front end for Discord. Announces stuff via messages in user-defined channels and handles all Discord commands.
 */

import * as os from "os";

import * as Eris from "eris";

import { FrontEnd } from "../front-end.js";
import { Configs } from "../../configs.js";
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
	#client: Eris.Client;

	#configs: NonNullable<Configs["discord"]>;
	#db: Database;
	#bot: Bot;

	#spbDetector: SPB.SPBChangeDetector | undefined;
	#youtubeDetector: YT.YoutubeChangeDetector | undefined;

	#statusTimeout: NodeJS.Timeout | undefined;

	constructor({
		configs,
		db,
		bot,
		spbDetector,
		youtubeDetector
	}: {
		configs: NonNullable<Configs["discord"]>;
		db: Database;
		bot: Bot;
		spbDetector?: SPB.SPBChangeDetector | undefined;
		youtubeDetector?: YT.YoutubeChangeDetector | undefined;
	}) {
		this.#configs = configs;

		this.#client = new Eris.Client(this.#configs.auth.token, {
			intents: Eris.Constants.Intents.guilds
		});
		this.#client.connect();

		this.#client.on("error", (err) => {
			tconsole.log("Eris error: %o", err);
		});

		this.#db = db;
		this.#bot = bot;

		this.#spbDetector = spbDetector;
		this.#youtubeDetector = youtubeDetector;

		// Discord status
		{
			const statuses: Eris.ActivityPartial<Eris.BotActivityType>[] = [
				{ type: Eris.Constants.ActivityTypes.WATCHING, name: "StarrPark.biz" },
				{ type: Eris.Constants.ActivityTypes.WATCHING, name: "the WKBRL channel" }
			];
			let i = 0;

			const setStatus = () => {
				this.#client.editStatus(statuses[i]);
				i = (i + 1) % statuses.length;
			};
			setStatus();
			this.#statusTimeout = setInterval(setStatus, 300_000);
			for (const shard of this.#client.shards.values()) {
				shard.on("ready", setStatus);
				shard.on("resume", setStatus);
			}
		}

		const readyHandler = async () => {
			// Sync guilds with the database

			const guildIDsFromDB = db.getGuildIDs();
			const guildIDsFromDiscord = [...(this.#client.guilds as Map<string, Eris.Guild>).keys()];

			// Addition
			for (const guildID of guildIDsFromDiscord) {
				if (!guildIDsFromDB.includes(guildID)) {
					console.log(`The bot was added to the guild ${this.#client.guilds.get(guildID)!.name} (ID: ${guildID}).`);
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
		};
		this.#client.on("ready", readyHandler);

		this.#client.on("guildCreate", (guild) => {
			tconsole.log(`The bot was added to the guild ${guild.name} (ID: ${guild.id}).`);
			db.createGuildRecord(guild.id);
		});
		this.#client.on("guildDelete", (guild) => {
			tconsole.log(`The bot was removed from ${"name" in guild ? `the guild ${guild.name}` : "a guild"} (ID: ${guild.id}).`);
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
			console.log(change);
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
						type: Eris.Constants.ComponentTypes.ACTION_ROW,
						components: [
							{
								type: Eris.Constants.ComponentTypes.BUTTON,
								label: "Check the channel out!",
								style: Eris.Constants.ButtonStyles.LINK,
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

		function isCommandInteraction(interaction: Eris.PingInteraction | Eris.CommandInteraction | Eris.ComponentInteraction | Eris.AutocompleteInteraction | Eris.UnknownInteraction): interaction is Eris.CommandInteraction {
			return interaction.type === Eris.Constants.InteractionTypes.APPLICATION_COMMAND;
		}

		this.#client.on("interactionCreate", async (interaction) => {
			if (isCommandInteraction(interaction)) {
				const checkGuild = <R>(callback: (interaction: Eris.CommandInteraction & { guildID: string; member: Eris.Member; }) => R) => {
					if (interaction.guildID !== undefined) {
						return callback(interaction as Eris.CommandInteraction & { guildID: string; member: Eris.Member; });
					} else {
						interaction.createMessage({
							content: "You may only use this command inside a server.",
							flags: Eris.Constants.MessageFlags.EPHEMERAL
						});
					}
				};
				const checkPermission = <R>(callback: (interaction: Eris.CommandInteraction & { guildID: string; member: Eris.Member; }) => R) => {
					return checkGuild((interaction) => {
						const permissions = interaction.member.permissions;
						if (permissions.has("manageGuild")) {
							return callback(interaction);
						} else {
							interaction.createMessage({
								content: "You must have the Manage Server permission in order to use this command.",
								flags: Eris.Constants.MessageFlags.EPHEMERAL
							});
						}
					});
				};

				tconsole.log(
					`The /${interaction.data.name} command was used by ` +
					(interaction.guildID !== undefined ?
						`${interaction.member!.username}#${interaction.member!.discriminator} (ID: ${interaction.member!.id}) in the guild ${interaction.member!.guild.name} (ID: ${interaction.member!.guild.id}).` :
						`${interaction.user!.username}#${interaction.user!.discriminator} (ID: ${interaction.user!.id}) via direct messaging.`
					)
				);

				try {
					switch (interaction.data.name) {
						case "bot_stats": {
							let latencyString;
							{
								const latency = this.#client.shards.reduce((a, shard) => a + shard.latency, 0) / this.#client.shards.size;
								if (Number.isFinite(latency)) {
									latencyString = latency.toFixed(0) + "ms";
								} else {
									latencyString = "[unavailable]";
								}
							}

							let cpuTempString;
							try {
								cpuTempString = (await getCPUTemp()).toFixed(0) + " °C";
							} catch(err) {
								cpuTempString = "[unavailable]";
							}

							await interaction.createMessage({
								embeds: [
									{
										title: "Bot stats",
										fields: [
											{ name: "Discord websocket latency (ping)", value: latencyString},
											{ name: "Uptime", value: `Total: ${Math.round((Date.now() - CLARAS_BIRTH_TIMESTAMP) / 86400000)} days\nSystem: ${formatBigInterval(Math.round(os.uptime() / 60))}\nProcess: ${formatBigInterval(Math.round(process.uptime() / 60))}` },
											{ name: "CPU temperature", value: cpuTempString },
											{ name: "Load averages", value: process.platform !== "win32" ? os.loadavg().map(n => n.toFixed(2)).join(", ") : "[unavailable]" }
										],
										color: 0xed1e79
									}
								]
							});
							break;
						}

						case "help": {
							const broadcastChannelID = interaction.guildID && db.getGuildRecord(interaction.guildID).broadcastChannelID;

							await interaction.createMessage(`\
Hello there! My name is Clara and I watch for changes on [StarrPark.biz](<http://starrpark.biz/>) and on the [WKBRL YouTube channel](<https://www.youtube.com/channel/UCBQi60T2VQLw5mqU9wlTElQ>) so you don’t have to. When a change is detected, I send a message to ${broadcastChannelID ? `<#${broadcastChannelID}>` : "the chosen text channel"}.

Commands:
• \`/help\`: Show this message
• \`/credits_and_links\`: Show the people who made this bot and links you might be interested in
• \`/invite\`: Send the link for inviting me
• \`/set_channel\` (requires the Manage Server permission): Set the channel for which to send detections
• \`/set_mentions\` (requires the Manage Server permission): Change who I should mention when something is detected`);
							break;
						}

						case "credits_and_links":
							await interaction.createMessage({
								content: `\
Credits:
• Main developer: dd.pardal#3661`,
								embeds: [
									{
										title: "C.L.A.R.A.’s Discord server",
										description: "My server.",
										url: "https://discord.gg/rMfURQ98y5",
										thumbnail: {
											url: "https://starrchive.netlify.app/assets/images/discord-logo.png"
										}
									},
									{
										title: "C.L.A.R.A.’s Twitter account",
										description: "My Twitter account. I also post detections there.",
										url: "https://twitter.com/ClaraTheBot",
										thumbnail: {
											url: "https://starrchive.netlify.app/assets/images/twitter-logo.png"
										}
									},
									{
										title: "Starrchive",
										description: "A YouTube channel where the WKBRL sounds are uploaded to. (Not affiliated with Supercell.)",
										url: "https://www.youtube.com/channel/UCVewbwbOQLUofNVpFidGTSA",
										thumbnail: {
											url: "https://starrchive.netlify.app/assets/images/starrchive-logo_256.png"
										}
									},
									{
										title: "WKBRL Discord server",
										description: "A Discord server for discussing WKBRL and Brawl Stars lore. (Not affiliated with Supercell.)",
										url: "https://discord.gg/Q3PdCwAKNQ",
										thumbnail: {
											url: "https://starrchive.netlify.app/assets/images/server-logo.gif"
										}
									},
									{
										title: "C.L.A.R.A.’s GitHub repository",
										description: "Here you can see my code.",
										url: "https://github.com/dd-pardal/clara",
										thumbnail: {
											url: "https://starrchive.netlify.app/assets/images/github-mark_discord-embed-bg.png"
										}
									}
								]
							});
							break;

						case "invite":
							await interaction.createMessage("[Click here to add me to your server!](<https://wkbrl.netlify.app/clara/invite>) You should also join [my server](<https://discord.gg/rMfURQ98y5>) to be updated about new features and changes.");
							break;

						case "set_channel":
							await checkPermission(async (interaction) => {
								const channelID = (interaction.data.options?.find(o => o.name === "channel") as Eris.InteractionDataOptionsChannel | undefined)?.value;
								if (channelID) {
									const channel = this.#client.getChannel(channelID);

									if (channel.type !== Eris.Constants.ChannelTypes.GUILD_TEXT && channel.type !== Eris.Constants.ChannelTypes.GUILD_NEWS) {
										await interaction.createMessage("The provided channel must be a text channel.");
									} else {
										const permissions = channel.permissionsOf(this.#client.user.id);
										if (!(permissions.has("viewChannel") && permissions.has("sendMessages"))) {
											await interaction.createMessage({
												content: "I don’t have permission to send messages in that channel.",
												flags: Eris.Constants.MessageFlags.EPHEMERAL
											});
										} else {
											const promises = [];

											const guildInfo = db.getGuildRecord(interaction.guildID);
											if (guildInfo.broadcastChannelID && guildInfo.statusMessageID) {
												promises.push(this.#deleteStatusMessage(guildInfo.broadcastChannelID, guildInfo.statusMessageID).catch(() => {/* ignore error */}));
											}
											db.updateGuildBroadcastChannel(interaction.guildID, channel.id);
											promises.push(this.#sendStatusMessage(interaction.guildID, channel.id, this.#getStatusMessage()));
											promises.push(interaction.createMessage(`Detections will be sent to <#${channel.id}>.`));

											await Promise.all(promises);
										}
									}
								} else {
									db.updateGuildBroadcastChannel(interaction.guildID, null);
									await interaction.createMessage(`Detections will not be announced in this server.`);
								}
							});
							break;

						case "set_mentions":
							await checkPermission(async (interaction) => {
								if (interaction.data.options !== undefined && interaction.data.options.length > 0) {
									const mentions: string[] = (interaction.data.options as Eris.InteractionDataOptionsMentionable[]).map((opt) => {
										if (opt.value === interaction.guildID)
											return "@everyone";
										else if (interaction.data.resolved?.roles?.get(opt.value) !== undefined)
											return `<@&${opt.value}>`;
										else if (interaction.data.resolved?.members?.get(opt.value) !== undefined)
											return `<@${opt.value}>`;
										else
											throw new TypeError(`It wasn't possible to find out the type of the mention with ID ${opt.value}.`);
									});
									db.updateGuildAnnouncementMentions(interaction.guildID, mentions.map(s => s + " ").join(""));
									await interaction.createMessage(`I will mention ${conjunctionFormatter.format(mentions)} when something is detected.`);
								} else {
									db.updateGuildAnnouncementMentions(interaction.guildID, "");
									await interaction.createMessage("I won’t mention anyone when something is detected.");
								}
							});
							break;

						case "manage": {
							const subcommand = interaction.data.options![0] as Eris.InteractionDataOptionsSubCommand;

							switch (subcommand.name) {
								case "shutdown": {
									const reason = (subcommand.options?.[0] as Eris.InteractionDataOptionsString)?.value;
									tconsole.log(`Shutdown requested by ${interaction.member!.username}#${interaction.member!.discriminator} (ID: ${interaction.member!.id})${ reason ? `with reason «${reason}»` : ""}.`);
									await interaction.createMessage("Shutting down…");
									this.#bot.shutdown();
									break;
								}

								case "restart": {
									const reason = (subcommand.options?.[0] as Eris.InteractionDataOptionsString)?.value;
									tconsole.log(`Restart requested by ${interaction.member!.username}#${interaction.member!.discriminator} (ID: ${interaction.member!.id})${ reason ? `with reason «${reason}»` : ""}.`);
									await interaction.createMessage("Restarting…");
									this.#bot.restart();
									break;
								}
							}
							break;
						}

						default:
							console.log(`Unimplemented command /${interaction.data.name}.`);
							await interaction.createMessage({
								content: `This is awkward… The command \`/${interaction.data.name}\` does not exist.`,
								flags: Eris.Constants.MessageFlags.EPHEMERAL
							});
							break;
					}
				} catch (error) {
					interaction.createMessage({
						content: "An unexpected error has occured. Please try again later.",
						flags: Eris.Constants.MessageFlags.EPHEMERAL
					}).catch(() => {/* ignore error */});

					tconsole.log("An unexpected error has occured while responding to an interaction: %o", {
						interaction: {
							data: interaction.data,
							guildID: interaction.guildID
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
		const msg = await this.#client.createMessage(broadcastChannelID, statusMessage);
		this.#db.updateGuildStatusMessageID(guildID, msg.id);
	}

	/**
	 * Deletes a status message.
	 */
	async #deleteStatusMessage(broadcastChannelID: string, statusMessageID: string, guildID?: string): Promise<void> {
		if (guildID !== undefined) {
			this.#db.updateGuildStatusMessageID(guildID, null);
		}
		return await this.#client.deleteMessage(broadcastChannelID, statusMessageID);
	}

	async #editStatusMessage(broadcastChannelID: string, statusMessageID: string, statusMessage: string): Promise<Eris.Message> {
		return this.#client.editMessage(broadcastChannelID, statusMessageID, statusMessage);
	}

	/**
	 * Broadcasts a message.
	 */
	async #sendBroadcastMessage(broadcastChannelID: string, broadcastMessageOptions: Eris.AdvancedMessageContent): Promise<Eris.Message> {
		return await this.#client.createMessage(broadcastChannelID, broadcastMessageOptions);
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
								if (err instanceof Eris.DiscordHTTPError && err.code === 10008) {
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

	#broadcast(message: Eris.AdvancedMessageContent): Promise<(Eris.Message | undefined)[]> {
		const promises: Promise<(Eris.Message | undefined)>[]  = [];

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

		this.#client.disconnect({ reconnect: false });
	}
}
