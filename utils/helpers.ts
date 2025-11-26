import { useWindowDimensions } from 'react-native';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TABLET_THRESHOLD = 800;
const STORAGE_KEY_PHOTOS_FOLDER = 'photos_folder_preference';

export type PhotosFolderType = 'downloads' | 'pictures';

export function useLandscapeMode() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isLandscape: width > height && width < TABLET_THRESHOLD,
  };
}

export function getPhotosDirectoryByType(folderType: PhotosFolderType): string {
  if (Platform.OS === 'android') {
    if (folderType === 'pictures') {
      const picturesPath = RNFS.PicturesDirectoryPath || `${RNFS.ExternalStorageDirectoryPath}/Pictures`;
      return `${picturesPath}/Cirly`;
    } else {
      const downloadsPath = RNFS.DownloadDirectoryPath || `${RNFS.ExternalStorageDirectoryPath}/Downloads`;
      return `${downloadsPath}/Cirly`;
    }
  }
  return `${RNFS.DocumentDirectoryPath}/Cirly`;
}

export async function getPhotosFolderPreference(): Promise<PhotosFolderType> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_PHOTOS_FOLDER);
    if (value === 'pictures' || value === 'downloads') {
      return value;
    }
  } catch {}
  return 'downloads'; // Par défaut
}

export async function setPhotosFolderPreference(folderType: PhotosFolderType): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_PHOTOS_FOLDER, folderType);
  } catch (error) {
    console.error('Erreur sauvegarde préférence dossier:', error);
  }
}

export function getPhotosDirectory() {
  // Version synchrone pour compatibilité - utilise downloads par défaut
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
