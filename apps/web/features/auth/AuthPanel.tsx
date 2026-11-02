'use client';

import { AuthShell } from '@/features/brand/AuthShell';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authFeedback } from './feedback';
import { notifyAuthChange } from './AuthStatusProvider';
import { safeReturnTo } from './return-to';
import { useAuthCaptcha } from './use-auth-captcha';
import { prefetchWorkspace } from '@/features/workspace/load-workspace';

type Mode = 'login' | 'register' | 'recovery';

export function AuthPanel({ legalVersion = null }: { legalVersion?: string | null } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nextStep, setNextStep] = useState<string | null>(null);
  const { captcha, captchaToken, captchaPending, resetCaptcha } = useAuthCaptcha();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (channel !== 'email' || pending || captchaPending) return;
    if (mode === 'login') prefetchWorkspace();
    setMessage(''); setFailed(false); setNextStep(null);
    const data = new FormData(event.currentTarget);
    const endpoint = mode === 'register' ? 'register' : mode === 'recovery' ? 'recovery' : 'login';
    const body: Record<string, unknown> = { email: data.get('email'), captchaToken };
    if (mode !== 'recovery') body.password = data.get('password');
    if (mode === 'register') {
      if (!legalVersion) { setFailed(true); setMessage('注册暂未开放，请等待服务条款确认后再试。'); return; }
      if (!data.get('legal')) { setFailed(true); setMessage('请先同意服务条款与隐私政策。'); return; }
      if (data.get('password') !== data.get('confirmPassword')) { setFailed(true); setMessage('两次输入的密码不一致。'); return; }
      body.legalVersion = legalVersion;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { accepted?: boolean; authenticated?: boolean; reason?: string; message?: string };
      if (!response.ok || (mode === 'login' ? result.authenticated !== true : result.accepted !== true)) {
        setFailed(true);
        setMessage(authFeedback(result, mode === 'login' ? '邮箱或密码不正确，请重试。' : '暂时无法处理，请稍后重试。'));
        return;
      }
      const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
      if (mode === 'login') { notifyAuthChange(true); router.push(returnTo); return; }
      const query = new URLSearchParams({ email: String(body.email), returnTo });
      setNextStep(`${mode === 'register' ? '/auth/verify' : '/auth/reset'}?${query}`);
      setMessage('如果该邮箱可以接收此类邮件，你将收到验证码。请检查收件箱和垃圾邮件。');
    } catch {
      setFailed(true); setMessage('网络连接失败，请检查网络后重试。');
    } finally { setPending(false); resetCaptcha(); }
  }
  function changeMode(value: Mode) { setMode(value); setMessage(''); setFailed(false); setNextStep(null); resetCaptcha(); }

  return <AuthShell>
    <section className="zi-auth-content"><p className="zi-eyebrow">ZIMAGE · 中国大陆公开 BETA</p>
    <nav className="zi-auth-tabs" aria-label="登录方式">
      <button type="button" aria-pressed={channel === 'email'} disabled={pending} onClick={() => setChannel('email')}>邮箱登录</button>
      <button type="button" aria-pressed={channel === 'phone'} disabled={pending} onClick={() => setChannel('phone')}>手机号验证码</button>
    </nav>
    <div hidden={channel !== 'email'}>
    <div className="zi-auth-heading"><h1 id="zi-auth-title">{mode === 'login' ? '登录' : mode === 'register' ? '创建账号' : '找回密码'}</h1>
    <p>{mode === 'login' ? '登录后继续你的图片创作。' : mode === 'register' ? '创建账号，跨设备保留会话与生成记录。' : '输入邮箱，我们会发送找回密码指引。'}</p></div>
    <form className="zi-auth-form" onSubmit={submit}><label className="zi-field">邮箱<input autoComplete="email" name="email" required type="email" /></label>
      {mode !== 'recovery' && <label className="zi-field">密码<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} name="password" required type="password" /></label>}
      {mode === 'register' && <><label className="zi-field">确认密码<input autoComplete="new-password" name="confirmPassword" required type="password" /></label>
        <label className="zi-legal-consent"><input name="legal" type="checkbox" />我已阅读并同意 <a href="/terms">服务条款</a> 与 <a href="/privacy">隐私政策</a></label></>}
      {mode === 'register' && !legalVersion && <p className="zi-feedback" role="alert">注册暂未开放，请等待服务条款确认后再试。</p>}
      {captcha}
      {message && <p className={failed ? 'zi-feedback' : 'zi-register-note'} role={failed ? 'alert' : 'status'}>{message}</p>}
      {nextStep && <a href={nextStep}>输入邮箱验证码</a>}<button className="zi-button zi-primary zi-auth-submit" disabled={pending || captchaPending || (mode === 'register' && !legalVersion)} type="submit">{mode === 'login' ? '登录' : mode === 'register' ? '注册' : '发送重置邮件'}</button></form>
    <nav className="zi-auth-tabs" aria-label="账号操作"><button aria-pressed={mode === 'login'} disabled={pending} onClick={() => changeMode('login')} type="button">登录</button><button aria-pressed={mode === 'register'} disabled={pending} onClick={() => changeMode('register')} type="button">注册</button><button aria-pressed={mode === 'recovery'} disabled={pending} onClick={() => changeMode('recovery')} type="button">忘记密码</button></nav>
    </div>
    {channel === 'phone' && <section className="zi-auth-phone" aria-label="手机号验证码登录">
      <h1>手机号验证码登录</h1>
      <p id="phone-login-unavailable" className="zi-register-note">短信服务尚未接入，暂不支持发送验证码或手机号登录。请使用邮箱登录。</p>
      <fieldset className="auth-phone-placeholder zi-credential-fields" disabled aria-describedby="phone-login-unavailable">
        <legend className="zi-register-note">暂未开放</legend>
        <label className="zi-field">手机号<input name="phone" type="tel" autoComplete="tel" placeholder="请输入手机号" /></label>
        <label className="zi-field">验证码<input name="phoneCode" inputMode="numeric" autoComplete="one-time-code" placeholder="请输入验证码" /></label>
        <button className="zi-button zi-secondary" type="button">获取验证码</button>
        <button className="zi-button zi-primary zi-auth-submit" type="button">手机号登录暂未开放</button>
      </fieldset>
    </section>}
  </section></AuthShell>;
}
