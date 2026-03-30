#!/bin/bash
# Vikunja MCP server startup
# Gets fresh JWT token, starts server, refreshes token every 5 minutes in background

source /home/luka/.config/coworker-agent/env.common

get_token() {
  curl -s -X POST "${VIKUNJA_API_URL}/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${VIKUNJA_USERNAME}\",\"password\":\"${VIKUNJA_PASSWORD}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
}

export VIKUNJA_URL="${VIKUNJA_API_URL}"
export VIKUNJA_API_TOKEN="$(get_token)"

exec node /home/luka/workspace-private/vikunja-mcp/dist/index.js
