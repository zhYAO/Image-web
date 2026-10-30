import { lazy, Suspense, type ComponentType } from 'react';

/** Existing UI split points use React.lazy; private content has no server render. */
export default function dynamic<Props extends object>(loader: () => Promise<ComponentType<Props> | { default: ComponentType<Props> }>, options: { loading?: ComponentType; ssr?: boolean } = {}) {
  const Component = lazy(() => loader().then(value => ({ default: 'default' in value ? value.default : value })));
  const Loading = options.loading;
  return function LazyComponent(props: Props) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Component {...props} /></Suspense>;
  };
}
