export interface PartialVideoData {
	videoID: string;
	title: string;
}
export interface ChannelData {
	channelID: string;
	name: string;
	description: string;
	profilePictureURL: string;
	bannerURL: string | null;
	newestVideos: PartialVideoData[];
}

export interface ChannelRecord {
	channelID: string;
	name: string;
	description: string;
	profilePictureURL: string;
	bannerURL: string | null;
	newestVideoID: string;
}
