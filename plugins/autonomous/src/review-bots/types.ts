// The settings of external review (spec review-bots, "Review bot settings"; design D3).

export interface ReviewBot {
    id: string;
    login: string; // as REST names it, e.g. `coderabbitai[bot]`
    check: string; // the name of the check run the bot leaves on a head commit
    mention: string | null; // what a reply to the bot starts with; null for none
}

export interface ExternalReviewConfig {
    waitMinutes: number; // how long a bot with no check run is waited for
    answerWaitMinutes: number; // how long a bot is given to answer a round that pushed nothing
    rounds: number; // the round limit
    bots: ReviewBot[];
}
