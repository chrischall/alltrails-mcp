# Changelog

## [2.0.0](https://github.com/chrischall/alltrails-mcp/compare/v1.1.0...v2.0.0) (2026-07-08)


### ⚠ BREAKING CHANGES

* the alltrails_list_trails_by_state and alltrails_list_trails_by_country tools are removed. Use alltrails_search to find trails for a location.

### Features

* alltrails_get_list_items — the trails saved in a list ([#23](https://github.com/chrischall/alltrails-mcp/issues/23)) ([daf2fb8](https://github.com/chrischall/alltrails-mcp/commit/daf2fb843f908e9b27ae9ec2e4c3fda1c5199501))
* alltrails_resolve_location — resolve a place name to AllTrails location records ([#27](https://github.com/chrischall/alltrails-mcp/issues/27)) ([949a647](https://github.com/chrischall/alltrails-mcp/commit/949a647a39961fa6388ac9d72d220e5b12d1c6e0))
* remove list_trails_by_state / list_trails_by_country (endpoint retired) ([#29](https://github.com/chrischall/alltrails-mcp/issues/29)) ([360d8a1](https://github.com/chrischall/alltrails-mcp/commit/360d8a1dc0fa89d929851f0c14f0cd1b10171853)), closes [#24](https://github.com/chrischall/alltrails-mcp/issues/24)


### Documentation

* correct alltrails_get_list_items compact field list ([#28](https://github.com/chrischall/alltrails-mcp/issues/28)) ([3a46db2](https://github.com/chrischall/alltrails-mcp/commit/3a46db240d09f4b17558fbd1bb2942015e03a4b5)), closes [#25](https://github.com/chrischall/alltrails-mcp/issues/25)

## [1.1.0](https://github.com/chrischall/alltrails-mcp/compare/v1.0.0...v1.1.0) (2026-07-07)


### Features

* adopt @chrischall/mcp-utils 0.12.0 (scrape subpath) ([#21](https://github.com/chrischall/alltrails-mcp/issues/21)) ([8643fc3](https://github.com/chrischall/alltrails-mcp/commit/8643fc37b7ee40ea43fc103701a3e72875e7fa94))


### Refactor

* adopt pruneUndefined + parseLenient (+ scrape decodeHtmlEntities) ([#18](https://github.com/chrischall/alltrails-mcp/issues/18)) ([729dc0c](https://github.com/chrischall/alltrails-mcp/commit/729dc0c178090cf71138e03a83fad096becf9db8))


### Documentation

* document first-party dependency-bump label exception ([#22](https://github.com/chrischall/alltrails-mcp/issues/22)) ([60c1a0d](https://github.com/chrischall/alltrails-mcp/commit/60c1a0dc6d998365f7d66b9497c61163222d53ad))
* fix stale transport/SKILL notes + document alltrails_search types-without-query ([#20](https://github.com/chrischall/alltrails-mcp/issues/20)) ([a51bd4f](https://github.com/chrischall/alltrails-mcp/commit/a51bd4f798713708ae373ee894c03a3395cc9f0e))

## [1.0.0](https://github.com/chrischall/alltrails-mcp/compare/v0.3.0...v1.0.0) (2026-07-03)


### ⚠ BREAKING CHANGES

* ALLTRAILS_COOKIE is no longer honored; the fetchproxy Transporter extension and a signed-in alltrails.com tab are required.

### Features

* require fetchproxy — route every API request through the bridge ([#15](https://github.com/chrischall/alltrails-mcp/issues/15)) ([a72a2d1](https://github.com/chrischall/alltrails-mcp/commit/a72a2d1ee1897b7b02290037619aa720e389e159))

## [0.3.0](https://github.com/chrischall/alltrails-mcp/compare/v0.2.0...v0.3.0) (2026-07-02)


### Features

* compact projections for photos, search, and activity feed (from live captures) ([#6](https://github.com/chrischall/alltrails-mcp/issues/6)) ([da6d7ae](https://github.com/chrischall/alltrails-mcp/commit/da6d7ae00fb2e5e481a44ca324d677a050bcb347))
* GPX export tool built from offline-detail route geometry ([#10](https://github.com/chrischall/alltrails-mcp/issues/10)) ([9b987f2](https://github.com/chrischall/alltrails-mcp/commit/9b987f21a2923e1c960ea19ebbd75d5082af6d06))


### Bug Fixes

* encode photo image url params and decode html entities in feed descriptions ([#8](https://github.com/chrischall/alltrails-mcp/issues/8)) ([ffc940e](https://github.com/chrischall/alltrails-mcp/commit/ffc940ef50694640427f0ec79ce648a7dc8a87b5)), closes [#7](https://github.com/chrischall/alltrails-mcp/issues/7)
* map GPX elevations by encoded point index; enable auto-merge in ruleset script ([#13](https://github.com/chrischall/alltrails-mcp/issues/13)) ([58ef6df](https://github.com/chrischall/alltrails-mcp/commit/58ef6df40fd6e69eadd5dd76283d52dbf1f9ceeb)), closes [#11](https://github.com/chrischall/alltrails-mcp/issues/11)
* route free-text search through the explore suggestions endpoint ([#12](https://github.com/chrischall/alltrails-mcp/issues/12)) ([793f15b](https://github.com/chrischall/alltrails-mcp/commit/793f15b24418b4eb8ae079738cd91f9a4f310487))

## [0.2.0](https://github.com/chrischall/alltrails-mcp/compare/v0.1.0...v0.2.0) (2026-07-02)


### Features

* transform template into unofficial AllTrails MCP server ([#2](https://github.com/chrischall/alltrails-mcp/issues/2)) ([5d8bc74](https://github.com/chrischall/alltrails-mcp/commit/5d8bc745392e50405b57cc68f8c85c185ceac3de))


### Bug Fixes

* drop empty location object from compact trail detail ([#5](https://github.com/chrischall/alltrails-mcp/issues/5)) ([f7a75f4](https://github.com/chrischall/alltrails-mcp/commit/f7a75f4a337f2bb2055cd51bfcba186f9c22f260))

## 0.1.0

Initial release. Unofficial AllTrails MCP server providing read-only tools for:

- Trail search (`alltrails_search`) and bulk listing by state/country.
- Trail detail, reviews, photos, and weather.
- The signed-in user's profile, saved lists, completed trails, and activity feed.

Auth follows the fleet's browser-bootstrap pattern: it reuses a signed-in
alltrails.com session cookie (captured via the fetchproxy extension or supplied
through `ALLTRAILS_COOKIE`) to satisfy AllTrails' DataDome bot protection.
