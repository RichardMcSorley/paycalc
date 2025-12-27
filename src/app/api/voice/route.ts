import { fal } from '@fal-ai/client';

fal.config({
  credentials: process.env.FAL_KEY,
});

const SYSTEM_PROMPT = `You are a voice assistant for a delivery gig pay calculator.
Parse the user's spoken offer details and extract the following fields:

SCHEMA:
- pay: The dollar amount offered (number, e.g., 8.50)
- pickups: Number of pickup locations (integer, 1-10, default 1)
- drops: Number of drop-off locations (integer, 1-10, default 1)
- miles: Total distance in miles (number, 0-100)
- items: Number of items to shop for (integer, 0-100, default 0)

EXAMPLES:
- "8 bucks, 3 miles" → {"pay": 8, "miles": 3}
- "12.50 for 2 pickups, 1 drop, 5.5 miles" → {"pay": 12.50, "pickups": 2, "drops": 1, "miles": 5.5}
- "$15 double order 7 miles 10 items" → {"pay": 15, "pickups": 2, "drops": 2, "miles": 7, "items": 10}
- "nine fifty, four miles, shop and deliver, 15 items" → {"pay": 9.50, "miles": 4, "items": 15}

RULES:
- "double" or "stacked" means 2 pickups and 2 drops
- "triple" means 3 pickups and 3 drops
- "shop" or "shop and deliver" indicates there will be items
- Only include fields that were mentioned
- Return ONLY valid JSON, no explanation`;

export async function POST(request: Request) {
  try {
    const { audio } = await request.json();

    if (!audio) {
      return Response.json({ error: 'No audio provided' }, { status: 400 });
    }

    // Use openrouter/router/audio to transcribe and parse in one call
    const result = await fal.subscribe('openrouter/router/audio', {
      input: {
        audio_url: audio,
        prompt: `Extract delivery offer details from this audio. Return ONLY a JSON object with these fields (only include fields mentioned): pay (number), pickups (integer), drops (integer), miles (number), items (integer).`,
        system_prompt: SYSTEM_PROMPT,
        model: 'google/gemini-2.0-flash-001',
      },
    });

    const output = (result.data as { output?: string })?.output || '';

    // Try to extract JSON from the response
    let parsed: Record<string, number> = {};
    try {
      // Find JSON in the response
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      return Response.json({
        raw: output,
        error: 'Could not parse response'
      });
    }

    return Response.json({
      raw: output,
      parsed,
    });
  } catch (error) {
    console.error('Voice API error:', error);
    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
