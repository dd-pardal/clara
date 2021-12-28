import EventEmitter from "events";

import * as tconsole from "../util/time-log.js";
import { fetchChannelData } from "./fetch.js";
import { ChannelData, ChannelRecord } from "./types.js";

export interface Change {
	record: ChannelRecord;
	newData: ChannelData;
	nameChanged: boolean;
	descriptionChanged: boolean;
	profilePictureChanged: boolean;
	bannerChanged: boolean;
	/** The number of new videos published since the last request */
	newVideos: number;
}

export class YoutubeChangeDetector extends EventEmitter {
	running: boolean = false;
	interval: number;

	#records: ChannelRecord[];
	#updateYTChannelRecord: (record: ChannelRecord) => void;

	#timeout: NodeJS.Timeout | undefined;
	#index: number | undefined;

	constructor({
		records,
		pollingInterval,
		updateYTChannelRecord
	}: {
		records: ChannelRecord[];
		updateYTChannelRecord: (record: ChannelRecord) => void;
		pollingInterval: number;
	}) {
		super();

		this.#records = records;
		this.#updateYTChannelRecord = updateYTChannelRecord;
		this.interval = pollingInterval;
	}

	start(): void {
		this.running = true;
		this.#index ??= 0;

		tconsole.log(`YouTube poller started. Detecting changes in ${this.#records.length} channels. A full cycle takes ${this.interval * this.#records.length / 1000}s.`);

		const handler = async () => {
			if (!this.running) {
				return;
			}

			this.#timeout = setTimeout(handler, this.interval);

			const record = this.#records[this.#index!];
			this.#index = (this.#index! + 1) % this.#records.length;
			try {
				const newData = await fetchChannelData(record.channelID);

				const nameChanged = newData.name !== record.name;
				const descriptionChanged = newData.description !== record.description;
				const profilePictureChanged = newData.profilePictureURL !== record.profilePictureURL;
				const bannerChanged = newData.bannerURL !== record.bannerURL;
				let newVideos: number;
				for (newVideos = 0; newVideos < newData.newestVideos.length; newVideos++) {
					if (newData.newestVideos[newVideos].videoID === record.newestVideoID) {
						break;
					}
				}

				if (nameChanged || descriptionChanged || profilePictureChanged || bannerChanged || newVideos > 0) {
					this.emit("change", {
						record,
						newData,
						nameChanged,
						descriptionChanged,
						profilePictureChanged,
						bannerChanged,
						newVideos
					});

					record.name = newData.name;
					record.description = newData.description;
					record.profilePictureURL = newData.profilePictureURL;
					record.bannerURL = newData.bannerURL;
					record.newestVideoID = newData.newestVideos[0]?.videoID ?? null;
					this.#updateYTChannelRecord(record);
				}
			} catch(err) {
				// Probably either lost Internet connection or something happened to the channel.
			}
		};
		handler();
	}

	stop(): void {
		this.running = false;
		clearTimeout(this.#timeout);
	}
}
