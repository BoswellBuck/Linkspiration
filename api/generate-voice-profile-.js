// /api/generate-voice-profile.js
// Linkspiration: Voice Matching endpoint
//
// Follows the same pattern as the existing /api/generate.js proxy: forced
// tool use for structured JSON output, since Claude's current models don't
// support assistant-message prefill.
//
// Two entry modes so voice-matching works even for members who don't have
// writing samples yet:
//   mode: "samples"        -> Path A: member pasted 2-5 writing samples
//   mode: "questionnaire"  -> Path B: member answered guided style questions
//
// Both modes converge on the same voice_profile JSON shape, so downstream
// generation prompts (Profile, First Posts) don't need to know which path
// was used, see voiceProfileInjection() in index.html.

export const config = {
  maxDuration: 60,
};

const VOICE_PROFILE_TOOL = {
  name: "record_voice_profile",
  description: "Record a structured voice profile for a LinkedIn content creator.",
  input_schema: {
    type: "object",
    properties: {
      sentence_rhythm: { type: "string", enum: ["short_punchy", "flowing", "mixed"] },
      formality: { type: "string", enum: ["casual", "conversational", "formal"] },
      opener_style: { type: "string", enum: ["question", "bold_statement", "story_hook", "stat_or_fact"] },
      uses_humor: { type: "boolean" },
      uses_rhetorical_questions: { type: "boolean" },
      list_usage: { type: "string", enum: ["frequent", "occasional", "rare"] },
      closing_style: { type: "string", enum: ["direct_cta", "reflective", "open_question", "soft_invite"] },
      recurring_phrases: {
        type: "array",
        items: { type: "string" },
        description: "2-5 short phrases or verbal tics genuinely present in the input, if any. Empty array if none evident."
      },
      notes: {
        type: "string",
        description: "1-2 sentence plain-language summary of this person's voice, written for use as a prompt constraint."
      }
    },
    required: ["sentence_rhythm", "formality", "opener_style", "uses_humor", "uses_rhetorical_questions", "list_usage", "closing_style", "recurring_phrases", "notes"]
  }
};

function buildSamplesPrompt(samples) {
  return `Analyze the following writing samples and extract the author's voice profile. Base every field strictly on evidence in the text, do not invent traits. If a trait isn't clearly evident, choose the closest reasonable default rather than guessing wildly.\n\nWRITING SAMPLES:\n\n` +
    samples.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join("\n\n");
}

function buildQuestionnairePrompt(answers) {
  return `A LinkedIn content creator answered a short style questionnaire because they don't have existing writing samples to analyze yet. Convert their answers into a voice profile. Use their selections directly for the matching fields, and write a short "notes" summary that a copywriter could use as a style brief.\n\nQUESTIONNAIRE ANSWERS:\n${JSON.stringify(answers, null, 2)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    return;
  }

  try {
    const { mode, samples, answers } = req.body || {};

    if (mode !== "samples" && mode !== "questionnaire") {
      res.status(400).json({ error: "mode must be 'samples' or 'questionnaire'" });
      return;
    }
    if (mode === "samples" && (!Array.isArray(samples) || samples.length === 0)) {
      res.status(400).json({ error: "samples must be a non-empty array" });
      return;
    }
    if (mode === "questionnaire" && (!answers || typeof answers !== "object")) {
      res.status(400).json({ error: "answers object is required for questionnaire mode" });
      return;
    }

    const userPrompt = mode === "samples" ? buildSamplesPrompt(samples) : buildQuestionnairePrompt(answers);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: "You extract structured voice profiles for a LinkedIn content platform. Never editorialize or judge the writing quality. Never print your reasoning or any counting/analysis text outside the tool call.",
        messages: [{ role: "user", content: userPrompt }],
        tools: [VOICE_PROFILE_TOOL],
        tool_choice: { type: "tool", name: "record_voice_profile" }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || "Voice profile generation failed." });
      return;
    }

    const toolUse = (data.content || []).find((block) => block.type === "tool_use");
    if (!toolUse) {
      res.status(502).json({ error: "No structured voice profile returned." });
      return;
    }

    res.status(200).json({
      voice_profile: toolUse.input,
      voice_profile_source: mode,
      voice_profile_updated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Unexpected server error." });
  }
}
