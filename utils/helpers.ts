import { useWindowDimensions } from 'react-native';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

const TABLET_THRESHOLD = 800;

export function useLandscapeMode() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isLandscape: width > height && width < TABLET_THRESHOLD,
  };
}

export function getPhotosDirectory() {
  if (Platform.OS === 'android') {
    const picturesPath = RNFS.DownloadDirectoryPath || `${RNFS.ExternalStorageDirectoryPath}/Downloads`;
    return `${picturesPath}/Cirly`;
  }
  return `${RNFS.DocumentDirectoryPath}/Cirly`;
}

export function createLogEntry(type: string, message: string) {
  return {
    time: new Date().toLocaleTimeString(),
    type,
    message,
  };
}
