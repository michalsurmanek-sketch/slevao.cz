#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$repo_root/scripts/invoke_supabase_edge.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

output_file=''
args=("$@")
for (( i=0; i<${#args[@]}; i++ )); do
  if [[ "${args[$i]}" == '--output' ]]; then
    output_file="${args[$((i + 1))]}"
    break
  fi
done
[[ -n "$output_file" ]] || { echo 'mock curl: missing --output' >&2; exit 90; }

count_file="${MOCK_COUNT_FILE:?}"
count=0
[[ -f "$count_file" ]] && count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" > "$count_file"

IFS=',' read -r -a responses <<< "${MOCK_RESPONSES:?}"
index=$((count - 1))
if (( index >= ${#responses[@]} )); then
  index=$((${#responses[@]} - 1))
fi
response="${responses[$index]}"

case "$response" in
  network)
    : > "$output_file"
    printf '000'
    exit 7
    ;;
  200)
    printf '{"ok":true,"attempt":%d}' "$count" > "$output_file"
    printf '200'
    ;;
  400)
    printf '{"error":"bad request"}' > "$output_file"
    printf '400'
    ;;
  503)
    printf '{"code":"PGRST002","message":"schema cache unavailable"}' > "$output_file"
    printf '503'
    ;;
  *)
    echo "mock curl: unsupported response $response" >&2
    exit 91
    ;;
esac
MOCK
chmod +x "$tmp_dir/curl"

run_helper() {
  local responses="$1"
  local out_file="$2"
  local err_file="$3"
  local count_file="$4"
  MOCK_RESPONSES="$responses" \
  MOCK_COUNT_FILE="$count_file" \
  PATH="$tmp_dir:$PATH" \
  SUPABASE_URL='https://example.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='test-service-role' \
  EDGE_RETRY_ATTEMPTS=4 \
  EDGE_RETRY_BASE_DELAY=0 \
  EDGE_REQUEST_MAX_TIME=5 \
    bash "$helper" match-product-catalog '{"limit":1}' >"$out_file" 2>"$err_file"
}

out="$tmp_dir/out"
err="$tmp_dir/err"
count="$tmp_dir/count"

: > "$count"
run_helper '503,200' "$out" "$err" "$count"
grep -q '"ok":true' "$out"
[[ "$(cat "$count")" == '2' ]]
grep -q 'Transient Supabase Edge failure' "$err"

: > "$count"
run_helper 'network,200' "$out" "$err" "$count"
grep -q '"ok":true' "$out"
[[ "$(cat "$count")" == '2' ]]

: > "$count"
set +e
run_helper '400,200' "$out" "$err" "$count"
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$(cat "$count")" == '1' ]]
grep -q 'Permanent Supabase Edge failure; retry skipped.' "$err"

echo 'Supabase Edge retry helper: transient/permanent regression passed.'
