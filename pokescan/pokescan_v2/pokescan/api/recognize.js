export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), { status: 400 });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    // Clean base64
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // Ask Gemini to identify the card
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `Look at this Pokemon Trading Card Game card image. Tell me the card name, set name, and card number. Reply in this exact format with nothing else:
NAME: [card name]
SET: [set name]
NUMBER: [card number]
RARITY: [rarity]

If it is not a Pokemon card, reply: NOT_A_CARD`
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        })
      }
    );

    const geminiData = await geminiRes.json();
    
    if (!geminiRes.ok) {
      return new Response(JSON.stringify({ error: 'Gemini error: ' + JSON.stringify(geminiData) }), { status: 500 });
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!rawText || rawText.includes('NOT_A_CARD')) {
      return new Response(JSON.stringify({ error: 'Δεν αναγνωρίστηκε Pokemon κάρτα' }), { status: 422 });
    }

    // Parse the simple format
    const getName = (t) => t.match(/NAME:\s*(.+)/i)?.[1]?.trim() || '';
    const getSet  = (t) => t.match(/SET:\s*(.+)/i)?.[1]?.trim() || '';
    const getNum  = (t) => t.match(/NUMBER:\s*(.+)/i)?.[1]?.trim() || '';
    const getRar  = (t) => t.match(/RARITY:\s*(.+)/i)?.[1]?.trim() || '';

    const cardName = getName(rawText);
    const cardSet  = getSet(rawText);
    const cardNum  = getNum(rawText);
    const cardRar  = getRar(rawText);

    if (!cardName) {
      return new Response(JSON.stringify({ error: 'Δεν βρέθηκε όνομα κάρτας', raw: rawText }), { status: 422 });
    }

    // Search Pokemon TCG API
    const searchName = encodeURIComponent(cardName);
    const tcgRes = await fetch(
      `https://api.pokemontcg.io/v2/cards?q=name:"${searchName}"&pageSize=8`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    const tcgData = await tcgRes.json();

    let matchedCard = null;
    if (tcgData.data && tcgData.data.length > 0) {
      matchedCard = tcgData.data.find(c =>
        c.number === cardNum ||
        c.set?.name?.toLowerCase().includes(cardSet.toLowerCase().split(' ')[0])
      ) || tcgData.data[0];
    }

    // Get price
    let price = null;
    let priceSource = null;
    if (matchedCard?.cardmarket?.prices?.averageSellPrice) {
      price = matchedCard.cardmarket.prices.averageSellPrice;
      priceSource = 'CardMarket';
    } else if (matchedCard?.tcgplayer?.prices) {
      const p = matchedCard.tcgplayer.prices;
      const pk = p.holofoil || p.normal || p.reverseHolofoil || p['1stEditionHolofoil'];
      if (pk?.market) { price = pk.market; priceSource = 'TCGPlayer'; }
      else if (pk?.mid) { price = pk.mid; priceSource = 'TCGPlayer'; }
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
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
