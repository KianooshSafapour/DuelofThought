/**
 * SMS provider abstraction (server-side only).
 *
 * Sandbox/demo mode: when no SMS_PROVIDER_KEY env is configured there is no
 * real gateway — the message is logged to the server console AND stored as an
 * AnalyticsEvent (`type: 'sms_dev'`) so it shows up in the admin Live Monitor.
 * Callers receive { delivered: false, dev: true } and may surface the code
 * inline for demo purposes.
 *
 * Production: set SMS_PROVIDER_KEY (and optionally SMS_PROVIDER_SENDER) to
 * route messages through a real provider — Kavenegar (kavenegar.com) is
 * pre-wired below; swap `providerSend` for any other gateway.
 */
import { db } from '@/lib/db';

export interface SmsResult {
  /** true only when a real provider accepted the message */
  delivered: boolean;
  /** true when running in no-gateway (demo) mode */
  dev: boolean;
}

const PROVIDER_KEY = process.env.SMS_PROVIDER_KEY ?? '';
const PROVIDER_SENDER = process.env.SMS_PROVIDER_SENDER ?? '';

/** Kavenegar REST send (reference implementation for production). */
async function providerSend(phone: string, text: string): Promise<boolean> {
  const url = new URL(`https://api.kavenegar.com/v1/${PROVIDER_KEY}/sms/send.json`);
  url.searchParams.set('receptor', phone);
  url.searchParams.set('message', text);
  if (PROVIDER_SENDER) url.searchParams.set('sender', PROVIDER_SENDER);
  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (!res.ok) return false;
  const data = (await res.json()) as { return?: { status?: number } };
  return data?.return?.status === 200;
}

export async function sendSms(phone: string, text: string): Promise<SmsResult> {
  if (PROVIDER_KEY) {
    try {
      const delivered = await providerSend(phone, text);
      return { delivered, dev: false };
    } catch (e) {
      console.error('sms provider error', e);
      return { delivered: false, dev: false };
    }
  }

  // ---- demo mode (no gateway configured) --------------------------------
  console.log(`[sms:dev] to=${phone} :: ${text}`);
  await db.analyticsEvent
    .create({ data: { type: 'sms_dev', payload: JSON.stringify({ phone, text }) } })
    .catch(() => undefined); // monitoring must never break the auth flow
  return { delivered: false, dev: true };
}
