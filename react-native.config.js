const path = require('path');

/**
 * Ручная конфигурация Android для @react-native-community/datetimepicker.
 *
 * Автолинковка CLI 15.0.1 не распознаёт эту библиотеку: файл
 * RNDateTimePickerPackage.java объявлен как `extends BaseReactPackage`,
 * а регекс в cli-platform-android проверяет только `implements ReactPackage`
 * и `extends TurboReactPackage`. Поэтому `dependencyConfig` возвращает null
 * и пакет не попадает в сгенерированный PackageList.java.
 */
module.exports = {
  dependencies: {
    '@react-native-community/datetimepicker': {
      platforms: {
        android: {
          sourceDir: path.join(
            __dirname,
            'node_modules',
            '@react-native-community',
            'datetimepicker',
            'android',
          ),
          packageImportPath:
            'import com.reactcommunity.rndatetimepicker.RNDateTimePickerPackage;',
          packageInstance: 'new RNDateTimePickerPackage()',
          libraryName: null,
          componentDescriptors: [],
          buildTypes: [],
        },
      },
    },
  },
};
