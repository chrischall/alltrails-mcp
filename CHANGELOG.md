# Changelog

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
