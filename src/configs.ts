/**
 * @fileoverview Handles loading the configuration file.
 */

import { readFileSync } from "fs";
import stripJsonComments from "strip-json-comments";

import { RequestOptions } from "http";
import { TwitterApiTokens } from "twitter-api-v2";
import { ArchiveOptions } from "./starrpark.biz/types.js";

export type Configs = {
	databasePath: string;

	discord?: {
		enabled: boolean;
		auth: {
			token: string;
		};
	} | null;
	twitter?: {
		enabled: boolean;
		auth: TwitterApiTokens;
	} | null;

	spb: {
		requestOptions: RequestOptions;
		pollingInterval: number;
		archive: ArchiveOptions;
	};
};

export function loadConfigsFromFileSync(path: string): Configs {
	return JSON.parse(stripJsonComments(readFileSync(path, "utf-8")));
}
