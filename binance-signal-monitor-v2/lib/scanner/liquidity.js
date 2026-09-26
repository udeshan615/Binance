export function detectLiquidity(candles, swings) {
  const liq = {
    equalHighs: [],
    equalLows: [],
    buySide: null,
    sellSide: null,
  };
  const tol = 0.0015;
  const highs = swings.filter((s) => s.type === 'H');
  const lows = swings.filter((s) => s.type === 'L');

  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (
        Math.abs(highs[i].price - highs[j].price) / highs[i].price <
        tol
      ) {
        liq.equalHighs.push({
          price: (highs[i].price + highs[j].price) / 2,
          count: 2,
        });
      }
    }
  }
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) / lows[i].price < tol) {
        liq.equalLows.push({
          price: (lows[i].price + lows[j].price) / 2,
          count: 2,
        });
      }
    }
  }
  if (highs.length) liq.buySide = Math.max(...highs.map((h) => h.price));
  if (lows.length) liq.sellSide = Math.min(...lows.map((l) => l.price));
  return liq;
}
