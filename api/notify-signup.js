// Vercel serverless function: /api/notify-signup
// Called automatically by a Supabase Database Webhook whenever a new row is
// inserted into the "profiles" table (i.e. every new signup). Sends Dee an
// email via Resend's API so she knows someone is waiting for approval.
//
// Requires two environment variables in Vercel:
//   RESEND_API_KEY   - from resend.com/api-keys (different from the SMTP
//                       credentials used for Supabase auth emails)
//   NOTIFY_EMAIL     - the email address that should receive these alerts
//                       (e.g. Dee's own inbox)
//
// This endpoint does not need to be called by the app itself. It's wired up
// once as a Supabase Database Webhook: Database > Webhooks > new webhook on
// the "profiles" table, event "Insert", pointing at this URL.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFY_EMAIL;
  if (!resendKey || !notifyEmail) {
    res.status(500).json({ error: 'Server is missing RESEND_API_KEY or NOTIFY_EMAIL in Vercel settings.' });
    return;
  }

  // Supabase Database Webhooks send the new row under body.record
  const newUser = (req.body && req.body.record) || {};
  const email = newUser.email || 'unknown email';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Linkspiration <hello@linkspiration.com>',
        to: [notifyEmail],
        subject: 'New Linkspiration signup waiting for approval',
        text: `${email} just created a Linkspiration account and is waiting for you to approve them.\n\nGo to Supabase > Table Editor > profiles, find their row, and set "approved" to true.`
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: 'Resend API request failed: ' + errText });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected server error.' });
  }
}
