import { EventEmitter } from "events";
import * as http from "http";

import { Poller, PollerChangeType } from "./poller.js";
import { Changes, crawl } from "./crawler.js";
import { PathInfo, PathInfoMap } from "./types.js";
import agent from "./agent.js";
import timeout from "../util/timeout.js";
import * as tconsole from "../util/time-log.js";

export class SPBChangeDetector extends EventEmitter {
	#poller: Poller;

	#requestOptions: http.RequestOptions;

	#pathInfoMap: PathInfoMap;
	#setPathInfo: (pathInfo: PathInfo) => void;

	constructor({
		requestOptions,
		pollingInterval,
		pathInfoMap,
		setPathInfo
	}: {
		requestOptions: http.RequestOptions;
		pollingInterval: number;
		pathInfoMap: PathInfoMap;
		setPathInfo: (pathInfo: PathInfo) => void;
	}) {
		super();

		this.#requestOptions = requestOptions;
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
			const changesPromise = crawl({
				requestOptions: this.#requestOptions,
				pathInfoMap: this.#pathInfoMap,
				setPathInfo: this.#setPathInfo
			});
			this.emit("change", {
				firstDetectionPath,
				firstDetectionChangeType,
				changesPromise
			});
			await changesPromise;
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
