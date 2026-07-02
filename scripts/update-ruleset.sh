#!/usr/bin/env bash
# Apply the fleet's main-branch protection to this repo (mirrors ofw-mcp):
#
#   1. Ruleset "Block force-push and deletion on main" — non-fast-forward and
#      branch deletion blocked.
#   2. Ruleset "main protection (PR + ci)" — every change lands via PR, the
#      "ci / ci" status check must pass, strict mode (branch up-to-date with
#      main). No bypass actors; admins are not exempt.
#   3. Repo merge settings — squash-only (merge commits and rebase disabled),
#      head branches auto-deleted on merge.
#
# Requires: gh CLI authenticated with admin access to the repo. Idempotent —
# reruns update the existing rulesets in place.
#
# NOTE: the required check is "ci / ci" (not "ci") because ci.yml calls the
# reusable chrischall/workflows pipeline, which nests the job name.

set -euo pipefail

REPO="${1:-chrischall/alltrails-mcp}"

ruleset_id_by_name() {
  gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$1\") | .id" | head -n1
}

apply_ruleset() {
  local name="$1" payload="$2" id
  id=$(ruleset_id_by_name "$name" || true)
  if [ -n "${id:-}" ]; then
    echo "Updating ruleset '$name' (id $id)"
    gh api -X PUT "repos/$REPO/rulesets/$id" --input - <<<"$payload" >/dev/null
  else
    echo "Creating ruleset '$name'"
    gh api -X POST "repos/$REPO/rulesets" --input - <<<"$payload" >/dev/null
  fi
}

apply_ruleset "Block force-push and deletion on main" '{
  "name": "Block force-push and deletion on main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}'

apply_ruleset "main protection (PR + ci)" '{
  "name": "main protection (PR + ci)",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "ci / ci" } ]
      }
    }
  ]
}'

echo "Setting squash-only merge policy (with auto-merge enabled)"
# allow_auto_merge rides along because the ci ruleset above makes it
# load-bearing: without it, the pipeline's `gh pr merge --auto` fails with
# "Auto merge is not allowed for this repository" once the required check
# exists, and armed PRs sit green-but-open.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true >/dev/null

echo "Done. Verify with: gh api repos/$REPO/rulesets"
