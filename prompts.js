function clampText(value) {
  return String(value || '').trim();
}

function num(value, fallback = 50) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bucket(value, lowLabel, midLabel, highLabel) {
  const n = num(value);
  if (n <= 33) return lowLabel;
  if (n >= 67) return highLabel;
  return midLabel;
}

function inferReaderEffect(tone, polish, energy) {
  const softSharp = bucket(tone, 'gently let in', 'balanced and engaged', 'lightly intrigued');
  const personalPolished = bucket(polish, 'close to the writer', 'clear and trusting', 'tasteful admiration');
  const calmExpressive = bucket(energy, 'eased in', 'steady momentum', 'spark and lift');
  return `make the reader feel ${softSharp}, ${personalPolished}, and ${calmExpressive}`;
}

function inferDistinctivenessStrategy(tone, polish, energy, selfFeel, vibes) {
  const items = [];
  const vibesText = (vibes || []).join(', ').toLowerCase();
  const selfText = String(selfFeel || '').toLowerCase();

  items.push('use at least one concrete, memorable detail instead of generic summary');
  items.push('make each draft meaningfully different in social angle, not only in wording');
  items.push('favor human specificity over polished emptiness');

  if (num(tone) <= 35) {
    items.push('prefer implication, intimacy, and emotional restraint over loud claims');
  } else if (num(tone) >= 67) {
    items.push('use sharper framing, cleaner claims, and a more confident point of view');
  } else {
    items.push('balance warmth with clarity so the post feels socially legible');
  }

  if (num(polish) >= 67) {
    items.push('remove clutter and create a curated, aesthetically controlled impression');
  } else if (num(polish) <= 33) {
    items.push('retain a little lived-in texture so the post feels human and unforced');
  }

  if (num(energy) >= 67) {
    items.push('increase momentum and lift without sounding try-hard');
  } else if (num(energy) <= 33) {
    items.push('keep the rhythm calm, measured, and quietly confident');
  }

  if (vibesText.includes('clean') || vibesText.includes('refined')) {
    items.push('favor cleaner structure and tasteful restraint');
  }
  if (vibesText.includes('cozy') || vibesText.includes('dreamy')) {
    items.push('favor warmth, softness, and atmosphere');
  }
  if (vibesText.includes('playful')) {
    items.push('favor charm, surprise, and light delight');
  }

  if (selfText.includes('soft')) {
    items.push('translate softness into intimacy and elegance, not vagueness');
  }
  if (selfText.includes('appealing')) {
    items.push('make the post socially attractive without sounding performative');
  }
  if (selfText.includes('distinct')) {
    items.push('make the post feel recognizably specific to one person, not template-like');
  }

  return items;
}

function inferRestraintRules() {
  return [
    'avoid generic motivational language',
    'avoid obvious AI cadence and overly symmetrical phrasing',
    'avoid clichés, filler, and vague universal statements',
    'do not overexplain the feeling or lesson',
    'do not use bullet lists, numbered lists, dash-line formatting, or em dashes in the post body',
    'avoid caption language that sounds like an ad, a brand campaign, or a template',
    'avoid forced vulnerability, melodrama, and trying too hard to be clever'
  ];
}

function inferFormattingRules(polish, energy) {
  const rules = [
    'make the post visually clean and easy to read on Instagram',
    'prefer short paragraphs over dense blocks',
    'use natural line breaks where they improve rhythm',
    'keep spacing intentional and polished',
    'do not use bullet lists, numbered lists, or dash-line formatting in the body',
    'do not use em dashes',
    'do not over-punctuate for drama',
    'do not make every sentence the same length'
  ];

  if (num(polish) >= 67) {
    rules.push('make the formatting feel neat, tasteful, and socially polished');
  }

  if (num(energy) >= 67) {
    rules.push('allow a little more rhythm and movement, but keep the layout clean');
  }

  return rules;
}

function compileInstagramStrategy({ selfProfile }) {
  const tone = selfProfile?.tone ?? 42;
  const polish = selfProfile?.polish ?? 52;
  const energy = selfProfile?.energy ?? 46;
  const selfFeel = clampText(selfProfile?.selfFeel) || 'Infer a natural Instagram social self from the user task.';
  const vibes = Array.isArray(selfProfile?.vibes) ? selfProfile.vibes : ['clean', 'natural', 'socially intentional'];

  return {
    social_goal: 'appeal, emotional resonance, distinctiveness, and post-readiness for Instagram',
    reader_effect: inferReaderEffect(tone, polish, energy),
    distinctiveness_strategy: inferDistinctivenessStrategy(tone, polish, energy, selfFeel, vibes),
    restraint_rules: inferRestraintRules(),
    formatting_rules: inferFormattingRules(polish, energy),
    voice_posture: {
      tone_axis: bucket(tone, 'soft / intimate / implied', 'balanced / natural / clear', 'sharp / crisp / assertive'),
      polish_axis: bucket(polish, 'personal / lived-in / human', 'balanced / edited / natural', 'curated / aesthetic / polished'),
      energy_axis: bucket(energy, 'calm / measured / restrained', 'steady / dynamic / controlled', 'expressive / lively / lifted')
    },
    selfFeel,
    vibes
  };
}

export function buildInstagramPrompt({ task, notes, selfProfile }) {
  const strategy = compileInstagramStrategy({ selfProfile: selfProfile || {} });

  return `
You are helping write an Instagram post.

Write exactly 3 distinct post drafts.

Language rule:
- Write all draft titles, post bodies, and tone labels in English unless the user explicitly asks for another output language.
- If the user writes their task in Chinese but does not explicitly ask for Chinese output, translate the meaning and write natural English Instagram copy.
- Do not mix languages unless the user explicitly requests bilingual output.

Important:
- Draft 1 should optimize for resonance and emotional fit.
- Draft 2 should optimize for appeal and post-likelihood.
- Draft 3 should optimize for distinctiveness and originality.
- All 3 should still feel natural, believable, and post-ready.
- Make the writing feel curated and thoughtful, not generic.
- Do not make the drafts sound like AI templates.
- Do not mention hidden strategy or character settings.
- Avoid clichés, filler, forced vulnerability, generic life lessons, and corporate tone.
- Make the writing socially legible: something that feels intentional and attractive to encounter on Instagram.
- Use specific detail, framing, rhythm, restraint, and formatting to create effect.
- Make the character-shaped output feel meaningfully curated, but not louder or more artificial.
- Do not use bullet lists, numbered lists, dash-line formatting, or em dashes in the post body.
- Make the formatting visually clean and polished.
- Prefer short paragraphs and intentional spacing.
- Use line breaks only when they genuinely improve flow, emphasis, or readability.
- Do not use hashtags unless the user asks for them or the post clearly needs them.
- Do not overuse emojis. Use no emoji by default unless it feels highly natural.

Return only valid JSON in this shape:
{
  "drafts": [
    { "title": "Short option name", "body": "Post text", "tone": "Tone label" },
    { "title": "Short option name", "body": "Post text", "tone": "Tone label" },
    { "title": "Short option name", "body": "Post text", "tone": "Tone label" }
  ]
}

User task:
${clampText(task)}

Notes:
${clampText(notes)}

Inferred social self:
${strategy.selfFeel}

Vibes:
${strategy.vibes.join(', ')}

Voice posture:
- Tone axis: ${strategy.voice_posture.tone_axis}
- Polish axis: ${strategy.voice_posture.polish_axis}
- Energy axis: ${strategy.voice_posture.energy_axis}

Social goal:
${strategy.social_goal}

Desired reader effect:
${strategy.reader_effect}

Distinctiveness strategy:
- ${strategy.distinctiveness_strategy.join('\n- ')}

Restraint rules:
- ${strategy.restraint_rules.join('\n- ')}

Draft structure strategy:
- Draft 1: resonance-first, with emotional clarity and intimacy
- Draft 2: appeal-first, with a stronger Instagram hook and higher post-likelihood
- Draft 3: distinctiveness-first, with a more original angle or framing move

Formatting rules:
- ${strategy.formatting_rules.join('\n- ')}
`.trim();
}

export function parseDraftsFromText(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.drafts) && parsed.drafts.length) {
      return parsed.drafts.slice(0, 3).map((d, i) => ({
        title: d.title || `Option ${i + 1}`,
        body: d.body || '',
        tone: d.tone || 'Generated'
      }));
    }
  } catch (e) {}

  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && Array.isArray(parsed.drafts) && parsed.drafts.length) {
        return parsed.drafts.slice(0, 3).map((d, i) => ({
          title: d.title || `Option ${i + 1}`,
          body: d.body || '',
          tone: d.tone || 'Generated'
        }));
      }
    } catch (e) {}
  }

  return fallback;
}

export function fallbackDrafts(task) {
  return [
    {
      title: 'Soft reflection',
      body: `I wanted to write something honest about ${task}. Not in a perfectly polished way, but in a way that still feels intentional, personal, and easy to share.`,
      tone: 'Reflective · Natural'
    },
    {
      title: 'Clean caption',
      body: `A small moment around ${task}, but it stayed with me. I like when a post can feel simple, specific, and still say something true.`,
      tone: 'Clean · Personal'
    },
    {
      title: 'Distinct angle',
      body: `The part I keep thinking about is ${task}. There is something quietly specific about it, and that is the caption I would actually want to post.`,
      tone: 'Distinctive · Intimate'
    }
  ];
}
