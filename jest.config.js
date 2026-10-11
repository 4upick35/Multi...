module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    'react-native-webview': '<rootDir>/__mocks__/react-native-webview.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/__mocks__/react-native-async-storage-async-storage.js',
    '^@react-native-community/datetimepicker$': '<rootDir>/__mocks__/react-native-community-datetimepicker.js',
    'react-native-image-picker': '<rootDir>/__mocks__/react-native-image-picker.js',
  },
};
