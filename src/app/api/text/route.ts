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
    usage: 'POST text to this endpoint',
    method: 'POST',
    body: {
      text: 'Text to parse (e.g., "$8.50 for 3.2 miles, 2 drops")'
    },
    response: {
      parsed: { pay: 'number', pickups: 'number', drops: 'number', miles: 'number', items: 'number', restaurants: 'string[]' },
      summary: 'Quick summary for display',
      url: 'https://paycalc.app/?pay=X&miles=Y&...'
    },
    examples: [
      '$8.50 for 3 miles',
      '12 dollars, 2 drops, 5 miles',
      'Batch: $24.34 + $24.21 tip, 34.1 mi, 2 shop and deliver, 44 items'
    ]
  }, { headers: corsHeaders });
}

const SYSTEM_PROMPT = `You extract delivery offer details from text. Return ONLY valid JSON.

SCHEMA:
- pay: Total dollar amount (number) - add base + tip if separate
- pickups: Number of pickups (integer, default 1)
- drops: Number of drop-offs (integer, default 1)
- miles: Distance in miles (number)
- items: Shopping items count (integer, default 0)
- restaurants: List of restaurant names (array of strings, default [])

RULES:
- Add base pay + tip together for total pay
- "batch" or multiple orders = multiple drops
- "shop and deliver" = has items
- Only include fields you find
- Return ONLY JSON, no explanation

EXAMPLES:
Input: "$8.50 for 3 miles, Chipotle, Bob Evans"
Output: {"pay": 8.5, "miles": 3, "restaurants": ["Chipotle", "Bob Evans"]}

Input: "$24.34 batch earnings + $24.21 tip, 34.1 mi, 2 shop and deliver, 44 items, Kroger"
Output: {"pay": 48.55, "miles": 34.1, "drops": 2, "items": 44, "restaurants": ["Kroger"]}

Input: "12 bucks 2 pickups 5 miles"
Output: {"pay": 12, "pickups": 2, "miles": 5, "restaurants": []}`;

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text) {
      return Response.json({ error: 'No text provided' }, { status: 400, headers: corsHeaders });
    }

    // Use openrouter/router for text completion
    const result = await fal.subscribe('openrouter/router', {
      input: {
        prompt: `${SYSTEM_PROMPT}\n\nInput: "${text}"\nOutput:`,
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
    console.error('Text API error:', error);
    if (error && typeof error === 'object' && 'body' in error) {
      console.error('Error body:', JSON.stringify((error as { body: unknown }).body, null, 2));
    }
    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error && typeof error === 'object' && 'body' in error ? (error as { body: unknown }).body : undefined
    }, { status: 500, headers: corsHeaders });
  }
}
