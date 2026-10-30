import { AuthPanel } from '../../../web/features/auth/AuthPanel';
import { useRuntime } from '../platform/runtime-provider';
export function AuthPage() {
  const runtime = useRuntime();
  const legalVersion = runtime.status === 'ready' && runtime.value.config.registrationEnabled ? runtime.value.config.approvedLegalVersion : null;
  return <AuthPanel legalVersion={legalVersion} />;
}
