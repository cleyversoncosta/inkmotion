let authMode = 'login';
const homeParams = new URLSearchParams(location.search);
const passwordResetToken = homeParams.get('reset_token');
function showAuthModal(mode = 'login', message) {
  authMode = mode;

  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-title');
  const copy = document.getElementById('auth-copy');
  const nameField = document.getElementById('auth-name-field');
  const submit = document.getElementById('auth-submit');
  const switchBtn = document.getElementById('auth-switch');
  const forgotBtn = document.getElementById('auth-forgot');
  const password = document.getElementById('auth-password');
  const error = document.getElementById('auth-error');
  const emailField = document.getElementById('auth-email')?.closest('.auth-field');
  const passwordField = password?.closest('.auth-field');
  if (!modal) return;

  const isSignup = authMode === 'signup';
  const isForgot = authMode === 'forgot';
  const isReset = authMode === 'reset';
  title.textContent = isSignup ? 'Create your account' : isForgot ? 'Recover password' : isReset ? 'Set new password' : 'Log in';
  copy.textContent = message || (
    isSignup ? 'Save projects to the database-backed workspace.' :
    isForgot ? 'Enter your email and we will send a password reset link.' :
    isReset ? 'Choose a new password for your account.' :
    'Access saved projects from your account.'
  );
  nameField.style.display = isSignup ? 'flex' : 'none';
  if (emailField) emailField.style.display = isReset ? 'none' : 'flex';
  if (passwordField) passwordField.style.display = isForgot ? 'none' : 'flex';
  submit.textContent = isSignup ? 'Sign up' : isForgot ? 'Send reset link' : isReset ? 'Reset password' : 'Log in';
  switchBtn.textContent = isSignup || isForgot || isReset ? 'Back to login' : 'Create account';
  if (forgotBtn) forgotBtn.style.display = authMode === 'login' ? 'inline-block' : 'none';
  password.required = !isForgot;
  document.getElementById('auth-email').required = !isReset;
  password.autocomplete = isSignup || isReset ? 'new-password' : 'current-password';
  error.style.color = '#dc2626';
  error.textContent = '';
  modal.classList.add('active');
  setTimeout(() => (isReset ? password : document.getElementById('auth-email'))?.focus(), 20);
}

async function signInWithGoogle() {
  const serverMessage = 'Google sign-in needs the Express server. Run npm run dev on port 3000.';
  try {
    const health = await fetch('/health', { cache: 'no-store' });
    if (health.status === 503) throw new Error('The app server is running, but the database is unavailable. Please try again after the database connection is restored.');
    if (!health.ok) throw new Error(serverMessage);
    const returnTo = i18n.url('/');
    const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `/api/auth/google${qs}`;
  } catch (err) {
    const error = document.getElementById('auth-error');
    const message = err instanceof TypeError ? serverMessage : err.message;
    if (error) error.textContent = message;

  }
}



function closeAuthModal(event) {
  if (event && event.target && event.target.id !== 'auth-modal') return;
  document.getElementById('auth-modal')?.classList.remove('active');
}

function toggleAuthMode() {
  showAuthModal(authMode === 'login' ? 'signup' : 'login');
}

async function submitAuthForm(event) {
  event.preventDefault();
  const error = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');
  if (authMode === 'forgot') {
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Sending...';
    try {
      const res = await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('auth-email').value, language: i18n.language }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send reset email.');
      error.style.color = '#16a34a';
      error.textContent = data.message || 'Check your email for the reset link.';
    } catch (err) {
      error.style.color = '#dc2626';
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send reset link';
    }
    return;
  }
  if (authMode === 'reset') {
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Resetting...';
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: passwordResetToken, password: document.getElementById('auth-password').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reset password.');
      window.location.assign(i18n.url('/studio'));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Reset password';
    }
    return;
  }
  const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
  const payload = {
    email: document.getElementById('auth-email').value,
    password: document.getElementById('auth-password').value,
  };
  if (authMode === 'signup') payload.name = document.getElementById('auth-name').value;

  error.textContent = '';
  submit.disabled = true;
  submit.textContent = authMode === 'signup' ? 'Creating...' : 'Logging in...';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : {};
    if (!contentType.includes('application/json')) {
      throw new Error('Accounts need the Express server. Start with npm run dev instead of a static preview server.');
    }
    if (!res.ok) throw new Error(data.error || 'Authentication failed.');

    window.location.assign(i18n.url('/studio'));
  } catch (err) {
    error.textContent = err.message.includes('fetch')
      ? 'Start the server and run the Prisma migration to enable accounts.'
      : err.message;
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === 'signup' ? 'Sign up' : 'Log in';
  }
}


for (const link of document.querySelectorAll('[data-auth-mode]')) {
  link.addEventListener('click', event => {
    event.preventDefault();
    showAuthModal(link.dataset.authMode);
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAuthModal();
});
if (passwordResetToken) showAuthModal('reset');
else if (['login', 'signup'].includes(homeParams.get('auth'))) showAuthModal(homeParams.get('auth'));
else if (homeParams.has('auth_error')) {
  showAuthModal('login');
  document.getElementById('auth-error').textContent = 'Google sign-in could not be completed. Please try again.';
}
fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
  .then(response => response.ok ? response.json() : null)
  .then(data => {
    if (data?.user) {
      document.getElementById('home-dashboard-btn').hidden = false;
      if (homeParams.get('auth') === 'google') window.location.replace(i18n.url('/studio'));
    } else if (homeParams.get('auth') === 'google') {
      showAuthModal('login');
      document.getElementById('auth-error').textContent = 'Please sign in again to continue.';
    }
  })
  .catch(() => {});
