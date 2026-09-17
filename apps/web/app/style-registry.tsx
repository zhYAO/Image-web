"use client";

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { useState, type PropsWithChildren } from "react";

/** Keep LobeHub's Emotion globals out of the streamed component tree. */
export function StyleRegistry({ children }: PropsWithChildren) {
  const [{ cache, flush }] = useState(() => {
    const cache = createCache({ key: "zimage" });
    cache.compat = true;
    const originalInsert = cache.insert;
    let inserted: { name: string; global: boolean }[] = [];
    cache.insert = (...args) => {
      const [selector, serialized] = args;
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push({ name: serialized.name, global: !selector });
      }
      return originalInsert(...args);
    };
    return {
      cache,
      flush: () => {
        const pending = inserted;
        inserted = [];
        return pending;
      },
    };
  });

  useServerInsertedHTML(() => {
    const entries = flush();
    if (!entries.length) return null;
    const scoped: string[] = [];
    let scopedCss = "";
    const globals = entries.flatMap((entry) => {
      const css = cache.inserted[entry.name];
      if (typeof css !== "string") return [];
      if (!entry.global) {
        scoped.push(entry.name);
        scopedCss += css;
        return [];
      }
      return [
        <style
          key={entry.name}
          data-emotion={`${cache.key}-global ${entry.name}`}
          dangerouslySetInnerHTML={{ __html: css }}
        />,
      ];
    });
    return (
      <>
        {globals}
        {scoped.length > 0 && (
          <style
            data-emotion={`${cache.key} ${scoped.join(" ")}`}
            dangerouslySetInnerHTML={{ __html: scopedCss }}
          />
        )}
      </>
    );
  });

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}
