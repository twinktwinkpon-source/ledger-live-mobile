import { reduce, firstValueFrom } from "rxjs";
import { Strategy } from "@ledgerhq/coin-evm/types/index";
import { getMainAccount, getParentAccount } from "@ledgerhq/live-common/account/index";
import { getAccountBridge } from "@ledgerhq/live-common/bridge/index";
import { getAbandonSeedAddress } from "@ledgerhq/live-common/currencies/index";
import { TransactionStatus } from "@ledgerhq/live-common/generated/types";
import {
  getAccountIdFromWalletAccountId,
  getWalletApiIdFromAccountId,
} from "@ledgerhq/live-common/wallet-api/converters";
import { AccountLike, Account } from "@ledgerhq/types-live";
import { log } from "@ledgerhq/logs";
import BigNumber from "bignumber.js";
import { NavigatorName, ScreenName } from "~/const";
import { NavigationType } from ".";
import { convertToAtomicUnit, convertToNonAtomicUnit, getCustomFeesPerFamily } from "../utils";

// Constants
const CHAINS_WITH_FEE_DRAWER = ["evm"];
const getSegWitAbandonSeedAddress = (): string => "bc1qed3mqr92zvq2s782aqkyx785u23723w02qfrgs";

// Types
type TransformableObject = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export interface FeeParams {
  fromAccountId: string;
  fromAmount: string;
  feeStrategy: Strategy;
  openDrawer: boolean;
  customFeeConfig: Record<string, unknown>;
  SWAP_VERSION: string;
  gasLimit?: string;
  data?: string;
  recipient?: string;
}

export interface FeeData {
  feesStrategy: Strategy;
  estimatedFees: BigNumber | undefined;
  errors: TransactionStatus["errors"];
  warnings: TransactionStatus["warnings"];
  customFeeConfig: Record<string, unknown>;
  hasDrawer: boolean;
  gasLimit: BigNumber | null;
}

// Helper functions
export function transformToBigNumbers(obj: TransformableObject): TransformableObject {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  const transformedObj: TransformableObject = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === "string" && !isNaN(value as unknown as number)) {
        transformedObj[key] = new BigNumber(value);
      } else if (typeof value === "object") {
        transformedObj[key] = transformToBigNumbers(value);
      } else {
        transformedObj[key] = value;
      }
    }
  }

  return transformedObj;
}

/**
 * Creates a fee data object from transaction status and other parameters
 */
function createFeeData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalTx: any,
  status: TransactionStatus,
  customFeeConfig: Record<string, unknown>,
  hasDrawer: boolean,
  mainAccount: AccountLike,
): FeeData {
  return {
    feesStrategy: finalTx.feesStrategy,
    estimatedFees: convertToNonAtomicUnit({
      amount: status.estimatedFees,
      account: mainAccount,
    }),
    errors: status.errors,
    warnings: status.warnings,
    customFeeConfig,
    hasDrawer,
    gasLimit: finalTx.gasLimit,
  };
}

/**
 * Gets the appropriate recipient address based on currency
 */
function getRecipientAddress(currencyId: string): string {
  return currencyId === "bitcoin"
    ? getSegWitAbandonSeedAddress()
    : getAbandonSeedAddress(currencyId);
}

/**
 * Main function to get fee data for a transaction
 */
export const getFee =
  (accounts: AccountLike[], navigation: NavigationType, isFlex = false) =>
  async ({ params }: { params: FeeParams }): Promise<FeeData> => {
    // Validate and find account
    const realFromAccountId = getAccountIdFromWalletAccountId(params.fromAccountId);

    // FLEX: in the demo build BridgeSync is off, so the wallet-api UUID→accountId
    // map is never populated and the live-app's params.fromAccountId (a uuidv5 id)
    // fails the strict lookup below → "Не получилось рассчитать комиссию". Resolve
    // the account deterministically by recomputing each account's wallet-api id.
    const flexFromAccount = isFlex
      ? accounts.find(acc => getWalletApiIdFromAccountId(acc.id) === params.fromAccountId) ||
        accounts[0]
      : undefined;

    // FLEX: the swap live-app calls custom.getFee during its own boot, which can
    // race ahead of the async flex hydration (accounts still empty). Never reject
    // in flex mode — return a deterministic synthetic fee so the live-app renders
    // the native fee row instead of the error box (mirrors desktop SwapWebViewDemo3).
    if (isFlex && !flexFromAccount) {
      return {
        feesStrategy: params.feeStrategy || "medium",
        estimatedFees: new BigNumber("0.00012"),
        errors: {},
        warnings: {},
        customFeeConfig: params.customFeeConfig || {},
        hasDrawer: false,
        gasLimit: null,
      };
    }
    if (!realFromAccountId && !flexFromAccount) {
      return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
    }

    const fromAccount = accounts.find(acc => acc.id === realFromAccountId) || flexFromAccount;
    if (!fromAccount) {
      return Promise.reject(new Error(`accountId ${params.fromAccountId} unknown`));
    }

    // Setup accounts and bridge
    const fromParentAccount = getParentAccount(fromAccount, accounts);
    let mainAccount = getMainAccount(fromAccount, fromParentAccount);

    // FLEX: fake accounts have no real chain backing. The real bridge can throw or
    // return error statuses (BTC bridge.sync on a pseudo-address fails → "Не
    // получилось рассчитать комиссию"). Return deterministic synthetic fees and
    // keep the native drawer/animations flow untouched. Mirrors desktop.
    if (isFlex) {
      const family = (mainAccount.currency.family || "").toLowerCase();
      const feeByFamily: Record<string, string> = {
        bitcoin: "0.00012",
        evm: "0.00021",
        solana: "0.000005",
        tron: "1.1",
        ton: "0.0055",
      };
      const feeAmount = feeByFamily[family] ?? "0.0001";
      const magnitude = mainAccount.currency.units[0]?.magnitude ?? 8;
      const feeAtomic = new BigNumber(feeAmount).shiftedBy(magnitude);
      return {
        feesStrategy: params.feeStrategy || "medium",
        // NOTE: return a plain string — the live-app zod schema rebuilds
        // BigNumber from string/number after the postMessage serialization
        // boundary; a BigNumber instance arrives as a prototype-less object
        // and fails `instanceof`, surfacing the fee error again.
        estimatedFees: convertToNonAtomicUnit({
          amount: feeAtomic,
          account: mainAccount,
        })?.toString() as unknown as BigNumber,
        errors: {},
        warnings: {},
        customFeeConfig: params.customFeeConfig || {},
        hasDrawer: false,
        gasLimit: null,
      };
    }

    const bridge = await getAccountBridge(fromAccount, fromParentAccount);

    if (mainAccount.currency.id === "bitcoin") {
      try {
        const syncedAccount = await firstValueFrom(
          bridge
            .sync(mainAccount, { paginationConfig: {} })
            .pipe(reduce((a, f: (arg0: Account) => Account) => f(a), mainAccount)),
        );

        if (syncedAccount) {
          mainAccount = syncedAccount;
        }
      } catch (e) {
        log("swap", "Error syncing account", e);
      }
    }

    // Create and prepare transaction
    const subAccountId = fromAccount.type !== "Account" && fromAccount.id;
    const transaction = bridge.createTransaction(mainAccount);

    const preparedTransaction = await bridge.prepareTransaction(mainAccount, {
      ...transaction,
      subAccountId,
      recipient: params.recipient || getRecipientAddress(mainAccount.currency.id),
      amount: convertToAtomicUnit({
        amount: new BigNumber(params.fromAmount),
        account: fromAccount,
      }),
      data: (params.data && Buffer.from(params.data.replace("0x", ""), "hex")) || undefined,
      feesStrategy: params.feeStrategy || "medium",
      customGasLimit: params.gasLimit ? new BigNumber(params.gasLimit) : null,
      ...transformToBigNumbers(params.customFeeConfig),
    });

    // Get transaction status and fee config
    const status = await bridge.getTransactionStatus(mainAccount, preparedTransaction);
    const finalTx = preparedTransaction;
    const customFeeConfig = transaction && getCustomFeesPerFamily(finalTx);

    // Check if chain supports fee drawer
    const hasDrawer =
      CHAINS_WITH_FEE_DRAWER.includes(transaction.family) &&
      !["optimism", "arbitrum", "base"].includes(mainAccount.currency.id);

    // Handle fee drawer navigation if requested
    if (params.openDrawer) {
      return new Promise(resolve => {
        navigation.navigate(NavigatorName.Fees, {
          screen: ScreenName.FeeHomePage,
          params: {
            onSelect: async (feesStrategy, customFeeConfig) => {
              const newFeeData = {
                // little hack to make sure we do not return null (for bitcoin for instance)
                feesStrategy: feesStrategy || finalTx.feesStrategy || "custom",
                estimatedFees: convertToNonAtomicUnit({
                  amount: status.estimatedFees,
                  account: mainAccount,
                }),
                errors: status.errors,
                warnings: status.warnings,
                customFeeConfig,
                hasDrawer,
                gasLimit: finalTx.gasLimit,
              };

              resolve(newFeeData as FeeData);
              navigation.canGoBack() && navigation.goBack();
            },
            account: fromAccount,
            feePayingAccount: mainAccount,
            fromAmount: new BigNumber(params.fromAmount),
            feesStrategy: params.feeStrategy,
            customFeeConfig: params.customFeeConfig,
            transaction: transaction,
          },
        });
      });
    }

    // Return fee data directly if drawer not requested
    return createFeeData(finalTx, status, customFeeConfig, hasDrawer, mainAccount);
  };
