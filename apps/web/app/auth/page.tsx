import { AuthPanel } from '../../features/auth/AuthPanel';
export default function AuthPage() { return <AuthPanel legalVersion={process.env.APPROVED_LEGAL_VERSION?.trim() || null} />; }
