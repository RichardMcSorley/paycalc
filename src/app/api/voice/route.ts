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

    // Convert base64 data URI to a File with proper extension
    const base64Data = audio.split(',')[1];
    const mimeType = audio.split(';')[0].split(':')[1] || 'audio/mp4';

    // Map mime type to file extension
    const extMap: Record<string, string> = {
      'audio/mp4': 'mp4',
      'audio/m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/mpeg': 'mp3',
    };
    const ext = extMap[mimeType] || 'mp4';

    // Upload with proper filename so FAL can detect format
    const buffer = Buffer.from(base64Data, 'base64');
    const file = new File([buffer], `audio.${ext}`, { type: mimeType });
    const audioUrl = await fal.storage.upload(file);

    // Use openrouter/router/audio to transcribe and parse in one call
    const result = await fal.subscribe('openrouter/router/audio', {
      input: {
        audio_url: audioUrl,
        prompt: `Extract delivery offer details from this audio. Return ONLY a JSON object with these fields (only include fields mentioned): pay (number), pickups (integer), drops (integer), miles (number), items (integer).`,
        system_prompt: SYSTEM_PROMPT,
        model: 'google/gemini-3-flash-preview',
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
    // Log more details if available
    if (error && typeof error === 'object' && 'body' in error) {
      console.error('Error body:', JSON.stringify((error as { body: unknown }).body, null, 2));
    }
    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error && typeof error === 'object' && 'body' in error ? (error as { body: unknown }).body : undefined
    }, { status: 500 });
  }
}
