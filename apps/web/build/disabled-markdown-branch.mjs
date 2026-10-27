// These branches are disabled by the application's sole Markdown entry point.
// Fail visibly if that contract changes instead of silently reducing rendering.
function disabledMarkdownBranch() {
  throw new Error('A disabled Markdown branch was invoked; update the build profile before enabling it');
}

export {
  disabledMarkdownBranch as default,
  disabledMarkdownBranch as rehypeGithubAlerts,
  disabledMarkdownBranch as HighlighterFullFeatured,
  disabledMarkdownBranch as preprocessLaTeX,
  disabledMarkdownBranch as isLastFormulaRenderable,
};
