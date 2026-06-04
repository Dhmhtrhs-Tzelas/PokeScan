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
    const POKEMON_KEY = process.env.POKEMON_TCG_API_KEY || '';

    // Step 1: Ask Gemini to identify the card
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `This is a Pokemon Trading Card Game card. Please identify it and respond ONLY with a JSON object in this exact format, nothing else:
{
  "name": "exact card name",
  "set": "set name",
  "number": "card number like 025/185",
  "rarity": "Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare",
  "hp": "HP number or null",
  "type": "Pokemon type like Fire/Water/etc or Trainer or Energy"
}
If you cannot identify it as a Pokemon card, return: {"error": "not a pokemon card"}`
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
                }
              }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        })
      }
    );

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let cardInfo;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      cardInfo = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse card info', raw: rawText }), { status: 422 });
    }

    if (cardInfo.error) {
      return new Response(JSON.stringify({ error: cardInfo.error }), { status: 422 });
    }

    // Step 2: Search Pokemon TCG API for price
    const searchName = encodeURIComponent(cardInfo.name);
    const tcgHeaders = { 'Content-Type': 'application/json' };
    if (POKEMON_KEY) tcgHeaders['X-Api-Key'] = POKEMON_KEY;

    const tcgRes = await fetch(
      `https://api.pokemontcg.io/v2/cards?q=name:"${searchName}"&pageSize=10`,
      { headers: tcgHeaders }
    );
    const tcgData = await tcgRes.json();

    // Find best matching card
    let matchedCard = null;
    if (tcgData.data && tcgData.data.length > 0) {
      // Try to match by set name too
      matchedCard = tcgData.data.find(c =>
        c.set?.name?.toLowerCase().includes(cardInfo.set?.toLowerCase()?.split(' ')?.[0] || '') ||
        c.number === cardInfo.number
      ) || tcgData.data[0];
    }

    // Build price info
    let price = null;
    let priceSource = null;
    if (matchedCard?.tcgplayer?.prices) {
      const prices = matchedCard.tcgplayer.prices;
      const priceKey = prices.holofoil || prices.normal || prices.reverseHolofoil || prices['1stEditionHolofoil'];
      if (priceKey?.market) {
        price = priceKey.market;
        priceSource = 'TCGPlayer';
      } else if (priceKey?.mid) {
        price = priceKey.mid;
        priceSource = 'TCGPlayer';
      }
    }
    if (!price && matchedCard?.cardmarket?.prices?.averageSellPrice) {
      price = matchedCard.cardmarket.prices.averageSellPrice;
      priceSource = 'CardMarket';
    }

    const result = {
      name: cardInfo.name,
      set: cardInfo.set,
      number: cardInfo.number,
      rarity: cardInfo.rarity,
      type: cardInfo.type,
      hp: cardInfo.hp,
      image: matchedCard?.images?.large || matchedCard?.images?.small || null,
      price: price ? parseFloat(price.toFixed(2)) : null,
      priceSource,
      cardmarketUrl: matchedCard?.cardmarket?.url || `https://www.cardmarket.com/en/Pokemon/Cards/Singles?searchString=${encodeURIComponent(cardInfo.name)}`,
      tcgId: matchedCard?.id || null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
