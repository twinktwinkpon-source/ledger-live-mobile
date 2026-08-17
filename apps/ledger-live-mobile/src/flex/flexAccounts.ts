/**
 * FLEX account builder — turns server balances into real `Account` objects so
 * the wallet can display them. This is a pure, side-effect-free builder used by
 * the `accounts` selectors overlay: it never touches the store, never reboots
 * the app, and never persists anything. The UI reads the same `Account` shape
 * the app already uses everywhere.
 */
import BigNumber from "bignumber.js";
import { v4 as uuid } from "uuid";
import { Account } from "@ledgerhq/types-live";
import { genAccount } from "@ledgerhq/live-common/mock/account";
import {
  getCryptoCurrencyById,
  listSupportedCurrencies,
} from "@ledgerhq/live-common/currencies/index";
import { FlexBalanceMap } from "./constants";
import { wholeToSmallest } from "./server";

/** Cache one generated account template per currency id (created lazily). */
const templateCache = new Map<string, Account>();

function getTemplate(currencyId: string): Account | null {
  const cached = templateCache.get(currencyId);
  if (cached) return cached;
  try {
    let currency;
    try {
      currency = getCryptoCurrencyById(currencyId);
    } catch {
      return null;
    }
    const supported = listSupportedCurrencies().some(c => c.id === currencyId);
    if (!supported) return null;
    const account = genAccount(uuid(), { currency });
    templateCache.set(currencyId, account);
    return account;
  } catch {
    return null;
  }
}

export function clearFlexAccountTemplates(): void {
  templateCache.clear();
}

/**
 * Build the account list for the given server balances (whole units).
 * Only currencies supported by this build are included.
 */
export function buildFlexAccounts(balancesWhole: FlexBalanceMap): Account[] {
  const balancesSmallest = wholeToSmallest(balancesWhole);
  const accounts: Account[] = [];

  for (const currencyId of Object.keys(balancesWhole)) {
    const template = getTemplate(currencyId);
    if (!template) continue;
    const balance = new BigNumber(balancesSmallest[currencyId] || "0");
    const account: Account = {
      ...template,
      balance,
      spendableBalance: balance,
      lastSyncDate: new Date(),
    };
    accounts.push(account);
  }

  return accounts;
}
