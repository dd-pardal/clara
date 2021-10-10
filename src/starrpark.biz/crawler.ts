/**
 * @fileoverview Finds all changes and new URIs in the starrpark.biz website by recursively analysing the web pages and its assets for URIs.
 */

import * as http from "http";
import * as fsp from "fs/promises";
import { dirname } from "path";
import { createHash } from "crypto";

import { PathInfoMap } from "./types.js";
import agent from "./agent.js";
import { formatDateAsISO8601Basic } from "../util/iso8601-basic-format.js";

const pathRegex = /(?<=(?<delim>"|'|`)(?:(?:http:)?\/\/1bvfq4fbru\.s3-website-us-west-2\.amazonaws\.com)?)\/[A-z0-9-_.!#$%&][A-z0-9-_./!#$%&]+(?=\k<delim>)/g;

export interface Changes {
	added: string[];
	removed: string[];
	modified: string[];
}

export async function crawl(pathInfoMap: PathInfoMap): Promise<Changes> {
	const ARCHIVE_ROOT = `./spb-archive/` + formatDateAsISO8601Basic(new Date());

	const crawledPaths: Set<string> = new Set();
	const changes: Changes = {
		added: [],
		removed: [],
		modified: []
	};

	async function crawlRaw(path: string, eTag?: string | undefined | null) {
		if (path.endsWith("/")) {
			path += "index.html";
		}

		if (crawledPaths.has(path)) {
			return;
		}

		crawledPaths.add(path);

		const promises: Promise<void>[] = [];

		await new Promise<void>((res, rej) => {
			const req = http.request({
				agent,
				protocol: "http:", // Come on, Supercell. You could've added TLS support.
				host: "1bvfq4fbru.s3-website-us-west-2.amazonaws.com",
				path: path,
				headers: eTag != null ? {
					"if-none-match": eTag
				} : {}
			});
			req.on("response", (resp) => {
				if (resp.statusCode === 200) {
					const fsPath = ARCHIVE_ROOT + path;
					const mkdirPromise = fsp.mkdir(dirname(fsPath), { recursive: true });

					const hasher = createHash("sha256");

					const chunks: Buffer[] = [];
					resp.on("data", (chunk: Buffer) => {
						chunks.push(chunk);
						hasher.update(chunk);
					});
					resp.on("end", () => {
						// console.log("END " + path);

						const respBody = Buffer.concat(chunks);

						mkdirPromise.then(() => fsp.writeFile(fsPath, respBody));

						const hash = hasher.digest();
						const prevHash = pathInfoMap.get(path)?.hash;
						if (prevHash == null) {
							changes.added.push(path);
						} else if (!prevHash.equals(hash)) {
							changes.modified.push(path);
						}
						pathInfoMap.set(path, { path, hash, eTag: resp.headers.etag ?? null });

						const length = Math.min(0x1000, respBody.length);
						let invalidBytes = 0;
						for (let i = 0; i < length; i++) {
							const byte = respBody[i];
							if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) || byte >= 0xF6) {
								invalidBytes++;
							}
						}
						if (invalidBytes / length <= 0.01) {
							const respString = respBody.toString("utf-8");
							for (const path of respString.match(pathRegex) ?? []) {
								promises.push(crawlRaw(path));
							}
						}
						res();
					});
				} else if (resp.statusCode === 304) { // Not modified
					// It's okay to skip because we know all of the URIs in this file are already in `pathInfos`.
					res();
				} else if (resp.statusCode === 403 || resp.statusCode === 404) {
					if (pathInfoMap.get(path)?.hash != null) {
						changes.removed.push(path);
						pathInfoMap.set(path, { path, hash: null, eTag: null });
					}
					res();
				} else {
					rej();
					console.warn(`Recieved status ${resp.statusCode} ${resp.statusMessage} on response for ${path}.`);
				}
			});
			req.end();
		});

		await Promise.all(promises);
	}

	await Promise.all([...pathInfoMap.values()].map(({ path, eTag }) => crawlRaw(path, eTag)));

	return changes;
}
