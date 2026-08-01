// /api/weekly-nudge.js
// Linkspiration: weekly content-idea email
//
// Triggered by Vercel Cron (see vercel.json). Runs once a week, pulls each
// approved member's 4 Content Pillars, picks one, and emails a content idea
// via Resend with a link back into First Posts.
//
// IMPORTANT DATA-MODEL NOTE: pillars and the member's name are NOT stored on
// the "profiles" table. They live inside "client_sessions.state" (a jsonb
// blob written by the main app: state.pillars, state.intake.fullName). This
// function reads from both tables and joins them in memory, using the
// service-role key so it can bypass row-level security entirely (this key
// must never be exposed client-side).
//
// Simple version: rotates pillars round-robin using weekly_nudge_last_index,
// stored on "profiles". If you later add manual performance logging on First
// Posts outputs, swap pickPillar() to weight toward whichever pillar has the
// best logged engagement instead of rotating blindly.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only key, never exposed client-side
);

function pickPillar(pillars, lastIndex) {
  if (!pillars || pillars.length === 0) return { pillar: null, nextIndex: 0 };
  const nextIndex = ((lastIndex ?? -1) + 1) % pillars.length;
  return { pillar: pillars[nextIndex], nextIndex };
}

function buildEmailHtml({ firstName, pillar, appUrl }) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi ${firstName || "there"},</p>
      <p>Here's a content idea this week from your <strong>${pillar.name}</strong> pillar:</p>
      <blockquote style="border-left: 3px solid #2C1A2E; padding-left: 12px; margin: 16px 0; color: #333;">
        ${pillar.hook}
      </blockquote>
      <p>
        <a href="${appUrl}"
           style="display:inline-block;background:#2C1A2E;color:#fff;padding:10px 18px;
                  border-radius:6px;text-decoration:none;">
          Generate this post
        </a>
      </p>
      <p style="font-size: 12px; color: #888;">
        Linkspiration, one idea a week to keep you visible.
      </p>
    </div>
  `;
}

export default async function handler(req, res) {
  // Vercel Cron sends GET with this header automatically when CRON_SECRET is set;
  // this check just prevents the endpoint from being triggered publicly.
  if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const appUrl = process.env.APP_URL || "https://linkspiration.com";
  const results = [];

  try {
    // Only approved members. Unapproved (pending) members should never get a
    // nudge asking them to post, since they don't have access to the app yet.
    const { data: profileRows, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, approved, weekly_nudge_last_index")
      .eq("approved", true);

    if (profileErr) throw profileErr;
    if (!profileRows || profileRows.length === 0) {
      res.status(200).json({ sent: 0, results: [] });
      return;
    }

    const userIds = profileRows.map((p) => p.id);

    const { data: sessionRows, error: sessionErr } = await supabase
      .from("client_sessions")
      .select("user_id, state")
      .in("user_id", userIds);

    if (sessionErr) throw sessionErr;

    const sessionByUserId = {};
    (sessionRows || []).forEach((row) => {
      sessionByUserId[row.user_id] = row.state || {};
    });

    for (const profile of profileRows) {
      const sessionState = sessionByUserId[profile.id];
      const pillars = sessionState && Array.isArray(sessionState.pillars) ? sessionState.pillars : null;
      const firstName = sessionState && sessionState.intake ? (sessionState.intake.fullName || "").split(" ")[0] : "";

      if (!pillars || pillars.length === 0) {
        results.push({ id: profile.id, status: "no_pillars_yet" });
        continue;
      }

      const { pillar, nextIndex } = pickPillar(pillars, profile.weekly_nudge_last_index);
      if (!pillar) {
        results.push({ id: profile.id, status: "no_pillar_selected" });
        continue;
      }

      const html = buildEmailHtml({ firstName, pillar, appUrl });

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Linkspiration <hello@linkspiration.com>",
          to: profile.email,
          subject: `This week's content idea: ${pillar.name}`,
          html
        })
      });

      if (!emailRes.ok) {
        results.push({ id: profile.id, status: "email_failed" });
        continue;
      }

      await supabase
        .from("profiles")
        .update({ weekly_nudge_last_index: nextIndex })
        .eq("id", profile.id);

      results.push({ id: profile.id, status: "sent", pillar: pillar.name });
    }

    res.status(200).json({ sent: results.filter(r => r.status === "sent").length, results });
  } catch (e) {
    console.error("weekly-nudge error:", e);
    res.status(500).json({ error: "Weekly nudge run failed" });
  }
}
