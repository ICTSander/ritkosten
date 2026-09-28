// Live contract tests run in plain Node (real fetch), without the React Native preset.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/services/__tests__/live.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  transformIgnorePatterns: ['/node_modules/(?!@react-native-async-storage|expo/virtual)'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
