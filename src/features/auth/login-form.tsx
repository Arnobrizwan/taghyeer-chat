'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { login } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import { Button, Field } from '@/components/ui';
import { normalisePhone, validateName, validatePhone } from '@/lib/utils';
import { useSession } from './session';

export function LoginForm() {
  const router = useRouter();
  const signIn = useSession((s) => s.signIn);
  const status = useSession((s) => s.status);
  const expired = useSession((s) => s.expired);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; name?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Errors appear on blur or submit, never while first typing a field.
  const [touched, setTouched] = useState<{ phone?: boolean; name?: boolean }>({});

  useEffect(() => {
    if (status === 'authenticated') router.replace('/app');
  }, [status, router]);

  function validate() {
    const next = {
      phone: validatePhone(phone) ?? undefined,
      name: validateName(name) ?? undefined,
    };
    setErrors(next);
    return !next.phone && !next.name;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ phone: true, name: true });
    setFormError(null);
    if (!validate()) return;

    setPending(true);
    try {
      const result = await login(normalisePhone(phone.trim()), name.trim());
      signIn(result.token, result.user);
      router.replace('/app');
    } catch (err) {
      if (err instanceof ApiError) {
        // The API returns per-field details on validation failures; use them.
        if (err.fieldErrors.length > 0) {
          const mapped: { phone?: string; name?: string } = {};
          for (const fe of err.fieldErrors) {
            if (fe.path === 'phone') mapped.phone = fe.message;
            if (fe.path === 'name') mapped.name = fe.message;
          }
          setErrors((prev) => ({ ...prev, ...mapped }));
          if (!mapped.phone && !mapped.name) setFormError(err.userMessage);
        } else {
          setFormError(err.userMessage);
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-5">
      {expired && (
        <p
          role="status"
          className="rounded-lg border border-amber/25 bg-amber-soft px-3.5 py-2.5 text-sm text-amber"
        >
          Your session expired. Sign in again to pick up where you left off.
        </p>
      )}

      <Field
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+8801700000000"
        hint="No password — your number is your account. A new number signs you up."
        value={phone}
        error={touched.phone ? errors.phone : null}
        onChange={(e) => {
          setPhone(e.target.value);
          if (touched.phone) setErrors((p) => ({ ...p, phone: validatePhone(e.target.value) ?? undefined }));
        }}
        onBlur={() => {
          setTouched((p) => ({ ...p, phone: true }));
          setErrors((p) => ({ ...p, phone: validatePhone(phone) ?? undefined }));
        }}
      />

      <Field
        label="Display name"
        autoComplete="name"
        placeholder="Ada Lovelace"
        value={name}
        error={touched.name ? errors.name : null}
        onChange={(e) => {
          setName(e.target.value);
          if (touched.name) setErrors((p) => ({ ...p, name: validateName(e.target.value) ?? undefined }));
        }}
        onBlur={() => {
          setTouched((p) => ({ ...p, name: true }));
          setErrors((p) => ({ ...p, name: validateName(name) ?? undefined }));
        }}
      />

      {formError && (
        <p role="alert" className="text-sm font-medium text-vermilion">
          {formError}
        </p>
      )}

      <Button type="submit" loading={pending} className="w-full">
        {pending ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  );
}
