# Changelog

## [1.3.1](https://github.com/jegork/rusty-bot/compare/v1.3.0...v1.3.1) (2026-05-03)


### Bug Fixes

* **review:** apply per-model temperature constraints across all agent paths ([#131](https://github.com/jegork/rusty-bot/issues/131)) ([d436355](https://github.com/jegork/rusty-bot/commit/d436355c0efe08c18e20fe1466808f2228cc26ae))

## [1.3.0](https://github.com/jegork/rusty-bot/compare/v1.2.0...v1.3.0) (2026-05-03)


### Features

* add @rusty-bot/cli and multi-model review stack ([#111](https://github.com/jegork/rusty-bot/issues/111)) ([2177a01](https://github.com/jegork/rusty-bot/commit/2177a01e8f6bd7134c54b99b75cef45c8f318a3e))
* add GitLab + GitLab CI integration ([#108](https://github.com/jegork/rusty-bot/issues/108)) ([3e1e4fd](https://github.com/jegork/rusty-bot/commit/3e1e4fdf02516a2a3a5c8d32176236aadf7fda00))
* **cli:** add @rusty-bot/cli for local terminal-based reviews ([#106](https://github.com/jegork/rusty-bot/issues/106)) ([f94368e](https://github.com/jegork/rusty-bot/commit/f94368e62524b4d3ecc6ca545ef66388036e3b93))


### Bug Fixes

* **ci:** set kimi-k2.5 review pass temperature to 1 ([#130](https://github.com/jegork/rusty-bot/issues/130)) ([fdca1b6](https://github.com/jegork/rusty-bot/commit/fdca1b639f148012e83fe7d4b922f30d3b8bcfb3))
* **formatter:** show all reviewer models in summary footer ([#128](https://github.com/jegork/rusty-bot/issues/128)) ([00c9366](https://github.com/jegork/rusty-bot/commit/00c9366df2c6ca033309860b8fa605829fee1636))

## [1.2.0](https://github.com/jegork/rusty-bot/compare/v1.1.0...v1.2.0) (2026-05-02)


### Features

* add graph-ranked review context ([8660e55](https://github.com/jegork/rusty-bot/commit/8660e557d5336ca88e1ed59274fd543b026c014d))
* add tiered tree-sitter context expansion ([5caa297](https://github.com/jegork/rusty-bot/commit/5caa2979684086aa08086794229ec54c5a8b9f5c))
* tighten review finding filters ([c10f8ad](https://github.com/jegork/rusty-bot/commit/c10f8ad11cf56f62b6c5e459fd1f8792b66fad4c))

## [1.1.0](https://github.com/jegork/rusty-bot/compare/v1.0.1...v1.1.0) (2026-05-02)


### Features

* incremental review against last-reviewed state ([cd180ef](https://github.com/jegork/rusty-bot/commit/cd180ef34ca47246ce6aa340f0f961f5883e3910))
* incremental review against last-reviewed state ([971482b](https://github.com/jegork/rusty-bot/commit/971482b6db4d53516968ae046dd9086df7066b0d))
* rewrite non-conventional PR titles into conventional commits ([a4014ef](https://github.com/jegork/rusty-bot/commit/a4014ef86abf31915e3122ba52f8e3249a548e87))
* rewrite non-conventional PR titles via RUSTY_RENAME_TITLE_TO_CONVENTIONAL ([26af07d](https://github.com/jegork/rusty-bot/commit/26af07df0570f4498bd557c2665d90982c26ad33))
* support adaptive multi-model consensus ([6baf183](https://github.com/jegork/rusty-bot/commit/6baf183e2f31efdf1d23131e93636229d731be1d))
* support per-pass models and adaptive consensus passes ([5b50200](https://github.com/jegork/rusty-bot/commit/5b50200c934ebc1e267fb96c14137fe49be6727f))


### Bug Fixes

* configure provider cache options dynamically ([a7edd72](https://github.com/jegork/rusty-bot/commit/a7edd72965154f6d5918e5b3794d1bcc41922b1c))
* configure provider cache options dynamically ([3e047a3](https://github.com/jegork/rusty-bot/commit/3e047a351001ac897456315681a56e9b4e4122ba))
* constrain reviewer finding paths to the chunk's file set ([9dc11b7](https://github.com/jegork/rusty-bot/commit/9dc11b72fe171e886b419050bd8fa0d039776047))
* constrain reviewer finding paths to the chunk's file set ([ba4e344](https://github.com/jegork/rusty-bot/commit/ba4e344c35e908d64ec6e9750296abf6b207f03d))
* drop findings that don't anchor to the diff ([9223458](https://github.com/jegork/rusty-bot/commit/92234585e8d21afaa388d192b36994ebdeb7057b))
* drop findings that don't anchor to the diff before posting inline comments ([b44af97](https://github.com/jegork/rusty-bot/commit/b44af97f672a5da82b9a6bb922d4d9bebce895fc))
* harden title rewriting against length limits and empty fields ([d3c5bc2](https://github.com/jegork/rusty-bot/commit/d3c5bc284d69ef25e0aeebdc85da4e3939f3f2a9))
* prefix docs base path on getting-started links ([e894f55](https://github.com/jegork/rusty-bot/commit/e894f55947868e7c5a47733f50d5dba0e1168b25))
* prefix docs base path on getting-started links ([040b9ff](https://github.com/jegork/rusty-bot/commit/040b9ff0715940536d4d49a5a6c520adc37e28af))
* preserve droppedFindings through mergeResults ([9e905f2](https://github.com/jegork/rusty-bot/commit/9e905f27a736649d4875ae9b4ca6cbb5d0f9767e))
* preserve droppedFindings through mergeResults ([8e30fe0](https://github.com/jegork/rusty-bot/commit/8e30fe09c1e7380b4eabf86f14abf346bf25d27b)), closes [#84](https://github.com/jegork/rusty-bot/issues/84)
* retry consensus passes on transient LLM errors ([4bd5c06](https://github.com/jegork/rusty-bot/commit/4bd5c06dfa4364a7e262d22575567042ec762ea6))
* retry consensus passes on transient LLM errors with bounded backoff ([bf950db](https://github.com/jegork/rusty-bot/commit/bf950dbf3b4c253188d1f96cee8ad86bca4f708c))
* truncate generated PR description to ADO 4000-char limit ([432a797](https://github.com/jegork/rusty-bot/commit/432a797f8e6fba32f7383ae2ed890da9d9efa788))
* truncate generated PR description to ADO 4000-char limit ([0083cdd](https://github.com/jegork/rusty-bot/commit/0083cdd3e22b5a11148309422c2c6917d63f7637)), closes [#86](https://github.com/jegork/rusty-bot/issues/86)
* use current agent default options ([59733ea](https://github.com/jegork/rusty-bot/commit/59733ea7256374ff1673cbccdb5899dd01f34b64))


### Documentation

* add MCP tools guide and document missing env vars ([f122739](https://github.com/jegork/rusty-bot/commit/f12273936a79330872671d9291a69e8c9d4d250e))
* add multi-model review preset ([9aebc37](https://github.com/jegork/rusty-bot/commit/9aebc37f0a955c43e2afb654776aa61f11a39cf7))
* add PR title rewriting guide and env-var reference ([dfaf1bc](https://github.com/jegork/rusty-bot/commit/dfaf1bcde48f15a4ba0ac192fcc6b9ce3b7faad2))
* address bot review on mcp-tools guide and env-vars phrasing ([d787756](https://github.com/jegork/rusty-bot/commit/d787756c16d45e10c3385c804788b1c0c528ca92))
* correct mcp env-inheritance — secrets must live in the env block ([62c6f69](https://github.com/jegork/rusty-bot/commit/62c6f69f6eeb14064b2feccda56f8e952657682a))
* document PR title rewriting feature ([577e700](https://github.com/jegork/rusty-bot/commit/577e7002574a08a9bb5331a3522f53e1e4dde7d8))
* link landing-page feature cards and richer getting-started next steps ([a63e920](https://github.com/jegork/rusty-bot/commit/a63e920b5328ce730e9101d20730ac6875b6240e))
* polish landing page, add MCP tools guide, document missing env vars ([4b51886](https://github.com/jegork/rusty-bot/commit/4b518865779793ede5096f1cd450e2cbf2be7f76))

## [1.0.1](https://github.com/jegork/ai-review/compare/v1.0.0...v1.0.1) (2026-04-24)


### Documentation

* full documentation overhaul ([dbf0520](https://github.com/jegork/ai-review/commit/dbf052061cb2bfd88ff26d6650e3b6173a1f9770))
* full documentation overhaul — providers, guides, env-vars ([f2ef26e](https://github.com/jegork/ai-review/commit/f2ef26e49555506d2bca9a0492e3245634e40263))

## 1.0.0 (2026-04-23)


### Features

* consensus voting — multi-pass review with majority filtering ([f43d4da](https://github.com/jegork/ai-review/commit/f43d4dafbc31ea43f9803c7a88dd10afcca33792))
* integrate semgrep as deterministic security pre-pass ([0286243](https://github.com/jegork/ai-review/commit/028624367f568b89fb60eb1d966e12e8e101c396)), closes [#5](https://github.com/jegork/ai-review/issues/5)
* integrate Semgrep as deterministic security pre-pass ([1fcd6cb](https://github.com/jegork/ai-review/commit/1fcd6cb159e557963c5e1d00bf91e349d9e4980f))
* tree-sitter context expansion with function boundaries ([#6](https://github.com/jegork/ai-review/issues/6)) ([8ec7e3f](https://github.com/jegork/ai-review/commit/8ec7e3f3c272950b153c52cdd2cfcdd285195cbb))


### Bug Fixes

* build action image from Dockerfile ([424cf40](https://github.com/jegork/ai-review/commit/424cf409eafad11a2edc893947ca40199088d2e5))
* build action image from Dockerfile instead of resolving github.action_ref ([7763a0e](https://github.com/jegork/ai-review/commit/7763a0e4d626a407ad4da65201ab97a56a4cea34))
* default workDir to process.cwd() in semgrep runner ([12a3313](https://github.com/jegork/ai-review/commit/12a331367120dbd32c039730f84d47be2f19dc17))
* install charset-normalizer for opengrep rule downloads ([0c87c1e](https://github.com/jegork/ai-review/commit/0c87c1ec6e753f758c7868c0d323bac3bf204044))
* install charset-normalizer for opengrep's bundled requests lib ([ad9d1bd](https://github.com/jegork/ai-review/commit/ad9d1bdefbf889fc4c5a15e32924f9fcf979f04b))
* pass target files as positional args instead of --target-list ([eb137d9](https://github.com/jegork/ai-review/commit/eb137d9a2c4208cd617e981acccfdfdfc92fd647))
* pass target files as positional args to opengrep ([d016d9d](https://github.com/jegork/ai-review/commit/d016d9d3377f023f5de8ca16c389b7a927e1400d))
* pin charset-normalizer and chardet versions in Dockerfile ([193c9fd](https://github.com/jegork/ai-review/commit/193c9fd8658236be362bb4023c5c3d58fbc6605b))
* pin opengrep binary in Dockerfile, add missing tests ([fd6ff27](https://github.com/jegork/ai-review/commit/fd6ff27c8dfa37c9c343947da85ad1a9ac4525d7))
* prevent summary-only findings from being invisible to consensus pipeline ([4ed135a](https://github.com/jegork/ai-review/commit/4ed135aca053ad5bd0f3c0ef4cead528c0ccbb3d))
* show error instead of 'clean' when semgrep scan fails ([f5150c5](https://github.com/jegork/ai-review/commit/f5150c58b61aff1fb89a3d4155926295877171d3))
* show error over generic not-available message in opengrep stats ([923308e](https://github.com/jegork/ai-review/commit/923308ea794e440c0dcd746f209c0ed356330c5c))
* use 4-backtick fences for semgrep snippets and wire workDir through to execFile ([15e47e3](https://github.com/jegork/ai-review/commit/15e47e3bf5c41a210a4ee158b3c9274a25f707f5))


### Refactor

* export filterOpenGrepForFiles and test against real impl ([df8804d](https://github.com/jegork/ai-review/commit/df8804d268478c69c6679e9be0772d8cfddac23a))
* switch from semgrep to opengrep (LGPL-2.1) ([6334e56](https://github.com/jegork/ai-review/commit/6334e56bc59109ca2acb95d2bf159f6e546bc00b)), closes [#5](https://github.com/jegork/ai-review/issues/5)


### Documentation

* add semgrep pre-scan section to README ([668ecbd](https://github.com/jegork/ai-review/commit/668ecbd94620315f3710576271a4bb4e91737c60))
* document consensus voting in README ([a633579](https://github.com/jegork/ai-review/commit/a633579b7616e2cc60b9d88d5b56f23c14f5b342))
* document tree-sitter context expansion in README ([4d0573e](https://github.com/jegork/ai-review/commit/4d0573e0645894ad1ed73fa2063a870d31e0feed))
* scaffold Starlight site and Pages deploy workflow ([851d48d](https://github.com/jegork/ai-review/commit/851d48dc893fc3d0e956f317c986aaea70c64b06))
* scaffold Starlight site and Pages deploy workflow ([79f1b90](https://github.com/jegork/ai-review/commit/79f1b9072cddcbb2f0247775da7266866926367e))
