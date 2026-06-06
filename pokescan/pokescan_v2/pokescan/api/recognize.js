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
    const { name, number } = await req.json();

    if (!name) {
      return new Response(JSON.stringify({ error: 'Βάλε όνομα κάρτας' }), { status: 400 });
    }

    let query = `name:"${name}"`;
    if (number) query += ` number:${number.replace(/\//g, '')}`;

    const tcgRes = await fetch(
      `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=8&orderBy=-set.releaseDate`
    );
    const tcgData = await tcgRes.json();

    if (!tcgData.data || tcgData.data.length === 0) {
      const tcgRes2 = await fetch(
        `https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(name)}"&pageSize=8&orderBy=-set.releaseDate`
      );
      const tcgData2 = await tcgRes2.json();
      if (!tcgData2.data || tcgData2.data.length === 0) {
        return new Response(JSON.stringify({ error: 'Δεν βρέθηκε κάρτα με αυτό το όνομα.' }), { status: 404 });
      }
      tcgData.data = tcgData2.data;
    }

    const card = tcgData.data[0];

    // Try all price sources
    let price = null;
    let priceSource = null;

    // 1. CardMarket average sell price
    if (card?.cardmarket?.prices?.averageSellPrice) {
      price = card.cardmarket.prices.averageSellPrice;
      priceSource = 'CardMarket';
    }
    // 2. CardMarket trend price
    else if (card?.cardmarket?.prices?.trendPrice) {
      price = card.cardmarket.prices.trendPrice;
      priceSource = 'CardMarket';
    }
    // 3. CardMarket low price
    else if (card?.cardmarket?.prices?.lowPrice) {
      price = card.cardmarket.prices.lowPrice;
      priceSource = 'CardMarket';
    }
    // 4. TCGPlayer market
    else if (card?.tcgplayer?.prices) {
      const p = card.tcgplayer.prices;
      const pk = p.holofoil || p.normal || p.reverseHolofoil || p.unlimitedHolofoil || p['1stEdition'] || p.unlimited;
      if (pk?.market) { price = pk.market; priceSource = 'TCGPlayer'; }
      else if (pk?.mid) { price = pk.mid; priceSource = 'TCGPlayer'; }
      else if (pk?.low) { price = pk.low; priceSource = 'TCGPlayer'; }
    }

    // 5. If still no price, try fetching directly by card id
    if (!price && card?.id) {
      try {
        const directRes = await fetch(`https://api.pokemontcg.io/v2/cards/${card.id}`);
        const directData = await directRes.json();
        const dc = directData?.data;
        if (dc?.cardmarket?.prices?.averageSellPrice) {
          price = dc.cardmarket.prices.averageSellPrice;
          priceSource = 'CardMarket';
        } else if (dc?.cardmarket?.prices?.trendPrice) {
          price = dc.cardmarket.prices.trendPrice;
          priceSource = 'CardMarket';
        } else if (dc?.tcgplayer?.prices) {
          const p = dc.tcgplayer.prices;
          const pk = p.holofoil || p.normal || p.reverseHolofoil || p.unlimited;
          if (pk?.market) { price = pk.market; priceSource = 'TCGPlayer'; }
          else if (pk?.mid) { price = pk.mid; priceSource = 'TCGPlayer'; }
        }
      } catch (e) {}
    }

    const cardmarketUrl = card?.cardmarket?.url ||
      `https://www.cardmarket.com/en/Pokemon/Products/Singles?searchString=${encodeURIComponent(name)}`;

    return new Response(JSON.stringify({
      name: card.name,
      set: card.set?.name + (card.number ? ' · ' + card.number : ''),
      rarity: card.rarity || '',
      image: card.images?.large || card.images?.small || null,
      price: price ? parseFloat(parseFloat(price).toFixed(2)) : null,
      priceSource,
      cardmarketUrl,
      tcgId: card.id || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), { status: 500 });
  }
}
