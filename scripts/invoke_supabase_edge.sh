#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <function-slug> <json-payload>" >&2
  exit 64
fi

function_slug="$1"
payload="$2"

if ! [[ "$function_slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Invalid Edge Function slug: $function_slug" >&2
  exit 64
fi

: "${SUPABASE_URL:?Missing SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY}"

max_attempts="${EDGE_RETRY_ATTEMPTS:-4}"
base_delay="${EDGE_RETRY_BASE_DELAY:-10}"
request_max_time="${EDGE_REQUEST_MAX_TIME:-100}"

for value_name in max_attempts base_delay request_max_time; do
  value="${!value_name}"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "Invalid numeric retry setting $value_name=$value" >&2
    exit 64
  fi
done

if (( max_attempts < 1 || max_attempts > 8 )); then
  echo "EDGE_RETRY_ATTEMPTS must be between 1 and 8" >&2
  exit 64
fi
if (( request_max_time < 1 || request_max_time > 300 )); then
  echo "EDGE_REQUEST_MAX_TIME must be between 1 and 300 seconds" >&2
  exit 64
fi

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

for (( attempt=1; attempt<=max_attempts; attempt++ )); do
  : > "$response_file"
  set +e
  http_code="$(curl --silent --show-error \
    --connect-timeout 15 \
    --max-time "$request_max_time" \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --request POST \
    --url "${SUPABASE_URL%/}/functions/v1/$function_slug" \
    --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    --header 'Content-Type: application/json' \
    --data "$payload")"
  curl_status=$?
  set -e

  if [[ "$curl_status" -eq 0 && "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    cat "$response_file"
    exit 0
  fi

  response_body="$(cat "$response_file")"
  if [[ -n "$response_body" ]]; then
    printf 'Supabase Edge %s attempt %d/%d response (HTTP %s): %s\n' \
      "$function_slug" "$attempt" "$max_attempts" "${http_code:-000}" "$response_body" >&2
  else
    printf 'Supabase Edge %s attempt %d/%d failed (curl=%d, HTTP %s)\n' \
      "$function_slug" "$attempt" "$max_attempts" "$curl_status" "${http_code:-000}" >&2
  fi

  transient=false
  if [[ "$curl_status" -ne 0 ]]; then
    transient=true
  else
    case "$http_code" in
      408|425|429|5??) transient=true ;;
    esac
  fi

  if [[ "$transient" != true ]]; then
    echo "Permanent Supabase Edge failure; retry skipped." >&2
    exit 1
  fi

  if (( attempt < max_attempts )); then
    delay=$((attempt * base_delay))
    echo "Transient Supabase Edge failure; retrying in ${delay}s." >&2
    sleep "$delay"
  fi
done

echo "Supabase Edge call failed after $max_attempts transient attempts." >&2
exit 1
