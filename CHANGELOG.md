# Changelog

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
