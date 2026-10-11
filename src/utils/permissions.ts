import {Platform, PermissionsAndroid} from 'react-native';
import * as KeepAliveNative from '../native/KeepAlive';

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (Platform.Version < 33) {
    return true;
  }
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function checkIsIgnoringBatteryOptimizations(): Promise<boolean> {
  try {
    const mod = KeepAliveNative as {
      isIgnoringBatteryOptimizations?: () => Promise<boolean>;
    };
    if (typeof mod.isIgnoringBatteryOptimizations === 'function') {
      return await mod.isIgnoringBatteryOptimizations();
    }
  } catch {
    // native module not available
  }
  return false;
}
