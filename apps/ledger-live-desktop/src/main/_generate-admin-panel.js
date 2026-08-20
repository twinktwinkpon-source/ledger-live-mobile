const fs = require("fs");
const path = require("path");

const images = JSON.parse(
  fs.readFileSync(path.join(__dirname, "_device_images.json"), "utf8")
);

const DEVICE_DATA_URI = {
  stax: `data:image/png;base64,${images.stax}`,
  flex: `data:image/png;base64,${images.flex}`,
  nanoX: `data:image/png;base64,${images.nanoX}`,
  nanoSP: `data:image/png;base64,${images.nanoSP}`,
};

// Ledger CDN native crypto logos — the same PNGs the real Ledger Live app uses.
const CRYPTO_ICON_URL = "https://crypto-icons.ledger.com";

const ASSETS = [
  { id: "bitcoin", name: "Bitcoin", ticker: "BTC", color: "#f7931a" },
  { id: "ethereum", name: "Ethereum", ticker: "ETH", color: "#627eea" },
  { id: "solana", name: "Solana", ticker: "SOL", color: "#9945ff" },
  { id: "ripple", name: "XRP", ticker: "XRP", color: "#23292f" },
  { id: "cardano", name: "Cardano", ticker: "ADA", color: "#0033ad" },
  { id: "dogecoin", name: "Dogecoin", ticker: "DOGE", color: "#c2a633" },
  { id: "polkadot", name: "Polkadot", ticker: "DOT", color: "#e6007a" },
  { id: "tron", name: "TRON", ticker: "TRX", color: "#ff060a" },
  { id: "polygon", name: "Polygon", ticker: "MATIC", color: "#8247e5" },
  { id: "ton", name: "Gram", ticker: "GRAM", color: "#0098ea" },
  { id: "litecoin", name: "Litecoin", ticker: "LTC", color: "#bfbbbb" },
  { id: "bitcoin_cash", name: "Bitcoin Cash", ticker: "BCH", color: "#8dc351" },
  { id: "stellar", name: "Stellar", ticker: "XLM", color: "#14b6e7" },
  { id: "monero", name: "Monero", ticker: "XMR", color: "#ff6600" },
  { id: "zcash", name: "Zcash", ticker: "ZEC", color: "#ecb244" },
  { id: "dash", name: "Dash", ticker: "DASH", color: "#008de4" },
  { id: "ethereum_classic", name: "Ethereum Classic", ticker: "ETC", color: "#328332" },
  { id: "cosmos", name: "Cosmos", ticker: "ATOM", color: "#2e3148" },
  { id: "avalanche_c_chain", name: "Avalanche", ticker: "AVAX", color: "#e84142" },
  { id: "near", name: "NEAR", ticker: "NEAR", color: "#00c08b" },
  { id: "aptos", name: "Aptos", ticker: "APT", color: "#2ed8a3" },
  { id: "algorand", name: "Algorand", ticker: "ALGO", color: "#000000" },
  { id: "tezos", name: "Tezos", ticker: "XTZ", color: "#2c7df7" },
  { id: "filecoin", name: "Filecoin", ticker: "FIL", color: "#0090ff" },
  { id: "internet_computer", name: "Internet Computer", ticker: "ICP", color: "#29abe2" },
  { id: "hedera", name: "Hedera", ticker: "HBAR", color: "#000000" },
  { id: "vechain", name: "VeChain", ticker: "VET", color: "#15bdff" },
  { id: "kaspa", name: "Kaspa", ticker: "KAS", color: "#70c7ba" },
  { id: "injective", name: "Injective", ticker: "INJ", color: "#00f2fe" },
  { id: "render", name: "Render", ticker: "RNDR", color: "#000000" },
  { id: "arbitrum", name: "Arbitrum", ticker: "ARB", color: "#28a0f0" },
  { id: "optimism", name: "Optimism", ticker: "OP", color: "#ff0420" },
  { id: "sui", name: "Sui", ticker: "SUI", color: "#4da2ff" },
  { id: "sei", name: "Sei", ticker: "SEI", color: "#000000" },
  { id: "celo", name: "Celo", ticker: "CELO", color: "#fcff52" },
  { id: "stacks", name: "Stacks", ticker: "STX", color: "#5546ff" },
  { id: "flow", name: "Flow", ticker: "FLOW", color: "#00ef8b" },
  { id: "eos", name: "EOS", ticker: "EOS", color: "#000000" },
  { id: "fantom", name: "Fantom", ticker: "FTM", color: "#1969ff" },
  { id: "cronos", name: "Cronos", ticker: "CRO", color: "#002e74" },
  { id: "decred", name: "Decred", ticker: "DCR", color: "#2ed6a1" },
  { id: "iota", name: "IOTA", ticker: "IOTA", color: "#000000" },
  { id: "zilliqa", name: "Zilliqa", ticker: "ZIL", color: "#49c9f0" },
  { id: "theta", name: "Theta", ticker: "THETA", color: "#0d6eef" },
  { id: "aave", name: "Aave", ticker: "AAVE", color: "#b6509e" },
  { id: "maker", name: "Maker", ticker: "MKR", color: "#1aab9b" },
  { id: "uniswap", name: "Uniswap", ticker: "UNI", color: "#ff007a" },
  { id: "chainlink", name: "Chainlink", ticker: "LINK", color: "#2a5ada" },
  { id: "the_graph", name: "The Graph", ticker: "GRT", color: "#6747ed" },
];

const DEVICES = [
  { id: "stax", name: "Ledger Stax", modelId: "stax", img: DEVICE_DATA_URI.stax },
  { id: "flex", name: "Ledger Flex", modelId: "europa", img: DEVICE_DATA_URI.flex },
  { id: "nanoX", name: "Ledger Nano X", modelId: "nanoX", img: DEVICE_DATA_URI.nanoX },
  { id: "nanoSP", name: "Ledger Nano S+", modelId: "nanoSP", img: DEVICE_DATA_URI.nanoSP },
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ledger Live - FLEX Demo Admin</title>
<style>
  :root {
    --bg: #1D1D20;
    --bg-elevated: #252528;
    --bg-card: rgba(255,255,255,0.03);
    --bg-card-hover: rgba(255,255,255,0.07);
    --border: rgba(255,255,255,0.07);
    --border-hover: rgba(255,255,255,0.14);
    --accent: #C4A24D;
    --accent-hover: #D4B25D;
    --accent-glow: rgba(196,162,77,0.25);
    --cyan: #00B4D8;
    --cyan-glow: rgba(0,180,216,0.2);
    --success: #3ecf8e;
    --danger: #e94848;
    --text: #fff;
    --text-secondary: rgba(255,255,255,0.65);
    --text-tertiary: rgba(255,255,255,0.38);
    --radius: 18px;
    --radius-sm: 12px;
    --radius-btn: 14px;
    --transition: 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    --transition-slow: 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #111114;
    background-image:
      radial-gradient(ellipse 120% 60% at 20% -10%, rgba(196,162,77,0.08) 0%, transparent 60%),
      radial-gradient(ellipse 80% 50% at 85% 100%, rgba(0,180,216,0.06) 0%, transparent 50%),
      radial-gradient(ellipse 60% 40% at 50% 50%, rgba(196,162,77,0.03) 0%, transparent 70%);
    background-attachment: fixed;
    color: var(--text);
    font-family: 'Inter', -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    min-height: 100vh;
    padding: 24px;
  }

  .liquid-glass {
    background: rgba(37,37,40,0.6);
    backdrop-filter: blur(60px) saturate(200%);
    -webkit-backdrop-filter: blur(60px) saturate(200%);
    border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: var(--radius);
    box-shadow:
      inset 0.5px 0.5px 1px rgba(255,255,255,0.12),
      inset -0.5px -0.5px 1px rgba(0,0,0,0.05),
      0 8px 32px rgba(0,0,0,0.35),
      0 1px 0 rgba(255,255,255,0.04) inset;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 28px;
    margin-bottom: 20px;
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .ledger-logo { width: 28px; height: 28px; flex-shrink: 0; }
  .header h1 {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .header-right { display: flex; align-items: center; gap: 10px; }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 10px var(--success), 0 0 20px rgba(62,207,142,0.3);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { box-shadow: 0 0 10px var(--success), 0 0 20px rgba(62,207,142,0.3); }
    50% { box-shadow: 0 0 14px var(--success), 0 0 28px rgba(62,207,142,0.4); }
  }
  .status-text { font-size: 11px; color: var(--text-secondary); font-weight: 500; }

  /* Info Bar */
  .info-bar {
    display: flex;
    gap: 24px;
    padding: 16px 24px;
    margin-bottom: 20px;
    overflow-x: auto;
  }
  .info-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .info-label {
    font-size: 10px; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;
  }
  .info-value { font-size: 13px; font-weight: 700; color: var(--text); white-space: nowrap; }

  /* Section */
  .section { padding: 24px; margin-bottom: 20px; }
  .section-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
  }
  .section-title::before {
    content: '';
    width: 3px; height: 16px;
    background: linear-gradient(180deg, var(--accent), var(--cyan));
    border-radius: 2px;
  }

  /* Device Picker */
  .device-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .device-card {
    cursor: pointer;
    padding: 20px 14px;
    text-align: center;
    transition: var(--transition);
    border: 1.5px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-card);
    transform: translateY(0);
  }
  .device-card:hover {
    border-color: var(--border-hover);
    background: var(--bg-card-hover);
    transform: translateY(-2px) scale(1.02);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
  }
  .device-card.active {
    border-color: var(--accent);
    background: rgba(196,162,77,0.08);
    box-shadow: 0 0 20px var(--accent-glow), 0 8px 24px rgba(0,0,0,0.3);
  }
  .device-card.active:hover {
    transform: translateY(-3px) scale(1.03);
    box-shadow: 0 0 28px var(--accent-glow), 0 12px 32px rgba(0,0,0,0.4);
  }
  .device-card img {
    height: 64px; width: auto;
    max-width: 100%;
    object-fit: contain;
    margin-bottom: 10px;
    filter: drop-shadow(0 4px 16px rgba(0,0,0,0.5));
    transition: var(--transition-slow);
  }
  .device-card:hover img {
    filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6));
    transform: scale(1.05);
  }
  .device-card .dev-name { font-size: 12px; font-weight: 700; color: var(--text); }
  .device-card .dev-model { font-size: 10px; color: var(--text-tertiary); margin-top: 3px; font-weight: 500; }

  /* Form Fields */
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 14px;
    align-items: end;
  }
  .form-field { display: flex; flex-direction: column; gap: 7px; }
  .form-field label {
    font-size: 10px; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;
  }
  .form-field input {
    background: rgba(0,0,0,0.35);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 14px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: var(--transition);
  }
  .form-field input:focus {
    border-color: var(--accent);
    background: rgba(0,0,0,0.45);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .form-field input::placeholder { color: var(--text-tertiary); }

  /* Buttons */
  .btn {
    padding: 12px 28px;
    border: none;
    border-radius: 50px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: var(--transition);
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    transform: translateY(0);
    position: relative;
    overflow: hidden;
  }
  .btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 60%);
    opacity: 0;
    transition: var(--transition);
  }
  .btn:hover { transform: translateY(-3px) scale(1.08); }
  .btn:hover::after { opacity: 1; }
  .btn:active { transform: translateY(0) scale(0.97); }

  .btn-primary {
    background: linear-gradient(135deg, var(--accent) 0%, #B8963D 100%);
    color: #fff;
    box-shadow: 0 2px 12px var(--accent-glow);
  }
  .btn-primary:hover {
    box-shadow: 0 4px 20px var(--accent-glow), 0 0 0 1px rgba(196,162,77,0.3);
    transform: translateY(-1px);
  }
  .btn-secondary {
    background: var(--bg-card);
    border: 0.5px solid var(--border);
    color: var(--text);
  }
  .btn-secondary:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  }
  .btn-danger {
    background: rgba(233,72,72,0.12);
    border: 0.5px solid rgba(233,72,72,0.2);
    color: var(--danger);
  }
  .btn-danger:hover {
    background: rgba(233,72,72,0.22);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(233,72,72,0.15);
  }

  /* Asset List */
  .asset-list { display: flex; flex-direction: column; gap: 8px; }
  .asset-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(0,0,0,0.22);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-sm);
    transition: var(--transition);
  }
  .asset-row:hover {
    background: rgba(0,0,0,0.32);
    border-color: var(--border-hover);
  }
  .asset-row.disabled { opacity: 0.35; }
  .asset-icon {
    width: 32px; height: 32px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-card-hover);
  }
  .crypto-icon-img {
    width: 100%; height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
  .asset-info { flex: 1; min-width: 0; }
  .asset-name { font-size: 13px; font-weight: 700; }
  .asset-ticker { font-size: 11px; color: var(--text-tertiary); font-weight: 500; }
  .asset-amount {
    width: 130px;
    background: rgba(0,0,0,0.35);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 7px 12px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    text-align: right;
    transition: var(--transition);
    font-weight: 600;
  }
  .asset-amount:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .asset-checkbox {
    width: 18px; height: 18px;
    cursor: pointer;
    accent-color: var(--accent);
  }
  .asset-remove {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 20px;
    padding: 4px 8px;
    border-radius: 6px;
    transition: var(--transition);
    line-height: 1;
  }
  .asset-remove:hover { color: var(--danger); background: rgba(233,72,72,0.1); }

  /* Custom Dropdown */
  .dropdown-wrapper { position: relative; flex: 1; }
  .dropdown-trigger {
    width: 100%;
    background: rgba(0,0,0,0.35);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 36px 10px 14px;
    color: var(--text-secondary);
    font-size: 13px;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: var(--transition);
    display: flex;
    align-items: center;
    gap: 10px;
    outline: none;
    position: relative;
  }
  .dropdown-trigger:hover, .dropdown-trigger.open {
    border-color: var(--border-hover);
    background: rgba(0,0,0,0.45);
  }
  .dropdown-trigger.open {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .dropdown-trigger .chevron {
    position: absolute;
    right: 14px;
    top: 50%; transform: translateY(-50%);
    width: 12px; height: 12px;
    color: var(--text-tertiary);
    transition: var(--transition);
  }
  .dropdown-trigger.open .chevron { transform: translateY(-50%) rotate(180deg); }
  .dropdown-trigger .placeholder { color: var(--text-tertiary); }

  .dropdown-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0; right: 0;
    background: rgba(30,30,34,0.95);
    backdrop-filter: blur(40px) saturate(1.8);
    -webkit-backdrop-filter: blur(40px) saturate(1.8);
    border: 0.5px solid rgba(255,255,255,0.1);
    border-radius: var(--radius-sm);
    box-shadow: 0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
    max-height: 240px;
    overflow-y: auto;
    z-index: 200;
    display: none;
    padding: 6px;
  }
  .dropdown-menu.show { display: block; }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: var(--transition);
  }
  .dropdown-item:hover {
    background: rgba(255,255,255,0.08);
  }
  .dropdown-item .dd-icon {
    width: 28px; height: 28px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-card-hover);
  }
  .dropdown-item .dd-icon .crypto-icon-img { width: 100%; height: 100%; }
  .dropdown-item .dd-name { font-size: 13px; font-weight: 600; color: var(--text); }
  .dropdown-item .dd-ticker { font-size: 11px; color: var(--text-tertiary); font-weight: 500; margin-left: auto; }
  .dropdown-item.already-added { opacity: 0.35; pointer-events: none; }
  .dropdown-item.already-added .dd-ticker::after { content: ' \\2713'; color: var(--success); }

  /* Add Asset */
  .add-asset-row {
    display: flex;
    gap: 10px;
    margin-top: 16px;
    align-items: center;
  }

  /* Tooltip */
  [data-tooltip] { position: relative; }
  [data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(-6px);
    background: rgba(0,0,0,0.92);
    backdrop-filter: blur(12px);
    color: #fff;
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: var(--transition);
    z-index: 100;
    border: 0.5px solid rgba(255,255,255,0.08);
  }
  [data-tooltip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(-4px); }

  /* Action Bar */
  .action-bar {
    display: flex;
    gap: 10px;
    padding: 18px 24px;
    position: sticky;
    bottom: 20px;
  }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 28px;
    right: 28px;
    padding: 14px 24px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 700;
    z-index: 1000;
    opacity: 0;
    transform: translateY(20px) scale(0.95);
    transition: var(--transition-slow);
    backdrop-filter: blur(20px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .toast.show { opacity: 1; transform: translateY(0) scale(1); }
  .toast.success { background: rgba(62,207,142,0.12); border: 0.5px solid rgba(62,207,142,0.25); color: #3ecf8e; }
  .toast.error { background: rgba(233,72,72,0.12); border: 0.5px solid rgba(233,72,72,0.25); color: #e94848; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
</style>
</head>
<body>

<div class="header liquid-glass">
  <div class="header-left">
    <svg class="ledger-logo" viewBox="0 0 148 128" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 91.6548V128H55.3076V119.94H8.05844V91.6548H0ZM138.98 91.6548V119.94H91.7313V127.998H147.039V91.6548H138.98ZM55.388 36.3452V91.6529H91.7313V84.3842H63.4464V36.3452H55.388ZM0 0V36.3452H8.05844V8.05844H55.3076V0H0ZM91.7313 0V8.05844H138.98V36.3452H147.039V0H91.7313Z" fill="url(#logo-grad)"/><defs><linearGradient id="logo-grad" x1="0" y1="0" x2="147" y2="128"><stop offset="0%" stop-color="#C4A24D"/><stop offset="100%" stop-color="#00B4D8"/></linearGradient></defs></svg>
    <h1>FLEX Demo Admin</h1>
  </div>
  <div class="header-right">
    <div class="status-dot"></div>
    <span class="status-text" id="connectionStatus">Connected</span>
  </div>
</div>

<div class="info-bar liquid-glass">
  <div class="info-item">
    <span class="info-label">License Key</span>
    <span class="info-value" id="infoKey">--</span>
  </div>
  <div class="info-item">
    <span class="info-label">Subscription</span>
    <span class="info-value" id="infoSub">--</span>
  </div>
  <div class="info-item">
    <span class="info-label">Expires</span>
    <span class="info-value" id="infoExp">--</span>
  </div>
  <div class="info-item">
    <span class="info-label">Device</span>
    <span class="info-value" id="infoDevice">--</span>
  </div>
  <div class="info-item">
    <span class="info-label">Active Assets</span>
    <span class="info-value" id="infoAssets">0</span>
  </div>
</div>

<div class="section liquid-glass">
  <div class="section-title">Device Selection</div>
  <div class="device-grid" id="deviceGrid">
    ${DEVICES.map(d => `
    <div class="device-card" data-device="${d.id}" data-model="${d.modelId}" onclick="selectDevice('${d.id}')">
      <img src="${d.img}" alt="${d.name}" />
      <div class="dev-name">${d.name}</div>
      <div class="dev-model">${d.modelId}</div>
    </div>`).join("")}
  </div>
</div>

<div class="section liquid-glass">
  <div class="section-title">Device Profile</div>
  <div class="form-grid">
    <div class="form-field">
      <label>Name</label>
      <input type="text" id="profileName" placeholder="My Ledger" />
    </div>
    <div class="form-field">
      <label>Firmware Version</label>
      <input type="text" id="profileFirmware" placeholder="2.4.1" />
    </div>
    <div class="form-field">
      <label>Battery (%)</label>
      <input type="number" id="profileBattery" placeholder="85" min="0" max="100" />
    </div>
  </div>
  <div style="margin-top: 14px;">
    <button class="btn btn-primary" onclick="saveDevice()">Save Device</button>
  </div>
</div>

<div class="section liquid-glass">
  <div class="section-title">Active Assets</div>
  <div class="asset-list" id="assetList"></div>
  <div class="add-asset-row">
    <div class="dropdown-wrapper" id="dropdownWrapper">
      <div class="dropdown-trigger" id="dropdownTrigger" onclick="toggleDropdown()">
        <span class="placeholder">Select asset to add</span>
        <svg class="chevron" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="dropdown-menu" id="dropdownMenu"></div>
    </div>
    <button class="btn btn-secondary" onclick="addAsset()">Add Asset</button>
  </div>
</div>

<div class="action-bar liquid-glass">
  <button class="btn btn-primary" onclick="pushToApp()">Push to App</button>
  <button class="btn btn-secondary" onclick="saveBalances()">Save Balances</button>
  <button class="btn btn-secondary" onclick="refreshData()">Refresh</button>
</div>

<div class="toast" id="toast"></div>

<script>
const CRYPTO_ICON_URL = "${CRYPTO_ICON_URL}";
const ASSET_INFO = ${JSON.stringify(ASSETS)};

const { ipcRenderer } = require("electron");

let state = {
  selectedDevice: "stax",
  profile: { name: "", firmware: "", battery: 85 },
  balances: [],
  tokens: {},
  licenseKey: "",
  subscription: "pro",
  expiresAt: null,
  tonAddress: ""
};
let dropdownOpen = false;

async function init() { await refreshData(); }

async function refreshData() {
  try {
    const data = await ipcRenderer.invoke("admin:get-info");
    if (data && !data.error) {
      if (data.balances && typeof data.balances === "object") {
        state.balances = Object.entries(data.balances).map(([currency, amount]) => ({
          currency, amount: String(amount), enabled: true
        }));
      }
      if (data.tokens) state.tokens = data.tokens;
      if (data.profile) {
        state.profile = {
          name: data.profile.device?.name || "",
          firmware: data.profile.device?.firmwareVersion || "",
          battery: data.profile.device?.batteryLevel ?? 85
        };
        const modelId = data.profile.device?.modelId || "stax";
        state.selectedDevice = modelId === "europa" ? "flex" : modelId;
        if (!["stax","flex","nanoX","nanoSP"].includes(state.selectedDevice)) state.selectedDevice = "stax";
      }
      if (data.key) state.licenseKey = data.key;
      if (data.subscription) state.subscription = data.subscription;
    }
  } catch(e) { console.log("Refresh:", e.message); }
  renderAll();
}

function renderAll() {
  renderDevices();
  renderProfile();
  renderAssets();
  renderDropdown();
  renderInfo();
}

function renderDevices() {
  document.querySelectorAll(".device-card").forEach(c => {
    c.classList.toggle("active", c.dataset.device === state.selectedDevice);
  });
}

function renderProfile() {
  document.getElementById("profileName").value = state.profile.name || "";
  document.getElementById("profileFirmware").value = state.profile.firmware || "";
  document.getElementById("profileBattery").value = state.profile.battery || "";
}

function cryptoIconImg(ticker, size) {
  return '<img src="' + CRYPTO_ICON_URL + '/' + encodeURIComponent(ticker) + '.png" width="' + size + '" height="' + size + '" alt="' + ticker + '" class="crypto-icon-img" />';
}

function renderAssets() {
  const list = document.getElementById("assetList");
  if (state.balances.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:12px;">No assets. Add one below.</div>';
    return;
  }
  list.innerHTML = state.balances.map((b, i) => {
    const info = ASSET_INFO.find(a => a.id === b.currency);
    if (!info) return "";
    const enabled = b.enabled !== false;
    return '<div class="asset-row' + (enabled ? '' : ' disabled') + '" data-idx="' + i + '">' +
      '<input type="checkbox" class="asset-checkbox" ' + (enabled ? 'checked' : '') + ' data-toggle-idx="' + i + '" />' +
      '<div class="asset-icon" data-tooltip="' + info.name + '">' + cryptoIconImg(info.ticker, 28) + '</div>' +
      '<div class="asset-info"><div class="asset-name">' + info.name + '</div><div class="asset-ticker">' + info.ticker + '</div></div>' +
      '<input type="text" class="asset-amount" value="' + (b.amount || "0") + '" data-amount-idx="' + i + '" placeholder="0.00" />' +
      '<button class="asset-remove" data-remove-idx="' + i + '" title="Remove">&times;</button>' +
    '</div>';
  }).join("");
}

function renderDropdown() {
  const menu = document.getElementById("dropdownMenu");
  const addedIds = state.balances.map(b => b.currency);
  menu.innerHTML = ASSET_INFO.map(a => {
    const already = addedIds.includes(a.id);
    return '<div class="dropdown-item' + (already ? ' already-added' : '') + '" data-asset-id="' + a.id + '">' +
      '<div class="dd-icon">' + cryptoIconImg(a.ticker, 28) + '</div>' +
      '<span class="dd-name">' + a.name + '</span>' +
      '<span class="dd-ticker">' + a.ticker + '</span>' +
    '</div>';
  }).join("");
}

function renderInfo() {
  document.getElementById("infoKey").textContent = state.licenseKey ? state.licenseKey.substring(0,20) + "..." : "Not set";
  document.getElementById("infoSub").textContent = state.subscription.toUpperCase();
  const exp = state.expiresAt ? new Date(state.expiresAt) : null;
  document.getElementById("infoExp").textContent = exp && !isNaN(exp.getTime())
    ? exp.toLocaleDateString() + " " + exp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "N/A";
  const devName = state.selectedDevice === "flex" ? "Flex" : state.selectedDevice === "nanoX" ? "Nano X" : state.selectedDevice === "nanoSP" ? "Nano S+" : "Stax";
  document.getElementById("infoDevice").textContent = devName;
  document.getElementById("infoAssets").textContent = state.balances.filter(b => b.enabled !== false).length;
}

function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  document.getElementById("dropdownMenu").classList.toggle("show", dropdownOpen);
  document.getElementById("dropdownTrigger").classList.toggle("open", dropdownOpen);
}

function selectDropdownItem(id) {
  if (state.balances.find(b => b.currency === id)) { showToast("Asset already exists", "error"); return; }
  state.balances.push({ currency: id, amount: "0", enabled: true });
  dropdownOpen = false;
  document.getElementById("dropdownMenu").classList.remove("show");
  document.getElementById("dropdownTrigger").classList.remove("open");
  renderAssets();
  renderDropdown();
  renderInfo();
  showToast("Asset added", "success");
}

document.addEventListener("click", function(e) {
  const wrapper = document.getElementById("dropdownWrapper");
  if (!wrapper) return;
  const item = e.target.closest(".dropdown-item");
  if (item) {
    const id = item.getAttribute("data-asset-id");
    if (id) selectDropdownItem(id);
    return;
  }
  if (!wrapper.contains(e.target)) {
    dropdownOpen = false;
    document.getElementById("dropdownMenu").classList.remove("show");
    document.getElementById("dropdownTrigger").classList.remove("open");
  }
  const removeBtn = e.target.closest(".asset-remove");
  if (removeBtn) {
    const idx = parseInt(removeBtn.getAttribute("data-remove-idx"), 10);
    if (!isNaN(idx)) removeAsset(idx);
  }
});

document.addEventListener("change", function(e) {
  if (e.target.matches(".asset-checkbox")) {
    const idx = parseInt(e.target.getAttribute("data-toggle-idx"), 10);
    if (!isNaN(idx)) toggleAsset(idx, e.target.checked);
  }
});

document.addEventListener("input", function(e) {
  if (e.target.matches(".asset-amount")) {
    const idx = parseInt(e.target.getAttribute("data-amount-idx"), 10);
    if (!isNaN(idx)) updateAmount(idx, e.target.value);
  }
});

function selectDevice(id) {
  state.selectedDevice = id;
  renderDevices();
  renderInfo();
  showToast("Device selected: " + id, "success");
}

function saveDevice() {
  state.profile.name = document.getElementById("profileName").value;
  state.profile.firmware = document.getElementById("profileFirmware").value;
  state.profile.battery = parseInt(document.getElementById("profileBattery").value) || 0;
  const modelMap = { stax: "stax", flex: "europa", nanoX: "nanoX", nanoSP: "nanoSP" };
  ipcRenderer.invoke("admin:set-profile", {
    activeAssets: state.balances.filter(b => b.enabled !== false).map(b => b.currency),
    device: {
      modelId: modelMap[state.selectedDevice],
      name: state.profile.name,
      firmwareVersion: state.profile.firmware,
      batteryLevel: state.profile.battery
    }
  }).then(data => {
    if (data.success) showToast("Device profile saved", "success");
    else showToast("Save failed: " + (data.error || "unknown"), "error");
    renderInfo();
  }).catch(e => showToast("Save failed: " + e.message, "error"));
}

function addAsset() { toggleDropdown(); }

function removeAsset(idx) {
  state.balances.splice(idx, 1);
  renderAssets();
  renderDropdown();
  renderInfo();
  showToast("Asset removed", "success");
}

function toggleAsset(idx, checked) {
  state.balances[idx].enabled = checked;
  renderAssets();
  renderInfo();
}

function updateAmount(idx, val) {
  state.balances[idx].amount = val;
}

function saveBalances() {
  const balancesObj = {};
  state.balances.filter(b => b.enabled !== false).forEach(b => {
    balancesObj[b.currency] = b.amount || "0";
  });
  // Only keep tokens that still have a balance entry
  const activeIds = Object.keys(balancesObj);
  const filteredTokens = {};
  Object.keys(state.tokens).forEach(t => {
    if (activeIds.includes(t)) filteredTokens[t] = state.tokens[t];
  });
  ipcRenderer.invoke("admin:set-balances", {
    balances: balancesObj,
    tokens: filteredTokens
  }).then(data => {
    if (data.success) {
      showToast("Balances saved (" + Object.keys(balancesObj).length + " assets)", "success");
      refreshData();
    } else showToast("Save failed: " + (data.error || "unknown"), "error");
  }).catch(e => showToast("Save failed: " + e.message, "error"));
}

function pushToApp() {
  ipcRenderer.invoke("admin:push-to-app").then(data => {
    if (data.success) showToast("Pushed to app successfully", "success");
    else showToast("Push failed: " + (data.error || "unknown"), "error");
    renderInfo();
  }).catch(e => showToast("Push failed: " + e.message, "error"));
}

let toastTimer;
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show " + (type || "success");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 3000);
}

init();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, "admin-panel.html"), html, "utf8");
console.log("Generated admin-panel.html:", (html.length / 1024).toFixed(1) + "KB");
