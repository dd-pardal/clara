import { EventEmitter } from "events";

import { Poller, PollerChangeType } from "./poller.js";
import { Changes, crawl } from "./crawler.js";
import { PathInfo, PathInfoMap } from "./types.js";
import agent from "./agent.js";
import timeout from "../util/timeout.js";
import * as tconsole from "../util/time-log.js";

export class SPBChangeDetector extends EventEmitter {
	#poller: Poller;
	#pathInfoMap: PathInfoMap;
	#setPathInfo: (pathInfo: PathInfo) => void;

	constructor({
		pathInfoMap,
		setPathInfo
	}: {
		pathInfoMap: PathInfoMap;
		setPathInfo: (pathInfo: PathInfo) => void;
	}) {
		super();

		this.#pathInfoMap = pathInfoMap;
		this.#setPathInfo = setPathInfo;

		this.#poller = new Poller(this.#pathInfoMap);
	}

	start(): void {
		this.#poller.start();
		this.#poller.on("change", async (firstDetectionPath: string, firstDetectionChangeType: PollerChangeType) => {
			tconsole.log(`Change detected at ${firstDetectionPath}.`);
			this.#poller.stop();
			await timeout(5000);
			const changesPromise = crawl(this.#pathInfoMap, this.#setPathInfo);
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
