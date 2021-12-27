/**
 * @fileoverview Finds all changes and new URIs in the starrpark.biz website by recursively analysing the web pages and its assets for URIs.
 */

import * as http from "http";
import * as fsp from "fs/promises";
import { dirname } from "path";
import { createHash } from "crypto";

import { PathInfo, PathInfoMap } from "./types.js";
import agent from "./agent.js";

const pathRegex = /(?<=(?<delim>"|'|`)(?:(?:http:)?\/\/1bvfq4fbru\.s3-website-us-west-2\.amazonaws\.com)?)\/[A-z0-9-_.!#$%&][A-z0-9-_./!#$%&]+(?=\k<delim>)/g;

export interface Changes {
	added: string[];
	removed: string[];
	modified: string[];
}

/**
 * Crawls the website for changes and saves them as files.
 * @param pathInfoMap The path info map.
 * @param setPathInfo A function that is called when and entry is created/updated in the path info map.
 * @param paths The paths to begin crawling from. Defaults to all paths in `pathInfoMap`.
 * @returns A promise that resolves to the changes found.
 */
export async function crawl({
	requestOptions,
	archiveOptions,
	pathInfoMap,
	setPathInfo,
	paths
}: {
	requestOptions: http.RequestOptions;
	archiveOptions?: {
		basePath: string;
		directoryName: string;
		prevDirectoryName?: string | null | undefined;
	} | undefined;
	pathInfoMap: PathInfoMap;
	setPathInfo: (pathInfo: PathInfo) => void;
	paths?: Iterable<string>;
}): Promise<Changes> {
	const crawledPaths: Set<string> = new Set();
	const changes: Changes = {
		added: [],
		removed: [],
		modified: []
	};

	async function crawlRaw(path: string) {
		if (path.endsWith("/")) {
			path += "index.html";
		}

		if (crawledPaths.has(path)) {
			return;
		}

		crawledPaths.add(path);

		const promises: Promise<void>[] = [];

		await new Promise<void>((res, rej) => {
			const pathInfo = pathInfoMap.get(path);

			const req = http.request({
				...requestOptions,
				agent,
				path: path,
				headers: {
					...requestOptions.headers,
					...(pathInfo?.eTag != null ? { "if-none-match": pathInfo.eTag } : {})
				}
			});
			req.on("response", (resp) => {
				if (resp.statusCode === 200) {
					let fsPath: string, mkdirPromise: Promise<string | undefined>;
					if (archiveOptions !== undefined) {
						fsPath = archiveOptions.basePath + archiveOptions.directoryName + path;
						mkdirPromise = fsp.mkdir(dirname(fsPath), { recursive: true });
					}

					const hasher = createHash("sha256");

					const chunks: Buffer[] = [];
					resp.on("data", (chunk: Buffer) => {
						chunks.push(chunk);
						hasher.update(chunk);
					});
					resp.on("end", () => {
						const respBody = Buffer.concat(chunks);

						const hash = hasher.digest();
						const { hash: prevHash, eTag: prevETag } = pathInfoMap.get(path) ?? {};
						if (prevHash == null || !hash.equals(prevHash) || resp.headers.etag !== prevETag) {
							if (archiveOptions !== undefined) {
								if (prevHash == null || !hash.equals(prevHash)) {
									// File added or modified
									mkdirPromise.then(() => fsp.writeFile(fsPath, respBody));
								} else {
									// File not modified
									if (archiveOptions.prevDirectoryName != null) {
										mkdirPromise.then(() => fsp.link(archiveOptions.basePath + archiveOptions.prevDirectoryName + path, fsPath));
									}
								}
							}

							if (prevHash == null) {
								changes.added.push(path);
							} else if (!hash.equals(prevHash)) {
								changes.modified.push(path);
							}
							const newPathInfo = { path, hash, eTag: resp.headers.etag ?? null };
							pathInfoMap.set(path, newPathInfo);
							setPathInfo(newPathInfo);
						}

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
					if (archiveOptions?.prevDirectoryName != null) {
						const fsPath = archiveOptions.basePath + archiveOptions.directoryName + path;
						fsp.mkdir(dirname(fsPath), { recursive: true })
							.then(() => fsp.link(archiveOptions.basePath + archiveOptions.prevDirectoryName + path, fsPath));
					}
					// It's okay to skip because we know all of the URIs in this file are already in `pathInfos`.
					res();
				} else if (resp.statusCode === 403 || resp.statusCode === 404) {
					if (pathInfo?.hash != null) {
						changes.removed.push(path);
						const newPathInfo = { path, hash: null, eTag: null };
						pathInfoMap.set(path, newPathInfo);
						setPathInfo(newPathInfo);
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

	await Promise.all([...paths ?? pathInfoMap.keys()].map(path => crawlRaw(path)));

	return changes;
}
