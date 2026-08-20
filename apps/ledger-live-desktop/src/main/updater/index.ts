let updater: {
  quitAndInstall?: () => void;
} = {};
export default (type: string) => {
  console.log(`UPDATER: ${type}`);
  // Auto-updates are disabled for the FLEX distribution — there is no official
  // Ledger update feed to hit, and the 404 noise just spams the logs. Restore
  // by removing this guard (e.g. once a private update server exists).
  if (type === "init") {
    console.log("UPDATER: disabled for FLEX distribution");
    return;
  }
  switch (type) {
    case "quit-and-install":
      if (!updater.quitAndInstall) {
        console.error(`Auto-update error: quitAndInstall called before init`);
      } else {
        updater.quitAndInstall();
      }
      break;
    default:
      console.error(`Unknown updater message type: ${type}`);
      break;
  }
};
