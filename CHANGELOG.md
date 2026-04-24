# Changelog

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
