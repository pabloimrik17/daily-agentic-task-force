import type {
    CheckRun,
    PullRequestState,
    Review,
    ReviewThread,
    ThreadComment,
} from "../pull-request/port.ts";
import { renderMarker } from "../publish/markers.ts";
import type { ExternalReviewConfig } from "./types.ts";

export const CONFIG: ExternalReviewConfig = {
    waitMinutes: 30,
    answerWaitMinutes: 10,
    rounds: 3,
    bots: [
        { id: "coderabbit", login: "coderabbitai[bot]", check: "CodeRabbit", mention: null },
        { id: "greptile", login: "greptile-apps[bot]", check: "Greptile Review", mention: null },
        { id: "pullfrog", login: "pullfrog[bot]", check: "pullfrog", mention: null },
    ],
};

export const HEAD = "a1b2c3d";
export const COMMITTED_AT = "2026-11-28T10:00:00Z";

export function minutesAfter(iso: string, minutes: number): Date {
    return new Date(Date.parse(iso) + minutes * 60_000);
}

export function prState(change: Partial<PullRequestState> = {}): PullRequestState {
    return {
        draft: false,
        head: { sha: HEAD, committedAt: COMMITTED_AT },
        readyAt: null,
        ...change,
    };
}

export function run(name: string, change: Partial<CheckRun> = {}): CheckRun {
    return {
        name,
        app: "github-actions",
        status: "completed",
        conclusion: "success",
        title: null,
        summary: null,
        url: `https://example.test/runs/${name}`,
        startedAt: "2026-11-28T10:01:00Z",
        completedAt: "2026-11-28T10:05:00Z",
        ...change,
    };
}

// Every configured bot reported and every check passed.
export const ALL_PASSED: CheckRun[] = [
    run("CodeRabbit"),
    run("Greptile Review"),
    run("pullfrog"),
    run("main"),
    run("Fallow"),
];

let next = 0;

export function comment(author: string, body: string, createdAt = COMMITTED_AT): ThreadComment {
    next += 1;
    return { id: `c${next}`, body, url: `https://example.test/pull/7#c${next}`, author, createdAt };
}

export function thread(
    comments: ThreadComment[],
    change: Partial<ReviewThread> = {},
): ReviewThread {
    next += 1;
    return {
        id: `t${next}`,
        path: "src/a.ts",
        subjectType: "LINE",
        line: 12,
        startLine: null,
        side: "RIGHT",
        resolved: false,
        outdated: false,
        comments,
        ...change,
    };
}

export function review(author: string, body: string, change: Partial<Review> = {}): Review {
    return {
        id: "r1",
        author,
        state: "COMMENTED",
        commit: HEAD,
        body,
        url: "https://example.test/pull/7#review-r1",
        ...change,
    };
}

export function externalReply(attempt: number, finding: string, state: string): string {
    const marker = renderMarker({
        kind: "resolution",
        attempt: `linear:DOT-7:external-review:${attempt}`,
        finding,
        state,
    });
    return `Status: not published (refuted): the guard already covers it\n${marker}`;
}

// The real first lines of review bot comments on pull requests #96–#110 of this repository.
export const FIRST_LINES = {
    coderabbitMajor: [
        "<!-- coderabbit-ai-generated:v1 -->",
        "",
        '**<picture><img src="https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/major-16.svg" width="16" height="16" align="absmiddle" alt=""></picture> Major** · **Functional Correctness** · **Quick win**',
    ].join("\n"),
    coderabbitMinor: [
        "<!-- coderabbit-ai-generated:v1 -->",
        "",
        '**<picture><img src="https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/amber-16.svg" width="16" height="16" align="absmiddle" alt=""></picture> Minor** · **Functional Correctness** · **Quick win**',
    ].join("\n"),
    greptileP1:
        '<a href=""><img alt="P1" src="https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg?v=9" align="top"></a> **Retries can skip verification**',
    greptileP2:
        '<a href=""><img alt="P2" src="https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9" align="top"></a> **Deferred tests can block closing**',
} as const;
