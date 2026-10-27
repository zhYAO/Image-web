export function createMarkdownBuildProfile(webRoot: string, isServer: boolean): {
  aliases: Record<string, string>;
  replacementFor(request: string, context: string): string | undefined;
};
