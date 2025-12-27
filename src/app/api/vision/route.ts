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
    usage: 'POST an image to this endpoint',
    method: 'POST',
    body: {
      image: 'base64 string or data URI'
    },
    response: {
      parsed: { pay: 'number', pickups: 'number', drops: 'number', miles: 'number', items: 'number' },
      evaluation: {
        verdict: 'good | decent | bad',
        verdictEmoji: '🟢 | 🟡 | 🔴',
        effectiveHourly: 'number',
        requiredPay: 'number',
        maxMiles: 'number',
        summary: 'Human readable summary'
      },
      summary: 'Quick summary for display (e.g., "🟢 GOOD: $25/hr effective")',
      url: 'https://paycalc.app/?pay=X&miles=Y&...'
    },
    tip: 'Use the "summary" field to display results in iOS Shortcuts'
  }, { headers: corsHeaders });
}

const SYSTEM_PROMPT = `You are a vision assistant for a delivery gig pay calculator.
Look at the screenshot of a delivery offer and extract the following fields:

SCHEMA:
- pay: The dollar amount offered (number, e.g., 8.50)
- pickups: Number of pickup locations (integer, 1-10, default 1)
- drops: Number of drop-off locations (integer, 1-10, default 1)
- miles: Total distance in miles (number, 0-100)
- items: Number of items to shop for (integer, 0-100, default 0)

RULES:
- Look for dollar amounts, distances, store counts, drop-off counts
- "Shop & Deliver" or item counts indicate shopping orders
- Multiple store pickups or customer drop-offs should be counted
- Only include fields you can clearly identify
- Return ONLY valid JSON, no explanation`;

export async function POST(request: Request) {
  try {
    const { image } = await request.json();

    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400, headers: corsHeaders });
    }

    // Handle both data URI format and raw base64
    let base64Data: string;
    let mimeType: string;

    if (image.startsWith('data:')) {
      // Full data URI: data:image/png;base64,ABC123...
      base64Data = image.split(',')[1];
      mimeType = image.split(';')[0].split(':')[1] || 'image/png';
    } else {
      // Raw base64 string (from iOS Shortcuts, etc.)
      base64Data = image;
      mimeType = 'image/png'; // Default to PNG
    }

    // Map mime type to file extension
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = extMap[mimeType] || 'png';

    // Upload with proper filename so FAL can detect format
    const buffer = Buffer.from(base64Data, 'base64');
    const file = new File([buffer], `screenshot.${ext}`, { type: mimeType });
    const imageUrl = await fal.storage.upload(file);

    // Use openrouter/router/vision to analyze the screenshot
    const result = await fal.subscribe('openrouter/router/vision', {
      input: {
        image_urls: [imageUrl],
        prompt: `Extract delivery offer details from this screenshot. Return ONLY a JSON object with these fields (only include fields you can identify): pay (number), pickups (integer), drops (integer), miles (number), items (integer).`,
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
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Vision API error:', error);
    // Log more details if available
    if (error && typeof error === 'object' && 'body' in error) {
      console.error('Error body:', JSON.stringify((error as { body: unknown }).body, null, 2));
    }
    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error && typeof error === 'object' && 'body' in error ? (error as { body: unknown }).body : undefined
    }, { status: 500, headers: corsHeaders });
  }
}
