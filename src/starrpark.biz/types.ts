/**
 * @fileoverview Type definitions for the StarrPark.biz change detector.
 */

export interface PathInfo {
	path: string;
	hash: Buffer | null;
	eTag: string | null;
}
export type PathInfoMap = Map<string, PathInfo>;

export type ArchiveOptions = {
	enabled: false;
} | {
	enabled: true;
	basePath: string;
};
