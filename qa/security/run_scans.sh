#!/usr/bin/env bash
# Security scans for the dealer scheme status API (Next.js). Reports go to qa/security/reports/ (git-ignored).
#
#   qa/security/run_scans.sh                      # all scans (ZAP needs the app running, and Docker)
#   qa/security/run_scans.sh sast deps hygiene    # some of them (no server needed)
#
# Env: BASE_URL (default http://localhost:3400); CLIENT_ID + CLIENT_SECRET: a token is fetched once from
# /api/v1/auth/token and ZAP sends "Authorization: Bearer <token>" on every request. Without them (or when the
# server has auth off) ZAP scans without a token. A token lasts 1 hour, longer than a scan.
# The ZAP target needs the spec: start the server with DOCS_ENABLED=true (GET /api/v1/openapi.json).
#
#   sast     Semgrep (Docker)  - static analysis of src/, scripts/ and qa/ (TypeScript, Node.js and secrets rules)
#   deps     npm audit         - known CVEs: production dependencies (gate), all dependencies and qa/api-tests (report)
#   secrets  gitleaks (Docker) - secrets in every file that git would commit (tracked + untracked, not ignored)
#   hygiene  git               - no YAML, Docker, CLAUDE/AGENTS/context, .env or QA output files and no real
#                                dealer codes (6xxxxxxxxx, 7xxxxxxxxx or 7xxxxxxx) in the files that git would commit.
#                                With REAL_CODES_FILE (a git-ignored list, one code for each line), it also looks
#                                for each listed code.
#   zap      OWASP ZAP (Docker) - active API scan driven by /api/v1/openapi.json (same image as the reference API)
#
# Real dealer code formats: 10 digits that start with 6 or 7, or 8 digits that start with 7.
DEALER_CODE_PATTERN='(^|[^0-9A-Za-z])([67][0-9]{9}|7[0-9]{7})([^0-9A-Za-z]|$)'
# Images (override with SEMGREP_IMAGE, GITLEAKS_IMAGE, ZAP_IMAGE):
SEMGREP_IMAGE="${SEMGREP_IMAGE:-semgrep/semgrep:1.177.0}"
GITLEAKS_IMAGE="${GITLEAKS_IMAGE:-zricethezav/gitleaks:v8.30.1}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORTS="$ROOT/qa/security/reports"
BASE_URL="${BASE_URL:-http://localhost:3400}"
CLIENT_ID="${CLIENT_ID:-}"
CLIENT_SECRET="${CLIENT_SECRET:-}"
SCANS=("${@:-sast deps secrets hygiene zap}")
SCANS=(${SCANS[*]})
status=0
mkdir -p "$REPORTS"

run_sast() {
  echo "== Semgrep (static analysis) with $SEMGREP_IMAGE"
  docker run --rm -v "$ROOT:/src:ro" -v "$REPORTS:/reports:rw" -w /src "$SEMGREP_IMAGE" \
    semgrep scan --metrics=off --disable-version-check --quiet --no-git-ignore \
    --config p/typescript --config p/nodejs --config p/secrets \
    --exclude node_modules --exclude .next --exclude reports --exclude test-results --exclude playwright-report \
    --exclude newman --exclude dealers.json \
    --text-output=/reports/semgrep.txt --json-output=/reports/semgrep.json --error \
    src scripts qa next.config.ts
  local rc=$?
  [[ $rc -eq 0 ]] && echo "Semgrep: no findings"
  return $rc
}

run_deps() {
  echo "== npm audit (dependency CVEs)"
  (cd "$ROOT" && npm audit --omit=dev) > "$REPORTS/npm-audit-prod.txt" 2>&1
  local rc=$?
  echo "-- production dependencies (gate):"
  cat "$REPORTS/npm-audit-prod.txt"
  (cd "$ROOT" && npm audit) > "$REPORTS/npm-audit-full.txt" 2>&1
  echo "-- all dependencies, also dev (report only): $(grep -E 'vulnerabilit' "$REPORTS/npm-audit-full.txt" | tail -n 1)"
  if [[ -d "$ROOT/qa/api-tests/node_modules" ]]; then
    (cd "$ROOT/qa/api-tests" && npm audit) > "$REPORTS/npm-audit-qa-api-tests.txt" 2>&1
    echo "-- qa/api-tests (report only): $(grep -E 'vulnerabilit' "$REPORTS/npm-audit-qa-api-tests.txt" | tail -n 1)"
  fi
  return $rc
}

# The files that git would commit: tracked, plus untracked files that .gitignore does not exclude.
candidate_files() {
  (cd "$ROOT" && git ls-files -co --exclude-standard)
}

run_secrets() {
  echo "== gitleaks (secrets) with $GITLEAKS_IMAGE"
  local src="$REPORTS/.secrets-scan-src"
  rm -rf "$src" && mkdir -p "$src"
  (cd "$ROOT" && candidate_files | while IFS= read -r f; do [[ -f "$f" ]] && mkdir -p "$src/$(dirname "$f")" && cp "$f" "$src/$f"; done)
  docker run --rm -v "$src:/scan:ro" -v "$REPORTS:/reports:rw" -v "$ROOT/qa/security/gitleaks.toml:/gitleaks.toml:ro" \
    "$GITLEAKS_IMAGE" dir /scan --config /gitleaks.toml --no-banner --redact --exit-code 1 \
    --report-format json --report-path /reports/gitleaks.json
  local rc=$?
  rm -rf "$src"
  [[ $rc -eq 0 ]] && echo "gitleaks: no secrets found"
  return $rc
}

run_hygiene() {
  echo "== repository hygiene (files that git would commit)"
  local files bad codes rc=0
  files="$(candidate_files)"
  bad="$(printf '%s\n' "$files" | grep -E '(^|/)(docker-compose[^/]*|compose\.ya?ml|Dockerfile[^/]*|\.dockerignore)$|\.ya?ml$|(^|/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$|^context/|^\.claude/|(^|/)\.env($|\.)|^qa/test-data/dealers\.json$|^qa/api-tests/(node_modules|test-results|playwright-report)/|^qa/(k6|security)/reports/[^.]|^qa/postman/newman/' \
    | grep -vE '(^|/)\.env\.example$')"
  if [[ -n "$bad" ]]; then
    echo "Files that must stay local (git-ignored):"; printf '  %s\n' $bad; rc=1
  fi
  # Real dealer codes are 10 digits (6xxxxxxxxx or 7xxxxxxxxx) or 8 digits (7xxxxxxx). Match all three formats.
  codes="$(cd "$ROOT" && printf '%s\n' "$files" | while IFS= read -r f; do [[ -f "$f" ]] && grep -IlE "$DEALER_CODE_PATTERN" "$f"; done)"
  if [[ -n "$codes" ]]; then
    echo "Files with an 8- or 10-digit value that starts with 6 or 7 (real dealer codes are client data):"; printf '  %s\n' $codes; rc=1
  fi
  # Optional, stronger check: REAL_CODES_FILE is a git-ignored list of real dealer codes, one for each line.
  local listed=""
  if [[ -n "${REAL_CODES_FILE:-}" ]]; then
    if [[ -f "$REAL_CODES_FILE" ]]; then
      listed="$(cd "$ROOT" && printf '%s\n' "$files" | while IFS= read -r f; do [[ -f "$f" ]] && grep -IlwFf "$REAL_CODES_FILE" "$f"; done)"
      if [[ -n "$listed" ]]; then
        echo "Files with a code from REAL_CODES_FILE:"; printf '  %s\n' $listed; rc=1
      fi
    else
      echo "REAL_CODES_FILE not found: $REAL_CODES_FILE" >&2; rc=1
    fi
  fi
  {
    echo "Hygiene check $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Files checked: $(printf '%s\n' "$files" | grep -c .)"
    echo "Forbidden files: ${bad:-none}"
    echo "Files with dealer-code-like values (6/7 + 9 digits, 7 + 7 digits): ${codes:-none}"
    if [[ -n "${REAL_CODES_FILE:-}" ]]; then echo "Files with codes from REAL_CODES_FILE: ${listed:-none}"
    else echo "Files with codes from REAL_CODES_FILE: not checked (REAL_CODES_FILE not set)"; fi
  } > "$REPORTS/hygiene.txt"
  [[ $rc -eq 0 ]] && echo "Hygiene: $(printf '%s\n' "$files" | grep -c .) files checked, no problems"
  return $rc
}

run_zap() {
  echo "== OWASP ZAP API scan against $BASE_URL with $ZAP_IMAGE"
  # Inside the container, "localhost" is the container itself.
  local target="${BASE_URL/localhost/host.docker.internal}"
  target="${target/127.0.0.1/host.docker.internal}"
  local token=""
  local zconf=""
  if [[ -n "$CLIENT_ID" && -n "$CLIENT_SECRET" ]]; then
    # One token for the whole scan (the token endpoint allows only about 30 requests a minute per IP).
    local response
    response=$(curl -sS -X POST "$BASE_URL/api/v1/auth/token" \
      --data-urlencode grant_type=client_credentials --data-urlencode "client_id=$CLIENT_ID" \
      --data-urlencode "client_secret=$CLIENT_SECRET" --data-urlencode scope=schemes:read) || response=""
    token=$(printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).access_token||"")}catch{}})')
    if [[ -z "$token" ]]; then
      echo "ZAP: could not get a token from $BASE_URL/api/v1/auth/token: ${response:-no response}" >&2
      return 1
    fi
    zconf="-config replacer.full_list(0).description=bearer -config replacer.full_list(0).enabled=true \
-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization \
-config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ $token"
  else
    echo "ZAP: CLIENT_ID/CLIENT_SECRET not set, scanning without a token (only useful when the server has auth off)"
  fi
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/openapi.json")
  if [[ "$code" != "200" ]]; then
    echo "ZAP: $BASE_URL/api/v1/openapi.json returned $code (start the server with DOCS_ENABLED=true)" >&2
    return 1
  fi
  # First run: like the reference (zap-api-scan.py adds "-addonupdate", so the beta rules are installed), but ZAP
  # gets at most ZAP_START_MINUTES (default 3) to start, not 10. On 18-10-2026 the add-on download at start hung and
  # the scan failed after 600 s. When ZAP does not start (exit code 3), run again with "-silent": no add-on update,
  # only the rules of the image (6 beta passive rules fewer, for example 10049, 10063, 10099, 10110, 10026, 90004).
  local start_min="${ZAP_START_MINUTES:-3}"
  zap_scan() {
    local opts="$1" zarg=()
    [[ -n "$opts" ]] && zarg=(-z "$opts")
    docker run --rm -v "$REPORTS:/zap/wrk:rw" "$ZAP_IMAGE" \
      zap-api-scan.py -t "$target/api/v1/openapi.json" -f openapi -T "$start_min" \
      -r zap-report.html -w zap-report.md -J zap-report.json "${zarg[@]}"
  }
  # zap-api-scan exit codes: 0 = no issues, 1 = FAIL alerts, 2 = WARN alerts only, 3 = other failure (e.g. no start)
  local rc
  zap_scan "$zconf"; rc=$?
  if [[ $rc -eq 3 ]]; then
    echo "ZAP: the scan did not run (exit 3, for example ZAP did not start in ${start_min} min). Running again with -silent (no add-on update; the beta passive rules are not run)." >&2
    zap_scan "-silent${zconf:+ $zconf}"; rc=$?
  fi
  # The active scan sends hundreds of attack requests to /api/v1/auth/token. The token limit (30 a minute for each
  # IP) answers them with 429, so the token endpoint stays closed for this IP for about one minute.
  echo "ZAP: wait one minute before you run newman or Playwright: the scan used up the token limit of this IP."
  [[ $rc -eq 2 ]] && { echo "ZAP: warnings only (see zap-report.md)"; return 0; }
  return $rc
}

unknown=0
for scan in "${SCANS[@]}"; do
  case "$scan" in
    sast)    run_sast    || status=1 ;;
    deps)    run_deps    || status=1 ;;
    secrets) run_secrets || status=1 ;;
    hygiene) run_hygiene || status=1 ;;
    zap)     run_zap     || status=1 ;;
    *) echo "unknown scan: $scan (use sast, deps, secrets, hygiene, zap)"; unknown=1 ;;
  esac
done
[[ $unknown -eq 1 ]] && status=2

echo
[[ $status -eq 0 ]] && echo "Security scans passed. Reports: $REPORTS" || echo "Security scans found issues. Reports: $REPORTS"
exit $status
