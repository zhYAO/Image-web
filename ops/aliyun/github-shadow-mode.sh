# Source only from the reviewed GitHub producer/intake scripts.
# This is a release namespace diagnostic, never a deployment permission.
zimage_shadow_mode() {
  case "${ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW:-false}" in
    false) return 0 ;;
    true)
      [[ ${GITHUB_REPOSITORY:-} == zhYAO/Image-web &&
         ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/heads/main &&
         ${GITHUB_REF_PROTECTED:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted &&
         ${RUNNER_OS:-} == Linux && ${ZIMAGE_PAIRED_BUILD_MODE:-} == false &&
         ${ZIMAGE_PAIRED_PRODUCTION:-} == false && -z ${1:-} ]] && return 0 ;;
  esac
  echo 'Protected main shadow requires both deployment flags explicitly false and an isolated hosted job.' >&2
  return 1
}

zimage_frontend_namespace() {
  if [[ ${ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW:-false} == true ]] ||
     [[ ${GITHUB_EVENT_NAME:-} == push && ${ZIMAGE_PAIRED_BUILD_MODE:-} == true ]]; then
    printf 'release-%s\n' "${GITHUB_SHA:0:12}"
  else
    printf 'rehearsal-%s-%s-%s\n' "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
  fi
}
