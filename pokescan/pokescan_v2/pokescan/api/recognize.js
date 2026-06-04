export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { imageBase64 } = body;

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), { status: 400 });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 500 });
    }

    const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : imageBase64;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: `Is this a Pokemon TCG card? If yes, reply ONLY in this format:\nNAME: [exact pokemon name]\nSET: [set name]\nNUMBER: [card number]\nRARITY: [rarity]\n\nIf not a Pokemon card reply: NOT_POKEMON` }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: 'Gemini API error: ' + errText }), { status: 500 });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!rawText || rawText.includes('NOT_POKEMON')) {
      return new Response(JSON.stringify({ error: 'Δεν αναγνωρίστηκε Pokemon κάρτα. Δοκίμασε ξανά με καλύτερο φωτισμό.' }), { status: 422 });
    }

    const cardName = rawText.match(/NAME:\s*(.+)/i)?.[1]?.trim() || '';
    const cardSet  = rawText.match(/SET:\s*(.+)/i)?.[1]?.trim() || '';
    const cardNum  = rawText.match(/NUMBER:\s*(.+)/i)?.[1]?.trim() || '';
    const cardRar  = rawText.match(/RARITY:\s*(.+)/i)?.[1]?.trim() || '';

    if (!cardName) {
      return new Response(JSON.stringify({ error: 'Δεν αναγνωρίστηκε η κάρτα. Δοκίμασε ξανά.' }), { status: 422 });
    }

    let matchedCard = null;
    try {
      const tcgRes = await fetch(`https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(cardName)}"&pageSize=8`);
      const tcgData = await tcgRes.json();
      if (tcgData.data?.length > 0) {
        matchedCard = tcgData.data.find(c =>
          c.number === cardNum ||
          c.set?.name?.toLowerCase().includes((cardSet || '').toLowerCase().split(' ')[0])
        ) || tcgData.data[0];
      }
    } catch (e) {}

    let price = null;
    let priceSource = null;
    if (matchedCard?.cardmarket?.prices?.averageSellPrice) {
      price = matchedCard.cardmarket.prices.averageSellPrice;
      priceSource = 'CardMarket';
    } else if (matchedCard?.tcgplayer?.prices) {
      const p = matchedCard.tcgplayer.prices;
      const pk = p.holofoil || p.normal || p.reverseHolofoil;
      if (pk?.market) { price = pk.market; priceSource = 'TCGPlayer'; }
    }

    return new Response(JSON.stringify({
      name: cardName,
      set: cardSet + (cardNum ? ' · ' + cardNum : ''),
      rarity: cardRar,
      image: matchedCard?.images?.large || matchedCard?.images?.small || null,
      price: price ? parseFloat(price.toFixed(2)) : null,
      priceSource,
      cardmarketUrl: matchedCard?.cardmarket?.url || `https://www.cardmarket.com/en/Pokemon/Products/Singles?searchString=${encodeURIComponent(cardName)}`,
      tcgId: matchedCard?.id || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), { status: 500 });
  }
}
