# Changelog

## 0.1.0

Initial release. Unofficial AllTrails MCP server providing read-only tools for:

- Trail search (`alltrails_search`) and bulk listing by state/country.
- Trail detail, reviews, photos, and weather.
- The signed-in user's profile, saved lists, completed trails, and activity feed.

Auth follows the fleet's browser-bootstrap pattern: it reuses a signed-in
alltrails.com session cookie (captured via the fetchproxy extension or supplied
through `ALLTRAILS_COOKIE`) to satisfy AllTrails' DataDome bot protection.
