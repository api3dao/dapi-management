declare module '@nodary/utilities' {

    interface NodaryFeed {
        name: string;
        deviationThresholdsInPercentages: number[]
    }

    export const nodaryFeeds: NodaryFeed[];
    export function computeFeedId(name: string): string;
    export function computeSponsorWalletAddress(name: string, deviationThreshold: number, deviationReference: number, heartbeatInterval: number): string;
}