// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["module:react-native-dotenv", { moduleName: "@env", path: ".env" }]
      // Reanimated plugin removed for this MVP to avoid the missing dependency error.
      // If you add Reanimated later, reinstall deps and put:
      // "react-native-reanimated/plugin" as the LAST plugin in this array.
    ]
  };
};
