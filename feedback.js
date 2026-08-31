// /api/feedback.js
// Unsilenced: lightweight feedback capture
//
// Called from the in-app check-in prompt (and available for any future
// feedback touchpoint) when a member types something and hits Send. Emails
// it straight to Dee via Resend, no dashboard to check, no new inbox, it
// just lands in the same inbox everything else does.
//
// Defaults to info@deeboswellbuck.com. Can be overridden without a redeploy
// by setting a DEE_EMAIL environment variable in Vercel, if that address
// ever needs to change.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { email, message, context } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing feedback message." });
    return;
  }

  const toAddress = process.env.DEE_EMAIL || "info@deeboswellbuck.com";
  const fromMember = email || "unknown member";
  const contextLabel = context || "In-app feedback";

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${contextLabel}</p>
      <p style="font-size:13px;color:#888;margin-bottom:16px">From: ${fromMember}</p>
      <div style="background:#FAF9F4;border-left:3px solid #F5B700;padding:14px 16px;font-size:14px;color:#14120F;line-height:1.6;white-space:pre-wrap">${message.replace(/</g, "&lt;")}</div>
    </div>
  `;

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Unsilenced <hello@linkspiration.com>",
        to: toAddress,
        subject: `Feedback: ${contextLabel}`,
        html
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Feedback email failed:", errBody);
      res.status(502).json({ error: "Could not send feedback email." });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (e) {
    console.error("Feedback endpoint error:", e);
    res.status(500).json({ error: "Feedback send failed." });
  }
}
