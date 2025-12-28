import { fal } from '@fal-ai/client';
import { headers } from 'next/headers';
import { evaluateOffer, DEFAULT_SETTINGS } from '@/lib/calculations';

fal.config({
  credentials: process.env.FAL_KEY,
});

// CORS headers for external access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight requests
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET handler - return usage info
export async function GET() {
  return Response.json({
    usage: 'POST audio to this endpoint',
    method: 'POST',
    body: {
      audio: 'base64 string or data URI (supports wav, mp3, m4a, ogg, aac, flac)'
    },
    response: {
      parsed: { pay: 'number', pickups: 'number', drops: 'number', miles: 'number', items: 'number', restaurants: 'string[]' },
      evaluation: { verdict: 'good | decent | bad', summary: '...' },
      summary: 'Quick summary for display',
      url: 'https://paycalc.app/?pay=X&miles=Y&...'
    },
    example: 'Say something like: "8 bucks, 3 miles, 2 drops"',
    tip: 'Use the "summary" field to display results in iOS Shortcuts'
  }, { headers: corsHeaders });
}

const SYSTEM_PROMPT = `You are a voice assistant for a delivery gig pay calculator.
Listen to the audio and extract delivery offer details.

SCHEMA:
- pay: The dollar amount offered (number, e.g., 8.50)
- pickups: Number of pickup locations (integer, 1-10, default 1)
- drops: Number of drop-off locations (integer, 1-10, default 1)
- miles: Total distance in miles (number, 0-100)
- items: Number of items to shop for (integer, 0-100, default 0)
- restaurants: List of restaurant names (array of strings, default [])

RULES:
- Listen for dollar amounts, distances, store counts, drop-off counts
- "Shop" or item counts indicate shopping orders
- Only include fields mentioned in the audio
- Return ONLY valid JSON, no explanation

EXAMPLES:
- "8 bucks 3 miles Chipotle" → {"pay": 8, "miles": 3, "restaurants": ["Chipotle"]}
- "12 dollars, 2 pickups, 5 miles" → {"pay": 12, "pickups": 2, "miles": 5, "restaurants": []}
- "15 bucks for 2 drops, 4 miles, 10 items, Kroger" → {"pay": 15, "drops": 2, "miles": 4, "items": 10, "restaurants": ["Kroger"]}`;

export async function POST(request: Request) {
  try {
    const { audio } = await request.json();

    if (!audio) {
      return Response.json({ error: 'No audio provided' }, { status: 400, headers: corsHeaders });
    }

    // Handle both data URI format and raw base64
    let base64Data: string;
    let mimeType: string;

    if (audio.startsWith('data:')) {
      // Full data URI: data:audio/m4a;base64,ABC123...
      base64Data = audio.split(',')[1];
      mimeType = audio.split(';')[0].split(':')[1] || 'audio/m4a';
    } else {
      // Raw base64 string (from iOS Shortcuts, etc.)
      base64Data = audio;
      mimeType = 'audio/m4a'; // Default to m4a (common iOS format)
    }

    // Map mime type to file extension
    const extMap: Record<string, string> = {
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/flac': 'flac',
    };
    const ext = extMap[mimeType] || 'm4a';

    // Upload with proper filename so FAL can detect format
    const buffer = Buffer.from(base64Data, 'base64');
    const file = new File([buffer], `audio.${ext}`, { type: mimeType });
    const audioUrl = await fal.storage.upload(file);

    // Use openrouter/router/audio to transcribe and parse
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
    let parsed: { pay?: number; pickups?: number; drops?: number; miles?: number; items?: number; restaurants?: string[] } = {};
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      return Response.json({
        raw: output,
        error: 'Could not parse response'
      }, { headers: corsHeaders });
    }

    // Build URL with parsed parameters
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    const params = new URLSearchParams();
    if (parsed.pay !== undefined) params.set('pay', String(parsed.pay));
    if (parsed.pickups !== undefined) params.set('pickups', String(parsed.pickups));
    if (parsed.drops !== undefined) params.set('drops', String(parsed.drops));
    if (parsed.miles !== undefined) params.set('miles', String(parsed.miles));
    if (parsed.items !== undefined) params.set('items', String(parsed.items));
    if (parsed.restaurants && parsed.restaurants.length > 0) params.set('restaurants', parsed.restaurants.join(','));

    const url = `${protocol}://${host}/?${params.toString()}`;

    // Evaluate the offer if we have pay
    let evaluation = null;
    if (parsed.pay !== undefined && parsed.pay > 0) {
      evaluation = evaluateOffer({
        pay: parsed.pay,
        pickups: parsed.pickups,
        drops: parsed.drops,
        miles: parsed.miles,
        items: parsed.items
      }, DEFAULT_SETTINGS);
    }

    return Response.json({
      parsed,
      evaluation,
      summary: evaluation?.summary || 'Could not evaluate offer',
      url,
      pay: parsed.pay,
      miles: parsed.miles,
      pickups: parsed.pickups,
      restaurants: parsed.restaurants,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Audio API error:', error);
    if (error && typeof error === 'object' && 'body' in error) {
      console.error('Error body:', JSON.stringify((error as { body: unknown }).body, null, 2));
    }
    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error && typeof error === 'object' && 'body' in error ? (error as { body: unknown }).body : undefined
    }, { status: 500, headers: corsHeaders });
  }
}
