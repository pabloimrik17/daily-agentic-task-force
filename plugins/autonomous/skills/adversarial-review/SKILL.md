---
name: adversarial-review
description: Use only when a request names an adversarial review, or a stage or another skill says to follow the adversarial review. Never use it for a request to review a pull request, change or code that does not name an adversarial review.
---

# Adversarial review

You are the orchestrator of an adversarial review: a reviewer reports
findings, you triage them, other teammates try to refute each one you keep,
others fix those that survive, and others judge each fix. Nobody judges their
own work.

## What the caller supplies

Take each of these from your caller, the stage, skill or person that asked for
the adversarial review:

- the subject of the review;
- the references it is checked against;
- the procedure of the report;
- the scale of severities and its floor;
- the later reviews a finding can be passed on to;
- where the record of the findings is kept;
- whether a human follows the review.

If one is missing, ask the caller, or the person who asked for the review,
before the report starts. Never guess the floor.

## The phases

Run the phases in this order: the report, the finding triage, the refutation,
the fix and the fix check. A round runs each phase once: no second report
follows the fixes, even when every fix passes its fix check.

## Nobody judges their own work

- Start each phase's teammates fresh.
- The reporter only reads.
- A finding is refuted by teammates other than its reporter.
- A fix is judged by teammates other than its fixer.
- You choose how many teammates each phase takes, and the model and effort of
  every teammate; choose the reporter's from the complexity of the subject.
- You are the only one that commits.

## The report

The reporter follows the caller's procedure and reports each finding with its
severity, on the caller's scale, and its evidence: a file and line, or an
artifact section. It changes no file of the subject.

## The finding triage

Make the reported findings your own:

- Merge findings that share one root cause, and split a finding that mixes
  concerns. Each finding you make names the reported findings it comes from.
- Send each finding, with its reason, to one destination: fix it now, pass it
  on to a later review the caller named, defer it to a follow-up task, or
  dismiss it.
- Never change a finding's severity, even when you judge it lower.
- You may dismiss a finding below the floor that the subject plainly
  contradicts, with its reason, without a refutation.

## The severity floor

Send a finding at or above the floor only to fix. It leaves the review
unfixed only when the refutation shows it does not hold.

Your caller may name the findings that go to a later review whatever their
severity. Follow it: such a finding goes to that later review, and the floor
holds for every other finding.

## A human changes the finding triage

When the caller says a human follows the review, show them the finding triage,
each finding with its destination and reason, before any refutation starts,
and apply their changes. When no human follows it, write each decision and its
reason in the record as an assumption.

## The refutation

- Have teammates try to refute each finding sent to fix or to defer. Never
  refute a finding passed on or dismissed.
- A finding survives only with its reproduction: a test that fails because of
  it, when a test can show it; otherwise, the exact text it contradicts or
  misses, beside the place that does so.
- A finding with no reproduction does not survive. Write in the record why it
  does not hold.
- Once the record holds a reproduction test's path and its text, remove the
  test from the working tree, so no finding's failing test is in the tree
  while another finding is fixed, checked, committed or pushed. A test of a
  finding left unfixed, because it was refuted or deferred, never comes back
  and never reaches a commit.

## The fix

A teammate fixes each surviving finding sent to fix. It never changes the
finding's reproduction test: the test stays with the fix as a regression test
and is committed with it. Before the fixer starts, put that test back in the
working tree from the record.

Run the fixes one at a time: a fix, its fix checks and the commit of an
accepted fix end before the next fixer starts, so each fix check judges a tree
that holds no other fix.

## The fix check

Teammates other than the fixer judge each fix. Accept it only when:

- its reproduction no longer holds;
- its reproduction test, if it has one, fails without the fix and passes with
  it;
- the fix does no more than its finding asks.

Commit each accepted fix. A fix gets at most two fix checks: send a fix
rejected by its first fix check back to the fix with the reasons. A fix
rejected by its second fix check blocks the review when no human follows it,
and goes to the human otherwise; either way, name the finding and the
rejections.

## Follow-up tasks

A deferred finding that survives the refutation becomes a proposed follow-up
task in the record, with a title, its reason, the finding it comes from and its
reproduction.
Whether a follow-up task is created, and where, is the caller's to decide.

## The record of the findings

Keep the record where the caller says. It holds every reported finding with
its severity, its destination and reason, the refutation's outcome and its
reproduction, and, for a fixed one, the fix's commit and its fix check
verdicts. Build what the caller writes for a person or the next agent from the
record.
