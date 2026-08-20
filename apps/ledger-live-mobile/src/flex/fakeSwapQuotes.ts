import { BigNumber } from "bignumber.js";
import { getCryptoCurrencyById } from "@ledgerhq/live-common/currencies/index";

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
  validFor: number;
  warnings: string[];
}

const generateQuoteId = (fromTicker: string, toTicker: string) =>
  `flex-quote-${fromTicker.toLowerCase()}-${toTicker.toLowerCase()}-${Date.now()}`;

const buildFakeQuote = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount: string = "1000000000000000000",
): FakeSwapQuote => {
  const fromCurrency = getCryptoCurrencyById(fromCurrencyId);
  const toCurrency = getCryptoCurrencyById(toCurrencyId);
  const rates: Record<string, Record<string, number>> = {
    bitcoin: { ethereum: 20, solana: 4000, tether_erc20: 47000, ton: 15000, litecoin: 150 },
    ethereum: { bitcoin: 0.05, solana: 200, tether_erc20: 2300, ton: 750, litecoin: 7.5 },
    solana: { ethereum: 0.005, bitcoin: 0.00025, tether_erc20: 11, ton: 3.7 },
    ton: { bitcoin: 0.000067, ethereum: 0.0013, solana: 0.27, tether_erc20: 3.1 },
    gram: { bitcoin: 0.000067, ethereum: 0.0013, solana: 0.27, tether_erc20: 3.1 },
    litecoin: { bitcoin: 0.0067, ethereum: 0.13, solana: 27, ton: 100 },
  };
  const fromTicker = fromCurrency?.ticker?.toLowerCase() || "unknown";
  const toTicker = toCurrency?.ticker?.toLowerCase() || "unknown";
  const rate = rates[fromCurrencyId]?.[toCurrencyId] ?? rates[fromTicker]?.[toTicker] ?? 1;
  const fromAmountBN = new BigNumber(fromAmount);
  const toAmountBN = fromAmountBN.multipliedBy(rate);
  const fromMagnitude = fromCurrency?.units?.[0]?.magnitude || 18;
  const toMagnitude = toCurrency?.units?.[0]?.magnitude || 18;
  const adjustedRate = new BigNumber(rate).dividedBy(new BigNumber(10).pow(fromMagnitude - toMagnitude));
  return {
    quoteId: generateQuoteId(fromTicker, toTicker),
    rate: adjustedRate.toString(),
    fromAmount: fromAmountBN.toString(),
    toAmount: toAmountBN.toString(),
    fromCurrency: { id: fromCurrencyId, ticker: fromCurrency?.ticker || "UNK" },
    toCurrency: { id: toCurrencyId, ticker: toCurrency?.ticker || "UNK" },
    estimatedGas: "150000",
    gasPrice: "20000000000",
    priceImpact: "0.1",
    provider: "1inch",
    validFor: 30,
    warnings: [],
  };
};

export const getFakeSwapQuote = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount?: string,
): FakeSwapQuote => buildFakeQuote(fromCurrencyId, toCurrencyId, fromAmount);

export const getFakeSwapQuotes = (
  fromCurrencyId: string,
  toCurrencyId: string,
  fromAmount?: string,
): FakeSwapQuote[] => {
  const base = getFakeSwapQuote(fromCurrencyId, toCurrencyId, fromAmount);
  return [
    base,
    { ...base, quoteId: `${base.quoteId}-uniswapx`, provider: "uniswapx", rate: new BigNumber(base.rate).multipliedBy(0.999).toString(), priceImpact: "0.05" },
    { ...base, quoteId: `${base.quoteId}-velora`, provider: "velora", rate: new BigNumber(base.rate).multipliedBy(1.001).toString(), priceImpact: "0.15" },
  ];
};
