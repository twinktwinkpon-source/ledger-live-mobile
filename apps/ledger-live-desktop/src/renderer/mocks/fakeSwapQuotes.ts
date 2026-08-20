/**
 * Fake Swap Quotes - Returns mock quote data for demo/flex builds
 * Intercepts swap quote fetching to provide instant fake quotes without network calls.
 */
import { BigNumber } from "bignumber.js";
import { getCryptoCurrencyById } from "@ledgerhq/live-common/currencies/index";

// Mock swap quote response that looks like a real 1inch/UniswapX quote
export interface FakeSwapQuote {
  quoteId: string;
  rate: string;
  fromAmount: string;
  toAmount: string;
  fromCurrency: { id: string; ticker: string };
  toCurrency: { id: string; ticker: string };
  estimatedGas: string;
  gasPrice: string;
  priceImpact: string;
  provider: string;
  validFor: number; // seconds
  warnings: string[];
}

// Generate a deterministic but unique quote ID
const generateQuoteId = (fromTicker: string, toTicker: string) => {
  return `flex-quote-${fromTicker.toLowerCase()}-${toTicker.toLowerCase()}-${Date.now()}`;
};

// Build a fake swap quote for a given pair
const buildFakeQuote = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount: string = "1000000000000000000" // 1 ETH in wei
): FakeSwapQuote => {
  const fromCurrency = getCryptoCurrencyById(fromCurrencyId);
  const toCurrency = getCryptoCurrencyById(toCurrencyId);

  // Simple rate calculation (mock)
  const rates: Record<string, Record<string, number>> = {
    ethereum: { bitcoin: 0.05, solana: 200, tether_erc20: 2300 },
    tether_erc20: { ethereum: 0.00043, bitcoin: 0.000021, solana: 0.087 },
    bitcoin: { ethereum: 20, tether_erc20: 47000, solana: 4000 },
    solana: { ethereum: 0.005, tether_erc20: 23, bitcoin: 0.00025 },
  };

  const fromTicker = fromCurrency?.ticker?.toLowerCase() || "unknown";
  const toTicker = toCurrency?.ticker?.toLowerCase() || "unknown";

  const rate = rates[fromTicker]?.[toTicker] || 1;
  const fromAmountBN = new BigNumber(fromAmount);
  const toAmountBN = fromAmountBN.multipliedBy(rate);

  // Adjust for decimals
  const fromMagnitude = fromCurrency?.units?.[0]?.magnitude || 18;
  const toMagnitude = toCurrency?.units?.[0]?.magnitude || 18;

  const adjustedRate = new BigNumber(rate).dividedBy(
    new BigNumber(10).pow(fromMagnitude - toMagnitude)
  );

  return {
    quoteId: generateQuoteId(fromTicker, toTicker),
    rate: adjustedRate.toString(),
    fromAmount: fromAmountBN.toString(),
    toAmount: toAmountBN.toString(),
    fromCurrency: { id: fromCurrencyId, ticker: fromCurrency?.ticker || "UNK" },
    toCurrency: { id: toCurrencyId, ticker: toCurrency?.ticker || "UNK" },
    estimatedGas: "150000",
    gasPrice: "20000000000", // 20 gwei
    priceImpact: "0.1",
    provider: "1inch",
    validFor: 30,
    warnings: [],
  };
};

// Pre-built quotes for common pairs
const DEMO_QUOTES: Record<string, FakeSwapQuote> = {};

// Get a fake quote for a currency pair
export const getFakeSwapQuote = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount?: string
): FakeSwapQuote => {
  const key = `${fromCurrencyId}->${toCurrencyId}`;
  if (DEMO_QUOTES[key]) {
    return DEMO_QUOTES[key];
  }
  const quote = buildFakeQuote(fromCurrencyId, toCurrencyId, fromAmount);
  DEMO_QUOTES[key] = quote;
  return quote;
};

// Get multiple fake quotes (simulating provider responses)
export const getFakeSwapQuotes = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount?: string
): FakeSwapQuote[] => {
  const baseQuote = getFakeSwapQuote(fromCurrencyId, toCurrencyId, fromAmount);
  // Return array with slight variations simulating multiple providers
  return [
    baseQuote,
    {
      ...baseQuote,
      quoteId: `${baseQuote.quoteId}-uniswapx`,
      provider: "uniswapx",
      rate: new BigNumber(baseQuote.rate).multipliedBy(0.999).toString(),
      priceImpact: "0.05",
    },
    {
      ...baseQuote,
      quoteId: `${baseQuote.quoteId}-velora`,
      provider: "velora",
      rate: new BigNumber(baseQuote.rate).multipliedBy(1.001).toString(),
      priceImpact: "0.15",
    },
  ];
};