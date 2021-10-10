export interface PathInfo {
	path: string;
	hash: Buffer | null;
	eTag: string | null;
}

export type PathInfoMap = Map<string, PathInfo>;
