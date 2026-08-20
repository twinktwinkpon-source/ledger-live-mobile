import React, { useMemo } from "react";
import { Currency } from "@ledgerhq/types-cryptoassets";
import { CryptoIcon } from "@ledgerhq/crypto-icons";
import { getValidCryptoIconSize } from "~/renderer/utils/cryptoIconSize";
import { getCryptoIconColorFilter } from "~/renderer/utils/colorFilter";
import useTheme from "~/renderer/hooks/useTheme";
import ensureContrast from "~/renderer/ensureContrast";

type Props = {
  currency: Currency;
  size: number;
};

const CryptoCurrencyIcon = ({ currency, size }: Props) => {
  if (currency.type === "FiatCurrency") {
    return null;
  }

  const theme = useTheme();
  const cryptoColor = useMemo(
    () =>
      currency.type === "CryptoCurrency"
        ? ensureContrast(currency.color, theme.colors.background.card)
        : "",
    [currency, theme.colors.background.card],
  );

  const ledgerId = currency.id;
  const ticker = currency.ticker;
  const iconSize = size;
  const validSize = getValidCryptoIconSize(iconSize);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: validSize,
        height: validSize,
        filter: cryptoColor ? getCryptoIconColorFilter(cryptoColor) : undefined,
      }}
    >
      <CryptoIcon
        ledgerId={ledgerId}
        ticker={ticker}
        size={validSize}
        network={currency.type === "TokenCurrency" ? currency.parentCurrency.id : undefined}
      />
    </span>
  );
};

export default CryptoCurrencyIcon;
