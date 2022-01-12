const path = require("path");

const name = "permissions";

// define preprocessor variables
const opts = {
  ENV: process.env.SKYNET_MYSKY_ENV || "production",
};

module.exports = {
  entry: `./scripts/${name}.ts`,
  mode: "production",

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          { loader: "ts-loader", options: { configFile: "tsconfig.scripts.json" } },
          { loader: "ifdef-loader", options: opts },
        ],
        include: [path.resolve(__dirname, `scripts/${name}.ts`)],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    symlinks: false,
    fallback: {
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
    },
  },
  output: {
    filename: `${name}.js`,
    path: path.resolve(__dirname, "dist"),
  },
};
