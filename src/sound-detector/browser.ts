/**
 * @fileoverview Handles the connection to the browser, which runs the YouTube player and the sound detection algorithm.
 */

import * as child_process from "child_process";
import EventEmitter from "events";

import puppeteer from "puppeteer-core";

import * as tconsole from "../util/time-log.js";
import timeout from "../util/timeout.js";
import * as AI from "./ai.js";

export interface BrowserConfigs {
	ytCookies: puppeteer.Protocol.Network.CookieParam[];
	inputDeviceLabel: string | undefined;
	chromiumPath: string;
}

export interface ParsedYTMysteryText {
	state: number;
}
export function parseYTMysteryText(mysteryText: string): ParsedYTMysteryText {
	const start = mysteryText.indexOf("s:") + 2;
	const end = mysteryText.indexOf(" ", start);
	return {
		state: Number.parseInt(mysteryText.slice(start, end))
	};
}

export interface YTData {
	mysteryText: string;
	liveLatency: string;
}

export class Browser extends EventEmitter {
	#browser: puppeteer.Browser | undefined;
	#ytPage: puppeteer.Page | undefined;
	#ytLoading = true;
	#ytChatElem: puppeteer.ElementHandle | undefined | null;

	constructor(public readonly configs: BrowserConfigs) {
		super();
	}

	async launch(): Promise<void> {
		this.#browser = await puppeteer.launch({
			executablePath: this.configs.chromiumPath,
			args: ["--disable-gpu", "--remote-debugging-port=9222", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
		});

		tconsole.log("Browser launched.");

		await Promise.all([(async () => {
			this.#ytPage = await this.#browser!.newPage();
			await this.#ytPage.exposeFunction("_pptr_sendData", (data: YTData) => {
				if (!this.#ytLoading)
					this.emit("ytData", data);
			});
			await this.reloadYT();
		})(), (async () => {
			const aiPage = await this.#browser!.newPage();

			await aiPage.exposeFunction("_pptr_sendData", (data: AI.Data) => {
				this.emit("aiData", data);
			});

			await aiPage.goto(`http://localhost:29110/index.html?${this.configs.inputDeviceLabel ? ("inputDeviceLabel=" + encodeURIComponent(this.configs.inputDeviceLabel)) : ""}`);
			tconsole.log("AI loaded.");
		})()]);
	}

	async reloadYT(): Promise<void> {
		if (!this.#ytPage)
			throw TypeError("The browser is not inintialized yet.");

		this.#ytLoading = true;

		const ytPage = this.#ytPage;

		// Setup the cookies and Local Storage
		function requestHandler(req: puppeteer.HTTPRequest) {
			req.respond({
				status: 200,
				contentType: "text/plain",
				body: "tweak me."
			});
		}
		await ytPage.setRequestInterception(true);
		ytPage.on("request", requestHandler);
		await ytPage.goto("https://www.youtube.com/");
		await ytPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4484.7 Safari/537.36");
		await ytPage.setCookie(...this.configs.ytCookies);
		await ytPage.evaluate(() => localStorage.setItem("yt-player-quality", '{"data":"{\\"quality\\":144,\\"previousQuality\\":360}","expiration":1658530190845,"creation":1627426190845}'));
		ytPage.off("request", requestHandler);
		await ytPage.setRequestInterception(false);
		{
			let tryAgain: boolean;
			do {
				tryAgain = false;
				try {
					await ytPage.goto("https://www.youtube.com/watch?v=31NX4zpsKuI", { timeout: 120000 });
				} catch (err: unknown) {
					if (err instanceof Error) {
						const errCode = err.message.slice(0, err.message.indexOf(" "));
						if (errCode === "net::ERR_NAME_NOT_RESOLVED" || errCode === "net::ERR_NETWORK_CHANGED") {
							tryAgain = true;
						}
					}
				}
				if (tryAgain)
					await timeout(5000);
			} while (tryAgain);
		}
		await timeout(100);

		// Open the "advanced stats" popup to get access to the mystery text.
		await ytPage.click("video", { button: "right" });
		await timeout(100);
		await ytPage.click(".ytp-panel-menu > :last-child");
		await timeout(100);


		// this.#ytChatElem = await ytPage.$("#chat");

		await ytPage.evaluate(() => {
			const infoPanel = document.querySelector(".html5-video-info-panel-content") as HTMLDivElement;

			const mysterySpan = infoPanel.querySelector(":scope > :nth-child(15) > span") as HTMLSpanElement;
			const liveLatencySpan = infoPanel.querySelector(":scope > :nth-child(12) > span > :last-child") as HTMLSpanElement;
			const mo = new MutationObserver(() => {
				const latencyText = liveLatencySpan.innerText;
				// @ts-ignore
				_pptr_sendData({
					mysteryText: mysterySpan.innerText,
					liveLatency: (latencyText === "0.00s" || latencyText === "") ? "[unavailable]" : latencyText
				});
			});
			mo.observe(infoPanel, { childList: true, subtree: true });
		});

		this.#ytLoading = false;

		tconsole.log("YouTube loaded.");
	}

	async close(): Promise<void> {
		if (this.#browser === undefined)
			throw TypeError("The browser isn't lauched yet.");

		await this.#browser.close();
		tconsole.log("Browser closed.");
	}

	async screenshotChat(): Promise<Buffer> {
		if (!this.#ytPage)
			throw TypeError("dead chat xd");

		return await this.#ytPage.screenshot() as Buffer;
	}
}

