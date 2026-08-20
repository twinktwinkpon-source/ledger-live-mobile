import type { DotIconAppearance, DotIconProps } from "@ledgerhq/lumen-ui-react";
import type { OperationType } from "@ledgerhq/types-live";
import {
  ArrowDown,
  ArrowUp,
  Close,
  Invoice,
  Link,
  Mailbox,
  PenEdit,
  Snow,
  StarFill,
  Unlink,
} from "@ledgerhq/lumen-ui-react/symbols";
import { Spinner } from "@ledgerhq/lumen-ui-react";
import {
  getTransactionalDotConfig as getConfig,
  type TransactionalDotSymbol,
} from "@ledgerhq/live-common/helpers/transactionalDotConfig";

type TransactionalDotIcon = DotIconProps["icon"];

type TransactionalDotConfig = {
  icon: TransactionalDotIcon;
  appearance: DotIconAppearance;
};

const symbolMap: Record<TransactionalDotSymbol, TransactionalDotIcon> = {
  ArrowDown,
  ArrowUp,
  Close,
  Invoice,
  Link,
  Mailbox,
  PenEdit,
  Snow,
  StarFill,
  Unlink,
  Spinner,
};

export function getTransactionalDotConfig(
  operationType: OperationType,
  isPending: boolean,
  hasFailed?: boolean,
): TransactionalDotConfig | null {
  if (hasFailed) {
    return { icon: Close, appearance: "error" };
  }

  // Transfers always render a success state (no infinite spinner) even while
  // pending: ledger-live-common would return a Spinner for pending transfers.
  if (operationType === "IN" || operationType === "NFT_IN") {
    return { icon: ArrowDown, appearance: "success" };
  }
  if (operationType === "OUT" || operationType === "NFT_OUT") {
    return { icon: ArrowUp, appearance: "success" };
  }

  const config = getConfig(operationType, isPending, hasFailed);
  if (!config) return null;
  return { icon: symbolMap[config.symbol], appearance: config.appearance };
}
