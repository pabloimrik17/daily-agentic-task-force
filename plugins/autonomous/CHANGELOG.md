# Changelog

## [2.6.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.5.0...autonomous--v2.6.0) (2026-11-27)


### Features

* **autonomous:** add the code review stage ([#115](https://github.com/pabloimrik17/daily-agentic-task-force/issues/115)) ([d01640a](https://github.com/pabloimrik17/daily-agentic-task-force/commit/d01640aef9817fcba363118c4fadb8e0bd9ab16d))
* **autonomous:** add the review team skill ([#110](https://github.com/pabloimrik17/daily-agentic-task-force/issues/110)) ([4ad5455](https://github.com/pabloimrik17/daily-agentic-task-force/commit/4ad5455c2f2d71067f5bfd4bdea5b277cb1d518f))
* **autonomous:** declare the stages that have no implementation yet (DOT-171) ([#116](https://github.com/pabloimrik17/daily-agentic-task-force/issues/116)) ([4459e27](https://github.com/pabloimrik17/daily-agentic-task-force/commit/4459e2744067a202951484c901de17627f9670a7))


### Code Refactoring

* **autonomous:** simplify the stage definitions and the transition table ([#108](https://github.com/pabloimrik17/daily-agentic-task-force/issues/108)) ([db9c827](https://github.com/pabloimrik17/daily-agentic-task-force/commit/db9c82771a2a87a18f2dd9b6cfd6c09a7024bbed))
* purge comment noise ([#107](https://github.com/pabloimrik17/daily-agentic-task-force/issues/107)) ([50aa734](https://github.com/pabloimrik17/daily-agentic-task-force/commit/50aa734b63056dd2aea579a326ba7e186f7bc64a))

## [2.5.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.4.0...autonomous--v2.5.0) (2026-11-22)


### Features

* **autonomous:** add the verification stage ([#105](https://github.com/pabloimrik17/daily-agentic-task-force/issues/105)) ([4ddeb93](https://github.com/pabloimrik17/daily-agentic-task-force/commit/4ddeb9333358434fc391de7664568d38b9477767))

## [2.4.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.3.0...autonomous--v2.4.0) (2026-11-20)


### Features

* **autonomous:** add the implementation stage ([#100](https://github.com/pabloimrik17/daily-agentic-task-force/issues/100)) ([109b7e3](https://github.com/pabloimrik17/daily-agentic-task-force/commit/109b7e3daab00c49030134983f4a10146ab1024a))
* **autonomous:** add the loop stop command ([#94](https://github.com/pabloimrik17/daily-agentic-task-force/issues/94)) ([c2a9c6b](https://github.com/pabloimrik17/daily-agentic-task-force/commit/c2a9c6b7e24fda76f7326037674dac6ba0542df3))
* **autonomous:** evaluate the active account in the quota gate ([#96](https://github.com/pabloimrik17/daily-agentic-task-force/issues/96)) ([4e3b017](https://github.com/pabloimrik17/daily-agentic-task-force/commit/4e3b017c9fd41a8313d95efd54cedacbf971f003))


### Bug Fixes

* **autonomous:** support the OpenSpec 2 skills in the proposal stage ([#99](https://github.com/pabloimrik17/daily-agentic-task-force/issues/99)) ([a293f67](https://github.com/pabloimrik17/daily-agentic-task-force/commit/a293f6784c5bc609690aeec990a318d02ea7540e))

## [2.3.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.2.0...autonomous--v2.3.0) (2026-11-15)


### Features

* **autonomous:** add the loop command and slot limits ([#83](https://github.com/pabloimrik17/daily-agentic-task-force/issues/83)) ([dfd4035](https://github.com/pabloimrik17/daily-agentic-task-force/commit/dfd40354fa5861166e3c750132a356e91919e713))
* **autonomous:** mark the tasks left for the human with triage-me ([#84](https://github.com/pabloimrik17/daily-agentic-task-force/issues/84)) ([f217b6d](https://github.com/pabloimrik17/daily-agentic-task-force/commit/f217b6deada83e3680e3f597bb7a97bd6bdd09fa))
* **autonomous:** open a draft pull request per task and log each attempt on it ([#86](https://github.com/pabloimrik17/daily-agentic-task-force/issues/86)) ([cef2d6e](https://github.com/pabloimrik17/daily-agentic-task-force/commit/cef2d6ed5a2e79195ab838114f636530a74837a2))
* **autonomous:** run proposal preparation as a stage ([#87](https://github.com/pabloimrik17/daily-agentic-task-force/issues/87)) ([c0daf75](https://github.com/pabloimrik17/daily-agentic-task-force/commit/c0daf758be664bdf9cc37b903c357f269653989d))


### Bug Fixes

* **autonomous:** read OpenUsage's document after an account-error exit (DOT-112) ([#73](https://github.com/pabloimrik17/daily-agentic-task-force/issues/73)) ([ce30fe5](https://github.com/pabloimrik17/daily-agentic-task-force/commit/ce30fe589dca81b5b3b44d5c860ffffc2c090c04))
* **autonomous:** read the openusage.limits.v2 document of OpenUsage 0.8 ([#91](https://github.com/pabloimrik17/daily-agentic-task-force/issues/91)) ([4463f7f](https://github.com/pabloimrik17/daily-agentic-task-force/commit/4463f7fd3da067360c758fe0d37b6bfc3ae2d650))

## [2.2.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.1.0...autonomous--v2.2.0) (2026-11-06)


### Features

* **autonomous:** run the grill-me stage and persist its definition (DOT-110) ([#56](https://github.com/pabloimrik17/daily-agentic-task-force/issues/56)) ([993d6fb](https://github.com/pabloimrik17/daily-agentic-task-force/commit/993d6fbd3cb0e6f79ebfb4fe0b0e562dc13d6cbb))
* **autonomous:** split autonomy and stage labels and add the grill transition (DOT-110) ([#55](https://github.com/pabloimrik17/daily-agentic-task-force/issues/55)) ([45a3631](https://github.com/pabloimrik17/daily-agentic-task-force/commit/45a3631a827c262dff06ed228f0b74d1e5ee7dd2))


### Code Refactoring

* stop exporting types that are only used in their own file ([#51](https://github.com/pabloimrik17/daily-agentic-task-force/issues/51)) ([f186962](https://github.com/pabloimrik17/daily-agentic-task-force/commit/f18696219373a43c8e78c61efcc37bde865edfda))

## [2.1.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v2.0.0...autonomous--v2.1.0) (2026-10-18)


### Features

* **autonomous:** manage stage sessions through Agent of Empires (DOT-109) ([#37](https://github.com/pabloimrik17/daily-agentic-task-force/issues/37)) ([a8aeb5a](https://github.com/pabloimrik17/daily-agentic-task-force/commit/a8aeb5a1c08130a21ab8bf95b6f2cc2b628de8b5))

## [2.0.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v1.2.0...autonomous--v2.0.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **autonomous:** autonomous.config.v1 now requires a selection block ({ model, effort }). A configuration file without it is rejected.

### Features

* **autonomous:** select the next work unit after triage ([#29](https://github.com/pabloimrik17/daily-agentic-task-force/issues/29)) ([7dfc8cb](https://github.com/pabloimrik17/daily-agentic-task-force/commit/7dfc8cb2a1e3e10d88af2604a16a7b03719e3e1e))

## [1.2.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v1.1.0...autonomous--v1.2.0) (2026-10-04)


### Features

* **autonomous:** ask the triage questions after a run and apply the answers (DOT-104) ([#22](https://github.com/pabloimrik17/daily-agentic-task-force/issues/22)) ([d641835](https://github.com/pabloimrik17/daily-agentic-task-force/commit/d64183584348084fedeba03518b3445d6f6ff9c4))

## [1.1.0](https://github.com/pabloimrik17/daily-agentic-task-force/compare/autonomous--v1.0.0...autonomous--v1.1.0) (2026-09-30)


### Features

* **autonomous:** add the label contract and the label-triage step (DOT-82) ([#8](https://github.com/pabloimrik17/daily-agentic-task-force/issues/8)) ([b350753](https://github.com/pabloimrik17/daily-agentic-task-force/commit/b35075388682ca2d04b99b499dd6db97a9800b86))
* **autonomous:** add the labelling-new-tasks skill (DOT-103) ([#15](https://github.com/pabloimrik17/daily-agentic-task-force/issues/15)) ([442757c](https://github.com/pabloimrik17/daily-agentic-task-force/commit/442757c857a5177e9856f467833e8df89e33c4af))


### Bug Fixes

* tighten marketplace validation and close the verify findings ([#14](https://github.com/pabloimrik17/daily-agentic-task-force/issues/14)) ([8ca0c45](https://github.com/pabloimrik17/daily-agentic-task-force/commit/8ca0c45b7ad35e6ebfd8cf33546652220521e93e))

## 1.0.0 (2026-09-25)


### Features

* **autonomous:** add the autonomous plugin and its quota gate ([#4](https://github.com/pabloimrik17/daily-agentic-task-force/issues/4)) ([05cf0d6](https://github.com/pabloimrik17/daily-agentic-task-force/commit/05cf0d678ec63d26964d928a17a2ce696125dc8d))
