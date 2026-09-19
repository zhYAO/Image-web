import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthRecovery } from '../features/auth/AuthRecovery';

describe('AuthRecovery', () => {
  it('keeps the component mounted while closed and reports the stable account after login', async () => {
    const authenticate = vi.fn().mockResolvedValue({ id: 'd9428888-122b-11e1-b85c-61cd3cbb3210', email: 'p@example.com', displayName: null, status: 'active' });
    const onAuthenticated = vi.fn();
    const { rerender } = render(<AuthRecovery authenticate={authenticate} onAuthenticated={onAuthenticated} open={false} />);
    expect(screen.getByTestId('auth-recovery')).toHaveAttribute('hidden');
    rerender(<AuthRecovery authenticate={authenticate} onAuthenticated={onAuthenticated} open />);
    await userEvent.type(screen.getByLabelText('邮箱'), 'p@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'safe password');
    await userEvent.click(screen.getByRole('button', { name: '登录并返回' }));
    expect(onAuthenticated).toHaveBeenCalledWith({ id: 'd9428888-122b-11e1-b85c-61cd3cbb3210', email: 'p@example.com', displayName: null, status: 'active' });
  });
});
