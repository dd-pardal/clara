/**
 * @fileoverview Post-processes the raw readings from the sound detection algorithm, handles changes in the YouTube player's state and provides an event-driven API.
 */

import { EventEmitter } from "events";

import * as tconsole from "../util/time-log.js";
import * as AI from "./ai.js";
import History from "../util/history.js";
import { Browser, YTData, parseYTMysteryText } from "./browser.js";
import { serveFiles, Server } from "./http-server.js";
import { promisify } from "util";

export const enum Status {
	OK,
	STARTING_UP,
	YTP_INVALID_STATE,
	YTP_AUTO_RELOAD,
	YTP_MANUAL_RELOAD
}

export class SoundDetector extends EventEmitter {
	status: Status;
	ytLiveLatency: string | undefined;
	ytMysteryText: string | undefined;

	#configs: any;
	#server: Server | undefined;
	#browser: Browser;

	#lastYTState: number | undefined;

	#ytStateBroadcastTID: NodeJS.Timeout | undefined;
	#ytStateResumeTID: NodeJS.Timeout | undefined;
	#ytStateReloadTID: NodeJS.Timeout | undefined;

	readingHistory: History<AI.Data>;
	#lastRealReading: AI.Class | undefined = AI.Class.SILENCE;
	#acceptData = false;
	#isFirstTime = true;

	#cooldownEndTimestamp = 0; // Hopefully you won't be running this before January 1970. Unless... 😳
	#startupCooldownEndTimestamp: number | undefined;

	/** Average of the last 3 seconds. Used for smoothing spikes on the scores. */
	nearScoreAverages: AI.Scores | undefined;
	/** Average of the last 5 minutes. Used for detecting if something is wrong with the AI. */
	farScoreAverages: AI.Scores | undefined;
	/** The minimum near `THIS_IS_NORMAL` score average. */
	minNearTINScoreAverage = 1;

	constructor(configs: any) {
		super();

		this.status = Status.STARTING_UP;
		this.#browser = new Browser(configs);
		this.#configs = configs;
		this.readingHistory = new History<AI.Data>(this.#configs.sdParams.historyLength);

		// Processing of the AI readings
		this.#browser.on("aiData", (data: AI.Data) => {
			// console.log(data.scores);
			if (this.#acceptData) {
				const reading = AI.getMaxScore(data.scores);

				if (this.#isFirstTime) {
					this.#isFirstTime = false;
				}


				this.readingHistory.add(data);

				// Calculate averages
				this.nearScoreAverages = new Array(AI.NUM_CLASSES).fill(0) as unknown as AI.Scores;
				this.farScoreAverages = new Array(AI.NUM_CLASSES).fill(0) as unknown as AI.Scores;
				{
					let i = 0;
					for (const {scores} of this.readingHistory) {
						for (let j: AI.Class = 0; j < AI.NUM_CLASSES; j++) {
							if (i < this.#configs.sdParams.samplesForNearAvg) {
								this.nearScoreAverages[j] += scores[j];
							}
							this.farScoreAverages[j] += scores[j];
						}
						i++;
					}

					for (let j: AI.Class = 0; j < AI.NUM_CLASSES; j++) {
						this.nearScoreAverages[j] /= this.#configs.sdParams.samplesForNearAvg;
						this.farScoreAverages[j] /= i;
					}

					// Update the minimum near THIS_IS_NORMAL score average.
					if (i >= this.#configs.sdParams.samplesForNearAvg && this.nearScoreAverages[AI.Class.THIS_IS_NORMAL] < this.minNearTINScoreAverage) {
						this.minNearTINScoreAverage = this.nearScoreAverages[AI.Class.THIS_IS_NORMAL];
					}
				}

				// console.log(averageScores);

				let realReading: AI.Class;
				if (this.nearScoreAverages[AI.Class.SILENCE] > this.#configs.sdParams.silenceThreshold) {
					realReading = AI.Class.SILENCE;
				} else if (this.nearScoreAverages[AI.Class.SOUND] > this.#configs.sdParams.soundThreshold) {
					realReading = AI.Class.SOUND;
				} else if (this.nearScoreAverages[AI.Class.THIS_IS_NORMAL] > .4) {
					realReading = AI.Class.THIS_IS_NORMAL;
				} else {
					realReading = AI.Class.SILENCE;
				}

				if (this.#lastRealReading !== realReading) {
					tconsole.log(`Current reading changed to ${AI.Class[realReading]}.`);
					this.emit("readingChange", {
						reading: realReading,
						date: new Date(data.timestamp)
					});

					if (realReading !== AI.Class.THIS_IS_NORMAL) {
						const now = Date.now();
						if (now > this.#startupCooldownEndTimestamp!) {
							if (now >= this.#cooldownEndTimestamp) {
								if (this.farScoreAverages[AI.Class.THIS_IS_NORMAL] > this.#configs.sdParams.farScoreAvgThreshold) {
									this.emit("detection", {
										detection: realReading,
										date: new Date(data.timestamp)
									});
								} else {
									tconsole.log(`Detected ${AI.Class[reading.class]} but the far "this time is normal" score average was too low.`);
								}
							} else {
								tconsole.log(`Detected ${AI.Class[reading.class]} within the cooldown period.`);
							}
							this.#cooldownEndTimestamp = now + this.#configs.sdParams.detectionCooldown;
						} else {
							tconsole.log(`Detected ${AI.Class[reading.class]} within the startup cooldown period. Reloading YouTube.`);
							this.#startupCooldownEndTimestamp = Date.now() + 60_000;
							this.reloadYT();
						}
					}

					this.#lastRealReading = realReading;
				}
			}
		});


		// YT stuff
		this.#browser.on("ytData", (data: YTData) => {
			this.ytLiveLatency = data.liveLatency;
			this.ytMysteryText = data.mysteryText;

			const parsedMysteryText = parseYTMysteryText(data.mysteryText);
			const ytState = parsedMysteryText.state;

			if (this.#lastYTState === undefined) {
				// Wait for the YT player to start playing after (re)loading.
				if (ytState === 8) {
					setTimeout(() => {
						this.#acceptData = true;
						this.#changeStatus(Status.OK);
					}, 3_000);
					this.#lastYTState = 8;
				}

			} else {
				if (ytState !== this.#lastYTState) {
					tconsole.log(`YT state changed to ${ytState}.`);

					if (ytState !== 8) {
						if (this.#lastYTState === 8) {
							// The YT state just became invalid.
							tconsole.log("AI detection paused.");
							this.#acceptData = false;

							if (ytState === 4 /* paused */ || ytState === 80 /* playback error */) {
								// The player is not going to recover on its own, so reload it instantly.
								this.#changeStatus(Status.YTP_AUTO_RELOAD);
								this.reloadYT();
							} else {
								this.#ytStateBroadcastTID = setTimeout(() => {
									this.#changeStatus(Status.YTP_INVALID_STATE);
									this.#ytStateBroadcastTID = undefined;
								}, 5_000);
								this.#ytStateReloadTID = setTimeout(() => {
									this.#changeStatus(Status.YTP_AUTO_RELOAD);
									this.reloadYT();
								}, 30_000);
							}
						} else {
							// The YT state is still invalid, but changed.
						}

					} else if (ytState === 8 && this.#lastYTState !== 8) {
						// Prevent the status from changing and the player from reloading.
						clearTimeout(this.#ytStateBroadcastTID); clearTimeout(this.#ytStateReloadTID);

						// Resume accepting the AI data.
						this.#ytStateResumeTID = setTimeout(() => {
							tconsole.log("AI detection resumed.");
							this.#acceptData = true;
							if (this.#ytStateBroadcastTID === undefined) {
								this.#changeStatus(Status.OK);
							}
							this.#ytStateResumeTID = undefined;
						}, 1_000);
					}
				}

				this.#lastYTState = ytState;
			}
		});
	}

	#changeStatus(status: Status): void {
		this.status = status;
		this.emit("statusChange", status);
	}

	async start(): Promise<void> {
		this.#startupCooldownEndTimestamp = Date.now() + 60_000;
		this.#server = serveFiles();
		await this.#browser.launch();

		this.#acceptData = true;
	}

	async destroy(): Promise<void> {
		if (this.#server === undefined) {
			throw new Error("The sound detector isn't running.");
		}

		this.#acceptData = false;
		clearTimeout(this.#ytStateBroadcastTID); clearTimeout(this.#ytStateResumeTID); clearTimeout(this.#ytStateReloadTID);

		await Promise.all([
			promisify(Server.prototype.close).call(this.#server),
			this.#browser.close()
		]);
	}

	async reloadYT(): Promise<void> {
		this.#acceptData = false;
		this.#lastYTState = this.ytLiveLatency = this.ytMysteryText = undefined;
		clearTimeout(this.#ytStateBroadcastTID); clearTimeout(this.#ytStateResumeTID); clearTimeout(this.#ytStateReloadTID);
		this.#browser.reloadYT();
	}

	isInitialized(): this is {
		nearScoreAverages: AI.Scores;
		farScoreAverages: AI.Scores;
	} { // eslint-disable-line indent
		return this.nearScoreAverages !== undefined;
	}
}
