import EventEmitter from "events";

export const enum Status {
	OK,
	STARTING_UP,
	RESTARTING,
	OFFLINE,
	ERROR
}

export interface Bot extends EventEmitter {
	status: Status;

	shutdown(): void;
	restart(): void;
}
