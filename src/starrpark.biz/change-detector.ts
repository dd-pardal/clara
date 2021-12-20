import { EventEmitter } from "events";
import * as http from "http";

import { Database } from "../db.js";
import { Poller, PollerChangeType } from "./poller.js";
import { crawl } from "./crawler.js";
import { ArchiveOptions, PathInfo, PathInfoMap } from "./types.js";
import agent from "./agent.js";
import timeout from "../util/timeout.js";
import * as tconsole from "../util/time-log.js";
import { formatDateTimeAsISO8601Basic } from "../util/format-time.js";

export class SPBChangeDetector extends EventEmitter {
	#db: Database;
	#poller: Poller;

	#requestOptions: http.RequestOptions;
	#archiveOptions: ArchiveOptions;

	#pathInfoMap: PathInfoMap;
	#setPathInfo: (pathInfo: PathInfo) => void;

	constructor({
		db,
		requestOptions,
		archiveOptions,
		pollingInterval,
		pathInfoMap,
		setPathInfo
	}: {
		db: Database;
		requestOptions: http.RequestOptions;
		archiveOptions: ArchiveOptions;
		pollingInterval: number;
		pathInfoMap: PathInfoMap;
		setPathInfo: (pathInfo: PathInfo) => void;
	}) {
		super();

		this.#db = db;
		this.#requestOptions = requestOptions;
		this.#archiveOptions = archiveOptions;
		this.#pathInfoMap = pathInfoMap;
		this.#setPathInfo = setPathInfo;

		this.#poller = new Poller(this.#requestOptions, pollingInterval, this.#pathInfoMap);
	}

	start(): void {
		this.#poller.start();
		this.#poller.on("change", async (firstDetectionPath: string, firstDetectionChangeType: PollerChangeType) => {
			tconsole.log(`Change detected at ${firstDetectionPath}.`);
			this.#poller.stop();
			await timeout(5000);

			const directoryName = formatDateTimeAsISO8601Basic(new Date());
			const changesPromise = crawl({
				requestOptions: this.#requestOptions,
				archiveOptions: this.#archiveOptions.enabled ? {
					basePath: this.#archiveOptions.basePath,
					directoryName,
					prevDirectoryName: this.#db.getValue("spb.archiveDirectoryName") as string | null
				} : undefined,
				pathInfoMap: this.#pathInfoMap,
				setPathInfo: this.#setPathInfo
			});

			this.emit("change", {
				firstDetectionPath,
				firstDetectionChangeType,
				changesPromise
			});

			await changesPromise;
			this.#db.setValue("spb.archiveDirectoryName", directoryName);
			this.#poller.start();
		});
	}

	destroy(): void {
		this.#poller.stop();
		agent.destroy();
	}
}

export { PollerChangeType } from "./poller.js";
export { Changes } from "./crawler.js";
