import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  StyleSheet, Text, View, FlatList, Image, TouchableOpacity,
  Alert, Modal, ActivityIndicator, StatusBar, Pressable, Dimensions,
} from 'react-native';
import RNFS from 'react-native-fs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SideNavBar from '../components/SideNavBar';
import { useLandscapeMode, getPhotosDirectory } from '../utils/helpers';

interface Photo { path: string; name: string; mtime: Date }

// Composant modal séparé et mémorisé pour éviter les re-rendus
interface FullscreenModalProps {
  visible: boolean;
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onDelete: (photo: Photo) => void;
}

const FullscreenModal = memo(({ visible, photos, initialIndex, onClose, onDelete }: FullscreenModalProps) => {
  const [showControls, setShowControls] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const insets = useSafeAreaInsets();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const { width, height } = Dimensions.get('window');

  // Reset quand la modal s'ouvre
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setShowControls(true);
      hideTimer.current = setTimeout(() => setShowControls(false), 3000);
      return () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      };
    }
  }, [visible, initialIndex]);

  const resetTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(true);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const handlePress = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(prev => {
      const next = !prev;
      if (next) {
        hideTimer.current = setTimeout(() => setShowControls(false), 3000);
      }
      return next;
    });
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: width,
    offset: width * index,
    index,
  }), [width]);

  const renderItem = useCallback(({ item }: { item: Photo }) => (
    <Pressable style={{ width, height, justifyContent: 'center', alignItems: 'center' }} onPress={handlePress}>
      <Image
        source={{ uri: `file://${item.path}` }}
        style={{ width, height }}
        resizeMode="contain"
      />
    </Pressable>
  ), [width, height, handlePress]);

  if (!visible || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalContainer}>
        <FlatList
          ref={flatListRef}
          data={photos}
          renderItem={renderItem}
          keyExtractor={item => item.path}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollBeginDrag={resetTimer}
        />

        {showControls && (
          <>
            <View style={[styles.modalHeader, { paddingTop: insets.top + 10 }]}>
              <TouchableOpacity onPress={onClose} style={styles.modalBtn}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modalCounter}>{currentIndex + 1} / {photos.length}</Text>
              <TouchableOpacity onPress={() => onDelete(currentPhoto)} style={styles.modalBtn}>
                <Ionicons name="trash-outline" size={24} color="#ff5252" />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalFooter, { paddingBottom: insets.bottom + 20 }]}>
              <Text style={styles.modalPhotoName}>{currentPhoto?.name}</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
});

export default function GalleryScreen() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  const { width, isLandscape } = useLandscapeMode();
  const insets = useSafeAreaInsets();
  const columns = isLandscape ? 5 : 3;
  const itemSize = (width - 40) / columns;

  const loadPhotos = async () => {
    setLoading(true);
    try {
      const dir = getPhotosDirectory();
      if (!(await RNFS.exists(dir))) { setPhotos([]); return; }
      const files = await RNFS.readDir(dir);
      setPhotos(
        files
          .filter(f => f.isFile() && /\.(jpg|jpeg|png)$/i.test(f.name))
          .map(f => ({ path: f.path, name: f.name, mtime: f.mtime || new Date() }))
          .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
      );
    } catch { setPhotos([]); }
    finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => {
    loadPhotos();
    setSelectionMode(false);
    setSelectedPhotos(new Set());
  }, []));

  const openPhoto = useCallback((index: number) => {
    StatusBar.setHidden(true, 'none');
    setInitialIndex(index);
    setModalVisible(true);
  }, []);

  const closePhoto = useCallback(() => {
    setModalVisible(false);
    StatusBar.setHidden(false, 'none');
  }, []);

  const deletePhoto = useCallback((photo: Photo) => {
    Alert.alert('Supprimer la photo', 'Voulez-vous vraiment supprimer cette photo ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try {
          await RNFS.unlink(photo.path);
          setPhotos(p => p.filter(x => x.path !== photo.path));
          if (photos.length <= 1) setModalVisible(false);
        } catch {
          Alert.alert('Erreur', 'Impossible de supprimer la photo');
        }
      }},
    ]);
  }, [photos.length]);

  const deleteSelected = () => {
    if (selectedPhotos.size === 0) return;
    Alert.alert('Supprimer les photos', `Supprimer ${selectedPhotos.size} photo${selectedPhotos.size > 1 ? 's' : ''} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await Promise.all([...selectedPhotos].map(p => RNFS.unlink(p).catch(() => {})));
        setPhotos(prev => prev.filter(p => !selectedPhotos.has(p.path)));
        setSelectedPhotos(new Set());
        setSelectionMode(false);
      }},
    ]);
  };

  const toggleSelection = (photo: Photo) => setSelectedPhotos(prev => {
    const next = new Set(prev);
    next.has(photo.path) ? next.delete(photo.path) : next.add(photo.path);
    return next;
  });

  const selectAll = () => setSelectedPhotos(prev => prev.size === photos.length ? new Set() : new Set(photos.map(p => p.path)));
  const exitSelection = () => { setSelectionMode(false); setSelectedPhotos(new Set()); };

  const renderPhoto = ({ item, index }: { item: Photo; index: number }) => {
    const isSelected = selectedPhotos.has(item.path);
    const size = itemSize - 10;
    return (
      <TouchableOpacity
        style={[styles.photoContainer, { width: size, height: size }]}
        onPress={() => selectionMode ? toggleSelection(item) : openPhoto(index)}
        onLongPress={() => !selectionMode && (setSelectionMode(true), setSelectedPhotos(new Set([item.path])))}
        delayLongPress={300}
      >
        <Image source={{ uri: `file://${item.path}` }} style={[styles.thumbnail, { width: size, height: size }]} />
        {selectionMode && (
          <View style={[styles.selectionOverlay, isSelected && styles.selected]}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.container, isLandscape && styles.containerLandscape]}>
      {children}
      {isLandscape && <SideNavBar />}
    </View>
  );

  if (loading) return (
    <Wrapper>
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Chargement des photos...</Text>
      </View>
    </Wrapper>
  );

  if (photos.length === 0) return (
    <Wrapper>
      <View style={styles.centered}>
        <Ionicons name="images-outline" size={80} color="#ccc" />
        <Text style={styles.emptyText}>Aucune photo</Text>
        <Text style={styles.emptySubtext}>Les photos prises par le client{'\n'}apparaîtront ici</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={loadPhotos}>
          <Ionicons name="refresh-outline" size={20} color="#fff" />
          <Text style={styles.refreshText}>Actualiser</Text>
        </TouchableOpacity>
      </View>
    </Wrapper>
  );

  return (
    <Wrapper>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent={false} hidden={false} />
      <View style={styles.mainContent}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }, isLandscape && styles.headerLandscape]}>
          {selectionMode ? (<>
            <TouchableOpacity onPress={exitSelection} style={styles.headerBtn}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerText}>{selectedPhotos.size} sélectionnée{selectedPhotos.size > 1 ? 's' : ''}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={selectAll} style={styles.headerBtn}>
                <Ionicons name={selectedPhotos.size === photos.length ? 'checkbox' : 'checkbox-outline'} size={24} color="#2196F3" />
              </TouchableOpacity>
              <TouchableOpacity onPress={deleteSelected} style={styles.headerBtn} disabled={selectedPhotos.size === 0}>
                <Ionicons name="trash-outline" size={24} color={selectedPhotos.size > 0 ? '#ff5252' : '#ccc'} />
              </TouchableOpacity>
            </View>
          </>) : (<>
            <Text style={styles.headerText}>{photos.length} photo{photos.length > 1 ? 's' : ''}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => setSelectionMode(true)} style={styles.headerBtn}>
                <Ionicons name="checkbox-outline" size={24} color="#2196F3" />
              </TouchableOpacity>
              <TouchableOpacity onPress={loadPhotos} style={styles.headerBtn}>
                <Ionicons name="refresh-outline" size={24} color="#2196F3" />
              </TouchableOpacity>
            </View>
          </>)}
        </View>

        <FlatList
          data={photos}
          renderItem={renderPhoto}
          keyExtractor={item => item.path}
          numColumns={columns}
          key={isLandscape ? 'landscape' : 'portrait'}
          contentContainerStyle={styles.grid}
        />

        <FullscreenModal
          visible={modalVisible}
          photos={photos}
          initialIndex={initialIndex}
          onClose={closePhoto}
          onDelete={deletePhoto}
        />
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  containerLandscape: { flexDirection: 'row' },
  mainContent: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText: { marginTop: 15, fontSize: 16, color: '#666' },
  emptyText: { fontSize: 20, fontWeight: 'bold', color: '#999', marginTop: 20 },
  emptySubtext: { fontSize: 14, color: '#aaa', textAlign: 'center', marginTop: 10, lineHeight: 22 },
  refreshButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2196F3', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, marginTop: 30 },
  refreshText: { color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  headerLandscape: { paddingVertical: 8 },
  headerText: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1, textAlign: 'center' },
  headerBtn: { padding: 5 },
  headerActions: { flexDirection: 'row', gap: 10 },
  grid: { padding: 10 },
  photoContainer: { margin: 5, borderRadius: 8, overflow: 'hidden', backgroundColor: '#e0e0e0' },
  thumbnail: { backgroundColor: '#ddd' },
  selectionOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'flex-start', alignItems: 'flex-end', padding: 6 },
  selected: { backgroundColor: 'rgba(33, 150, 243, 0.3)' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: '#2196F3', borderColor: '#2196F3' },
  modalContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  modalHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalBtn: { padding: 10 },
  modalCounter: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 15, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalPhotoName: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
