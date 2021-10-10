import { EventEmitter } from "events";

import { Database } from "../db.js";
import { Poller, PollerChangeType } from "./poller.js";
import { crawl } from "./crawler.js";
import { PathInfoMap } from "./types.js";
import agent from "./agent.js";
import timeout from "../util/timeout.js";
import * as tconsole from "../util/time-log.js";

export class SPBChangeDetector extends EventEmitter {
	#poller: Poller;
	#pathInfoMap: PathInfoMap;

	constructor({
		db,
		configs
	}: {
		db: Database;
		configs: any;
	}) {
		super();

		this.#pathInfoMap = new Map(db.getSPBFileHashes().map(i => [i.path, i]));

		this.#poller = new Poller(this.#pathInfoMap);
	}

	start(): void {
		this.#poller.start();
		this.#poller.on("change", async (firstDetectionPath: string, firstDetectionChangeType: PollerChangeType) => {
			tconsole.log(`Change detected at ${firstDetectionPath}.`);
			this.#poller.stop();
			await timeout(5000);
			const changesPromise = crawl(this.#pathInfoMap);
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
