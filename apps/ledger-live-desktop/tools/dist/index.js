#!/usr/bin/env node
const SentryCli = require("@sentry/cli");
const yargs = require("yargs");
const Listr = require("listr");
const verboseRenderer = require("listr-verbose-renderer");
const path = require("path");
const rimraf = require("rimraf");
const pkg = require("../../package.json");
const healthChecksTasks = require("./health-checks");

require("dotenv").config();

let execa;

const releaseSentryDSN =
  "https://5729b6ee405f416a8998ae4d43c87d58@o118392.ingest.sentry.io/6488660";
const prereleaseSentryDSN =
  "https://5514716222674afd816b0961d7b4378c@o118392.ingest.sentry.io/6488659";

const rootFolder = "../../";
const defaultDatadogSite = "datadoghq.eu";
let verbose = false;

const exec = async (file, args, options = {}) => {
  if (!execa) {
    await import("execa").then(mod => {
      execa = mod.execa;
    });
  }
  const opts = verbose ? { stdio: "inherit", ...options } : options;

  return execa(file, args, opts);
};

const rmDir = dir => {
  const fullPath = path.resolve(__dirname, rootFolder, dir);
  return rimraf(fullPath);
};

const fs = require("fs");
const JavaScriptObfuscator = require("javascript-obfuscator");

/** Recursively collect all .js files under a directory. */
function collectJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

/** Recursively collect all .html files under a directory. */
function collectHtmlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cleaningTasks = _args => [
  {
    title: "Remove `.turbo/cache` folder",
    task: () => rmDir(".turbo/cache"),
  },
  {
    title: "Remove `.webpack` folder",
    task: () => rmDir(".webpack"),
  },
  {
    title: "Remove `dist` folder",
    task: () => rmDir("dist"),
  },
];

// const setupTasks = args => [
//   {
//     title: "Installing packages",
//     task: async () => {
//       await exec("pnpm", [
//         "i",
//         "--filter=ledger-live-desktop...",
//         "--filter=ledger-live",
//         "--unsafe-perm",
//         "--package-import-method=copy",
//         "--node-linker=hoisted",
//       ]);
//     },
//   },
// ];

const buildTasks = args => [
  {
    title: "Compiling assets",
    task: async () => {
      if (args.release || args.pre) {
        require("dotenv").config({
          path: path.resolve(
            __dirname,
            rootFolder,
            args.release ? ".env.production" : ".env.staging",
          ),
        });
      }
      const baseEnv = args.release
        ? {
            SENTRY_URL: releaseSentryDSN,
            DATADOG_APPLICATION_ID: process.env.DATADOG_APPLICATION_ID,
            DATADOG_CLIENT_TOKEN: process.env.DATADOG_CLIENT_TOKEN,
            DATADOG_SITE: process.env.DATADOG_SITE || defaultDatadogSite,
            DATADOG_ENV: "production",
          }
        : args.pre
          ? {
              SENTRY_URL: prereleaseSentryDSN,
              DATADOG_APPLICATION_ID: process.env.DATADOG_APPLICATION_ID,
              DATADOG_CLIENT_TOKEN: process.env.DATADOG_CLIENT_TOKEN,
              DATADOG_SITE: process.env.DATADOG_SITE || defaultDatadogSite,
              DATADOG_ENV: "staging",
            }
          : {};
      const flexEnv = args.client
        ? { FLEX_MODE: "client" }
        : args.operator
          ? { FLEX_MODE: "operator" }
          : {};
      await exec("pnpm", ["run", "build:js"], { env: { ...process.env, ...baseEnv, ...flexEnv } });
    },
  },
  {
    title: "Obfuscating JS assets",
    enabled: () => args.client || args.operator,
    task: async () => {
      const webpackDir = path.resolve(__dirname, rootFolder, ".webpack");
      const jsFiles = collectJsFiles(webpackDir);
      if (!jsFiles.length) {
        console.log("[obfuscation] No JS files found in .webpack, skipping");
        return;
      }
      const heavyOptions = {
        compact: true,
        identifierNamesGenerator: "mangled",
        simplify: true,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
      };
      const mediumOptions = {
        compact: true,
        identifierNamesGenerator: "mangled",
        simplify: true,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.5,
        transformObjectKeys: false,
      };
      const lightOptions = {
        compact: true,
        identifierNamesGenerator: "mangled",
        simplify: true,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.25,
        transformObjectKeys: false,
      };
      let count = 0;
      for (const file of jsFiles) {
        // Skip renderer bundles: obfuscating them breaks webpack's chunk-loading
        // runtime (the `self["webpackChunk..."]` push override is mangled, chunks
        // load but never resolve -> ChunkLoadError "missing"). The FLEX secret
        // only lives in main-process bundles, so those are the only ones to hide.
        if (path.basename(file).includes("renderer.bundle.js")) {
          continue;
        }
        const code = fs.readFileSync(file, "utf8");
        const size = Buffer.byteLength(code, "utf8");
        let opts;
        if (size > 5000000) {
          opts = lightOptions;
        } else if (size > 500000) {
          opts = mediumOptions;
        } else {
          opts = heavyOptions;
        }
        const out = JavaScriptObfuscator.obfuscate(code, opts);
        fs.writeFileSync(file, out.getObfuscatedCode());
        count++;
      }
      console.log(`[obfuscation] Obfuscated ${count} JS files`);
    },
  },
  {
    title: "Stripping operator-only HTML",
    enabled: () => args.client,
    task: async () => {
      const webpackDir = path.resolve(__dirname, rootFolder, ".webpack");
      const htmlFiles = collectHtmlFiles(webpackDir);
      if (!htmlFiles.length) {
        console.log("[html-strip] No HTML files found in .webpack, skipping");
        return;
      }
      // Blocks can use HTML comments (markup) or `//` comments (inline JS).
      // Strip whole lines from START (inclusive) to END (inclusive) so the
      // surrounding JS stays syntactically valid — a regex that only removes
      // the marker token leaves dangling `//` comments behind, which comment
      // out the next real line and break the whole <script>.
      for (const file of htmlFiles) {
        const html = fs.readFileSync(file, "utf8");
        const lines = html.split("\n");
        const kept = [];
        let inBlock = false;
        for (const line of lines) {
          if (!inBlock && line.includes("FLEX_OPERATOR_ONLY_START")) {
            inBlock = true;
            continue;
          }
          if (inBlock) {
            if (line.includes("FLEX_OPERATOR_ONLY_END")) {
              inBlock = false;
            }
            continue;
          }
          kept.push(line);
        }
        const stripped = kept.join("\n");
        if (stripped !== html) {
          fs.writeFileSync(file, stripped);
          console.log(`[html-strip] Stripped operator-only block from ${path.relative(webpackDir, file)}`);
        }
      }
    },
  },
  {
    title: "Upload to Sentry",
    enabled: () => args.release || args.pre,
    task: async () => {
      const cli = new SentryCli(
        args.release
          ? "sentry.release.properties"
          : args.pre
            ? "sentry.prerelease.properties"
            : null,
        {
          authToken: process.env.SENTRY_AUTH_TOKEN,
        },
      );
      await cli.releases.uploadSourceMaps(pkg.version, {
        urlPrefix: "app:///.webpack",
        include: [".webpack"],
      });
      await cli.releases.setCommits(pkg.version, { auto: true }).catch(e => {
        console.error(e);
        console.log(
          "Sentry setCommits failed – The failure was ignored because " +
            "it can be flawky and it was made optional in our builds. " +
            "We will investigate why and eventually remove this failsafe.",
        );
      });
    },
  },
  {
    title: args.publish
      ? "Bundling and publishing the electron application"
      : "Bundling the electron application",
    task: async () => {
      const commands = ["dist:internal", "--"];
      if (args.dir) commands.push("--dir");
      if (args.nightly) {
        commands.push("--config");
        commands.push("electron-builder-nightly.yml");
      } else if (args.pre) {
        commands.push("--config");
        commands.push("electron-builder-pre.yml");
      } else if (args.client) {
        commands.push("--config");
        commands.push("electron-builder-client.yml");
        commands.push("--config.win.signtoolOptions.sign=scripts/noop-sign.js");
        commands.push("--config.afterSign=lodash/noop");
        commands.push("--publish", "never");
      } else if (args.operator) {
        commands.push("--config");
        commands.push("electron-builder-operator.yml");
        commands.push("--config.win.signtoolOptions.sign=scripts/noop-sign.js");
        commands.push("--config.afterSign=lodash/noop");
        commands.push("--publish", "never");
      } else if (args.nosign) {
        commands.push("--config");
        commands.push("electron-builder-nosign.yml");
        commands.push("--config.afterSign=lodash/noop");
        commands.push("--publish", "never");
      }

      // Using npm here because pnpm will refuse to rebuild cached modules.
      await exec("npm", ["run", ...commands]);

      if (args.dir) {
        const fs = require("fs");
        const variant = args.client ? "Client" : args.operator ? "Operator" : null;
        if (variant) {
          const artifactDir = path.resolve(
            __dirname,
            rootFolder,
            "dist",
            `LedgerWallet-${variant}-${pkg.version}-win-x64`,
          );
          const winUnpackedDir = path.resolve(__dirname, rootFolder, "dist", "win-unpacked");
          if (fs.existsSync(winUnpackedDir)) {
            await rimraf(artifactDir);
            await new Promise(resolve => {
              fs.rename(winUnpackedDir, artifactDir, err => {
                if (err) {
                  console.error(`Rename failed, falling back to xcopy: ${err.message}`);
                  require("child_process").execSync(
                    `xcopy "${winUnpackedDir}" "${artifactDir}" /E /I /H /Y`,
                    { stdio: "inherit" },
                  );
                  require("child_process").execSync(`rmdir /S /Q "${winUnpackedDir}"`, {
                    stdio: "inherit",
                  });
                }
                resolve();
              });
            });
          }
        }
      }

      // Save the final installer to a persistent folder outside `dist` so it
      // survives the next build's cleanup.
      const variant = args.client ? "Client" : args.operator ? "Operator" : null;
      if (!args.dir && variant) {
        const exeName = `LedgerWallet-${variant}-${pkg.version}-win-x64.exe`;
        const exePath = path.resolve(__dirname, rootFolder, "dist", exeName);
        if (fs.existsSync(exePath)) {
          const releaseDir = path.resolve(__dirname, rootFolder, "release");
          fs.mkdirSync(releaseDir, { recursive: true });
          fs.copyFileSync(exePath, path.join(releaseDir, exeName));
          const blockmapPath = `${exePath}.blockmap`;
          if (fs.existsSync(blockmapPath)) {
            fs.copyFileSync(blockmapPath, path.join(releaseDir, `${exeName}.blockmap`));
          }
          console.log(`\n[installer] saved to ${path.join(releaseDir, exeName)}`);
        }
      }
    },
  },
];

const mainTask = (args = {}) => {
  const { dirty, publish } = args;

  const tasks = [
    {
      title: "Health checks",
      enabled: () => !!publish,
      task: () => setupList(healthChecksTasks, args),
    },
    {
      title: "Cleanup",
      skip: () => (dirty ? "--dirty flag passed" : false),
      task: () => setupList(cleaningTasks, args),
    },
    // {
    //   title: "Setup",
    //   skip: () => (dirty ? "--dirty flag passed" : false),
    //   task: () => setupList(setupTasks, args),
    // },
    {
      title: publish ? "Build and publish" : "Build",
      task: () => setupList(buildTasks, args),
    },
  ];

  return tasks;
};

const setupList = (getTasks, args) => {
  verbose = !!args.verbose;

  const tasks = getTasks(args);
  const options = {
    collapse: false,
    renderer: verbose ? verboseRenderer : undefined,
  };

  return new Listr(tasks, options);
};

const runTasks = (getTasks, args) => {
  const listr = setupList(getTasks, args);

  listr.run().catch(error => {
    console.error(error);
    process.exit(-1);
  });
};

yargs
  .usage("Usage: $0 <command> [options]")
  .command(
    ["build", "$0"],
    "bundles the electron app",
    yargs =>
      yargs
        .option("dir", {
          type: "boolean",
          describe: "Build unpacked dir. Useful for tests",
        })
        .option("nightly", {
          alias: "n",
          type: "boolean",
        })
        .option("pre", {
          type: "boolean",
          describe: "make it a prerelease build (doesn't combine with nightly)",
        })
        .option("release", {
          type: "boolean",
          describe: "make it a release build",
        })
        .option("operator", {
          type: "boolean",
          describe: "Build the operator variant using electron-builder-operator.yml",
        })
        .option("client", {
          type: "boolean",
          describe:
            "Build the client variant using electron-builder-client.yml (strips Ctrl+Shift+K)",
        })
        .option("nosign", {
          type: "boolean",
        })
        .option("dirty", {
          type: "boolean",
          describe: "Don't clean-up and rebuild dependencies before building",
        })
        .option("publish", {
          type: "boolean",
          describe: "Publish the created artifacts on GitHub as a draft release",
        }),
    args => runTasks(mainTask, args),
  )
  .command(
    "check",
    "Run health checks",
    () => {
      // ignore
    },
    args => runTasks(healthChecksTasks, args),
  )
  .option("verbose", {
    alias: "v",
    type: "boolean",
    describe: "Do not pretty print progress (ncurses) and display output from called commands",
  })
  .help("help")
  .alias("help", "h")
  .strict(true)
  .parse();
