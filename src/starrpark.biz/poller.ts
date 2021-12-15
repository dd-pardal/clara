/**
 * @fileoverview Looks for changes in the starrpark.biz website by checking URIs periodically.
 */

import * as http from "http";
import * as crypto from "crypto";
import EventEmitter from "events";

import * as tconsole from "../util/time-log.js";
import agent from "./agent.js";
import { PathInfo, PathInfoMap } from "./types.js";

export const enum PollerChangeType {
	ADDED,
	MODIFIED,
	REMOVED
}

export class Poller extends EventEmitter {
	pathInfoMap: PathInfoMap;
	interval: number;

	running = false;

	#requestOptions: http.RequestOptions;

	#timeout: NodeJS.Timeout | undefined;
	#i: Iterator<PathInfo> | undefined;

	constructor(requestOptions: http.RequestOptions, pollingInterval: number, pathInfoMap: PathInfoMap) {
		super();
		this.#requestOptions = requestOptions;
		this.interval = pollingInterval;
		this.pathInfoMap = pathInfoMap;
	}

	requestAndVerify(record: PathInfo): Promise<PollerChangeType | null> {
		const { path, hash: expectedHash, eTag: expectedETag } = record;
		return new Promise((res, rej) => {
			const req = http.request({
				...this.#requestOptions,
				agent,
				path: path,
				headers: {
					...this.#requestOptions.headers,
					...(expectedETag !== null ? { "if-none-match": expectedETag } : {})
				}
			});
			req.on("response", (resp) => {
				if (resp.statusCode === 200) {
					// Possible change
					const hasher = crypto.createHash("sha256");
					hasher.on("data", (realHash: Buffer) => {
						if (expectedHash === null) {
							res(PollerChangeType.ADDED);
						} else if (!realHash.equals(expectedHash)) {
							res(PollerChangeType.MODIFIED);
						}
					});
					resp.pipe(hasher);
				} else if (resp.statusCode === 304) {
					// Not modified
					res(null);
				} else if (resp.statusCode === 403 || resp.statusCode === 404) {
					if (expectedHash !== null) {
						// File removed!
						res(PollerChangeType.REMOVED);
					}
				} else {
					rej(new Error(`Unknown status code ${resp.statusCode} for ${path}.`));
				}
			});
			req.on("error", (err) => {
				rej(err);
			});
			req.end();
		});
	}

	start(): void {
		this.running = true;

		tconsole.log(`SPB poller started. ${this.pathInfoMap.size} known paths. A full cycle takes ${this.interval * this.pathInfoMap.size / 1000}s.`);

		this.#i = this.pathInfoMap.values();

		const handler = async () => {
			if (!this.running) {
				return;
			}

			this.#timeout = setTimeout(handler, this.interval);

			// Iterator madness
			let result = this.#i!.next();
			if (result.done) {
				this.#i = this.pathInfoMap.values();
				result = this.#i.next();
				if (result.done) {
					throw new TypeError("The path info map can't be empty.");
				}
			}
			const pathInfo = result.value;
			try {
				const changeType = await this.requestAndVerify(pathInfo);
				if (!this.running) {
					return;
				}
				if (changeType !== null) {
					this.emit("change", pathInfo.path, changeType);
				}
			} catch(err) {
				// Probably lost Internet connection.
			}
		};
		handler();
	}

	stop(): void {
		this.running = false;
		clearTimeout(this.#timeout);
		this.#i = undefined;
	}
}
