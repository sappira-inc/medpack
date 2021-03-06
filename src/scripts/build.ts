// Ensure environment variables are read.
require('../config/env');

import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import webpack, { Stats } from 'webpack';
// @ts-ignore
import bfj from 'bfj';
// @ts-ignore
import checkRequiredFiles from 'react-dev-utils/checkRequiredFiles';
// @ts-ignore
import formatWebpackMessages from 'react-dev-utils/formatWebpackMessages';
// @ts-ignore
import printHostingInstructions from 'react-dev-utils/printHostingInstructions';
// @ts-ignore
import FileSizeReporter from 'react-dev-utils/FileSizeReporter';
// @ts-ignore
import printBuildError from 'react-dev-utils/printBuildError';
import { getConfig } from '../utils';

const measureFileSizesBeforeBuild = FileSizeReporter.measureFileSizesBeforeBuild;
const printFileSizesAfterBuild = FileSizeReporter.printFileSizesAfterBuild;

// These sizes are pretty large. We'll warn for bundles exceeding them.
const WARN_AFTER_BUNDLE_GZIP_SIZE = 512 * 1024;
const WARN_AFTER_CHUNK_GZIP_SIZE = 1024 * 1024;

export type BuildOptions = {
  config: string,
}

export default ({ config: configPath }: BuildOptions) => {
  // Makes the script crash on unhandled rejections instead of silently
  // ignoring them. In the future, promise rejections that are not handled will
  // terminate the Node.js process with a non-zero exit code.
  process.on('unhandledRejection', err => {
    throw err;
  });

  // Do this as the first thing so that any code reading it knows the right env.
  process.env.BABEL_ENV = 'production';
  process.env.NODE_ENV = 'production';

  const { paths, config } = getConfig(configPath);

  // Warn and crash if required files are missing
  if (!checkRequiredFiles([paths.appHtml, paths.appIndexJs])) {
    process.exit(1);
  }

  // Process CLI arguments
  const argv = process.argv.slice(2);
  const writeStatsJson = argv.indexOf('--stats') !== -1;

  // First, read the current file sizes in build directory.
  // This lets us display how much they changed later.
  measureFileSizesBeforeBuild(paths.appBuild)
    .then((previousFileSizes: Object) => {
      // Remove all content but keep the directory so that
      // if you're in it, you don't end up in Trash
      fs.emptyDirSync(paths.appBuild);
      // Merge with the public folder
      fs.copySync(paths.appPublic, paths.appBuild, {
        dereference: true,
        filter: file => file !== paths.appHtml,
      });
      // Start the webpack build
      return build(previousFileSizes);
    })
    .then(
      ({ stats, previousFileSizes, warnings }: { stats: Stats, previousFileSizes: Object, warnings: Array<string> }) => {
        if (warnings.length) {
          console.log(chalk.yellow('Compiled with warnings.\n'));
          console.log(warnings.join('\n\n'));
          console.log(
            `\nSearch for the ${chalk.underline(chalk.yellow('keywords'))} to learn more about each warning.`
          );
          console.log(`To ignore, add ${chalk.cyan('// eslint-disable-next-line')} to the line before.\n`);
        } else {
          console.log(chalk.green('Compiled successfully.\n'));
        }

        console.log('File sizes after gzip:\n');
        printFileSizesAfterBuild(
          stats,
          previousFileSizes,
          paths.appBuild,
          WARN_AFTER_BUNDLE_GZIP_SIZE,
          WARN_AFTER_CHUNK_GZIP_SIZE
        );
        console.log();

        const appPackage = require(paths.appPackageJson);
        const publicUrl = paths.publicUrl;
        const publicPath = config.output && config.output.publicPath;
        const buildFolder = path.relative(process.cwd(), paths.appBuild);
        printHostingInstructions(appPackage, publicUrl, publicPath, buildFolder, paths.useYarn);

        process.exit(0);
      },
      (err: Error) => {
        console.log(chalk.red('Failed to compile.\n'));
        printBuildError(err);
        process.exit(1);
      }
    )
    .catch((err: Error) => {
      if (err && err.message) {
        console.log(err.message);
      }
      process.exit(1);
    });

  // Create the production build and print the deployment instructions.
  function build(previousFileSizes: Object) {
    console.log('Creating an optimized production build...');
    const compiler = webpack(config);

    return new Promise((resolve, reject) => {
      compiler.run((err, stats) => {
        if (err) {
          return reject(err);
        }
        const messages = formatWebpackMessages(stats.toJson({}));
        if (messages.errors.length) {
          // Only keep the first error. Others are often indicative
          // of the same problem, but confuse the reader with noise.
          if (messages.errors.length > 1) {
            messages.errors.length = 1;
          }
          return reject(new Error(messages.errors.join('\n\n')));
        }
        if (
          process.env.CI &&
          (typeof process.env.CI !== 'string' || process.env.CI.toLowerCase() !== 'false') &&
          messages.warnings.length
        ) {
          console.log(
            chalk.yellow(
              '\nTreating warnings as errors because process.env.CI = true.\n' +
                'Most CI servers set it automatically.\n'
            )
          );
          return reject(new Error(messages.warnings.join('\n\n')));
        }

        const resolveArgs = {
          stats,
          previousFileSizes,
          warnings: messages.warnings,
        };

        if (writeStatsJson) {
          return bfj
            .write(`${paths.appBuild}/bundle-stats.json`, stats.toJson())
            .then(() => resolve(resolveArgs))
            .catch((error: Error) => reject(error));
        }

        return resolve(resolveArgs);
      });
    });
  }
};
