import React, { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react';
import {
  StyleSheet, Text, View, FlatList, Image, TouchableOpacity,
  Alert, Modal, ActivityIndicator, StatusBar, Dimensions,
  Animated, PanResponder, Pressable,
} from 'react-native';
import RNFS from 'react-native-fs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SideNavBar from '../components/SideNavBar';
import { useLandscapeMode, getPhotosDirectoryByType, getPhotosFolderPreference } from '../utils/helpers';

interface Photo { path: string; name: string; mtime: Date }

// Composant image zoomable avec Animated et PanResponder
interface ZoomableImageProps {
  uri: string;
  width: number;
  height: number;
  onTap: () => void;
  onZoomChange: (isZoomed: boolean) => void;
}

const ZoomableImage = memo(({ uri, width, height, onTap, onZoomChange }: ZoomableImageProps) => {
  // Animated values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  
  // État mutable pour le tracking
  const stateRef = useRef({
    scale: 1,
    translateX: 0,
    translateY: 0,
    lastTap: 0,
    // Pinch
    isPinching: false,
    pinchStartDistance: 0,
    pinchStartScale: 1,
    // Pan
    panStartX: 0,
    panStartY: 0,
  });

  // Reset quand l'image change
  useEffect(() => {
    stateRef.current = {
      scale: 1,
      translateX: 0,
      translateY: 0,
      lastTap: 0,
      isPinching: false,
      pinchStartDistance: 0,
      pinchStartScale: 1,
      panStartX: 0,
      panStartY: 0,
    };
    scaleAnim.setValue(1);
    translateXAnim.setValue(0);
    translateYAnim.setValue(0);
    onZoomChange(false);
  }, [uri]);

  const clamp = useCallback((value: number, min: number, max: number) => 
    Math.max(min, Math.min(max, value)), []);

  const getMaxTranslate = useCallback((currentScale: number) => ({
    x: Math.max(0, (width * (currentScale - 1)) / 2),
    y: Math.max(0, (height * (currentScale - 1)) / 2),
  }), [width, height]);

  const getDistance = useCallback((touches: any[]) => {
    if (!touches || touches.length < 2) return 0;
    const [t1, t2] = touches;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (evt) => {
      const touches = evt.nativeEvent.touches;
      // Toujours capturer si 2 doigts
      if (touches.length >= 2) return true;
      // Capturer si zoomé
      return stateRef.current.scale > 1;
    },
    onPanResponderTerminationRequest: (evt) => {
      const touches = evt.nativeEvent.touches;
      // Ne jamais lâcher si pinch ou zoomé
      if (touches.length >= 2 || stateRef.current.isPinching || stateRef.current.scale > 1) {
        return false;
      }
      return true;
    },
    onShouldBlockNativeResponder: () => false,

    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches;
      const state = stateRef.current;
      
      if (touches.length >= 2) {
        state.isPinching = true;
        state.pinchStartDistance = getDistance(touches);
        state.pinchStartScale = state.scale;
      } else {
        state.panStartX = state.translateX;
        state.panStartY = state.translateY;
      }
    },

    onPanResponderMove: (evt, gestureState) => {
      const touches = evt.nativeEvent.touches;
      const state = stateRef.current;

      if (touches.length >= 2) {
        // PINCH ZOOM
        const distance = getDistance(touches);
        
        if (!state.isPinching || state.pinchStartDistance === 0) {
          // Premier frame du pinch
          state.isPinching = true;
          state.pinchStartDistance = distance;
          state.pinchStartScale = state.scale;
          return;
        }

        const ratio = distance / state.pinchStartDistance;
        const newScale = clamp(state.pinchStartScale * ratio, 1, 5);
        
        state.scale = newScale;
        scaleAnim.setValue(newScale);

        // Contraindre la translation
        const max = getMaxTranslate(newScale);
        state.translateX = clamp(state.translateX, -max.x, max.x);
        state.translateY = clamp(state.translateY, -max.y, max.y);
        translateXAnim.setValue(state.translateX);
        translateYAnim.setValue(state.translateY);
        
      } else if (touches.length === 1) {
        // Transition pinch -> pan
        if (state.isPinching) {
          state.isPinching = false;
          state.pinchStartDistance = 0;
          state.panStartX = state.translateX;
          state.panStartY = state.translateY;
          return;
        }

        // PAN (seulement si zoomé)
        if (state.scale > 1) {
          const max = getMaxTranslate(state.scale);
          const newX = clamp(state.panStartX + gestureState.dx, -max.x, max.x);
          const newY = clamp(state.panStartY + gestureState.dy, -max.y, max.y);
          
          state.translateX = newX;
          state.translateY = newY;
          translateXAnim.setValue(newX);
          translateYAnim.setValue(newY);
        }
      }
    },

    onPanResponderRelease: (evt, gestureState) => {
      const state = stateRef.current;
      const wasPinching = state.isPinching;
      
      state.isPinching = false;
      state.pinchStartDistance = 0;
      onZoomChange(state.scale > 1);

      // Ignorer les taps si c'était un pinch ou mouvement
      if (wasPinching) return;
      if (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10) return;

      // Double tap detection
      const now = Date.now();
      if (now - state.lastTap < 300) {
        state.lastTap = 0;
        
        if (state.scale > 1) {
          // Reset zoom
          Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            Animated.timing(translateXAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(translateYAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => {
            state.scale = 1;
            state.translateX = 0;
            state.translateY = 0;
            onZoomChange(false);
          });
        } else {
          // Zoom in
          Animated.timing(scaleAnim, { toValue: 2.5, duration: 200, useNativeDriver: true }).start(() => {
            state.scale = 2.5;
            onZoomChange(true);
          });
        }
      } else {
        state.lastTap = now;
        setTimeout(() => {
          if (state.lastTap === now) {
            onTap();
          }
        }, 300);
      }
    },
  }), [width, height, onTap, onZoomChange, clamp, getDistance, getMaxTranslate, scaleAnim, translateXAnim, translateYAnim]);

  return (
    <View style={{ width, height, justifyContent: 'center', alignItems: 'center' }} {...panResponder.panHandlers}>
      <Animated.Image
        source={{ uri }}
        style={{
          width,
          height,
          transform: [
            { translateX: translateXAnim },
            { translateY: translateYAnim },
            { scale: scaleAnim },
          ],
        }}
        resizeMode="contain"
      />
    </View>
  );
});

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
  const [isZoomed, setIsZoomed] = useState(false);
  const insets = useSafeAreaInsets();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const { width, height } = Dimensions.get('window');

  // Reset quand la modal s'ouvre
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setShowControls(true);
      setIsZoomed(false);
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

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
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
    <ZoomableImage
      uri={`file://${item.path}`}
      width={width}
      height={height}
      onTap={handlePress}
      onZoomChange={handleZoomChange}
    />
  ), [width, height, handlePress, handleZoomChange]);

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
          scrollEnabled={!isZoomed}
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
      const folderPref = await getPhotosFolderPreference();
      const dir = getPhotosDirectoryByType(folderPref);
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
