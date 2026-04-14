import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  GestureResponderEvent,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Image as ImageCompressor } from 'react-native-compressor';
import RNFS from 'react-native-fs';

import SideNavBar from '../components/SideNavBar';
import LogViewer, { LogEntry } from '../components/LogViewer';
import InfoBox from '../components/InfoBox';
import { useLandscapeMode, createLogEntry } from '../utils/helpers';

export default function ClientScreenTCP() {
  const [serverIP, setServerIP] = useState('');
  const [serverPort, setServerPort] = useState('4747');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [facingMode, setFacingMode] = useState<'front' | 'back'>('back');
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [justCaptured, setJustCaptured] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [favorites, setFavorites] = useState<Array<{ name: string; ip: string; port: string }>>([]); 
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [showAddFavoriteModal, setShowAddFavoriteModal] = useState(false);
  const [newFavoriteName, setNewFavoriteName] = useState('');

  const socketRef = useRef<any>(null);
  const bufferRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);
  const cameraRef = useRef<Camera>(null);
  const touchCountRef = useRef(0);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facingMode);
  const { isLandscape } = useLandscapeMode();

  const addLog = (type: string, message: string) => {
    setLogs(prev => [...prev.slice(-100), createLogEntry(type, message)]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    requestCameraPermission();
    loadFavorites();
    return () => disconnect();
  }, []);

  const requestCameraPermission = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert('Permission requise', "L'accès à la caméra est nécessaire.");
      }
    }
  };

  const loadFavorites = async () => {
    try {
      const stored = await AsyncStorage.getItem('tcp_favorites');
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Erreur chargement favoris:', err);
    }
  };

  const saveFavorites = async (newFavorites: typeof favorites) => {
    try {
      await AsyncStorage.setItem('tcp_favorites', JSON.stringify(newFavorites));
      setFavorites(newFavorites);
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de sauvegarder les favoris');
    }
  };

  const addToFavorites = () => {
    if (!serverIP.trim()) {
      Alert.alert('Erreur', "Veuillez entrer une adresse IP");
      return;
    }
    setNewFavoriteName('');
    setShowAddFavoriteModal(true);
  };

  const confirmAddFavorite = () => {
    if (newFavoriteName.trim()) {
      const newFav = { name: newFavoriteName.trim(), ip: serverIP, port: serverPort };
      const updated = [...favorites, newFav];
      saveFavorites(updated);
      setShowAddFavoriteModal(false);
      setNewFavoriteName('');
      Alert.alert('Succès', 'Connexion ajoutée aux favoris');
    }
  };

  const selectFavorite = (fav: { name: string; ip: string; port: string }) => {
    setServerIP(fav.ip);
    setServerPort(fav.port);
    setShowFavoritesModal(false);
    addLog('info', `📌 Favoris sélectionné: ${fav.name}`);
    // Connecter automatiquement après sélection
    connectToServerWithIP(fav.ip, fav.port);
  };

  const connectToServerWithIP = async (ip: string, port: string) => {
    if (!ip.trim()) {
      Alert.alert('Erreur', "Veuillez entrer l'adresse IP du serveur");
      return;
    }

    setConnecting(true);
    addLog('info', `🔌 Connexion à ${ip}:${port}...`);

    try {
      const socket = TcpSocket.createConnection(
        { port: parseInt(port), host: ip, reuseAddress: true },
        () => {
          addLog('success', '✅ Connecté au serveur');
          setConnecting(false);
          setConnected(true);
        }
      );

      socket.on('data', (data: any) => {
        try {
          bufferRef.current += data.toString();
          while (bufferRef.current.includes('\n')) {
            const idx = bufferRef.current.indexOf('\n');
            const message = bufferRef.current.substring(0, idx);
            bufferRef.current = bufferRef.current.substring(idx + 1);
            if (!message.trim()) continue;
            
            const response = JSON.parse(message);
            if (response.type === 'photo_saved') {
              addLog('success', `✅ Photo sauvegardée: ${response.path.split('/').pop()}`);
            } else if (response.type === 'error') {
              addLog('error', `❌ Erreur serveur: ${response.error}`);
            }
          }
        } catch (err: any) {
          addLog('error', `❌ Erreur: ${err.message}`);
        }
      });

      socket.on('error', (err: any) => {
        addLog('error', `❌ Erreur TCP: ${err.message}`);
        Alert.alert('Erreur de connexion', err.message);
        setConnecting(false);
        disconnect();
      });

      socket.on('close', () => {
        addLog('warning', '⚠️ Connexion fermée');
        if (connected) Alert.alert('Déconnecté', 'La connexion avec le serveur a été perdue');
        disconnect();
      });

      socketRef.current = socket;
    } catch (err: any) {
      addLog('error', `❌ Erreur: ${err.message}`);
      Alert.alert('Erreur de connexion', err.message);
      setConnecting(false);
    }
  };

  const deleteFavorite = (index: number) => {
    Alert.alert(
      'Supprimer',
      `Supprimer "${favorites[index].name}" des favoris ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            const updated = favorites.filter((_, i) => i !== index);
            saveFavorites(updated);
          },
        },
      ]
    );
  };

  const connectToServer = async () => {
    await connectToServerWithIP(serverIP, serverPort);
  };

  const disconnect = () => {
    socketRef.current?.destroy();
    socketRef.current = null;
    setConnected(false);
    setConnecting(false);
    bufferRef.current = '';
  };

  const sendPhoto = (filename: string, base64Data: string) => {
    if (!socketRef.current) {
      addLog('error', '❌ Socket non connecté');
      return;
    }
    addLog('info', `📤 Envoi de ${filename} (${Math.round(base64Data.length / 1024)} KB)...`);
    const message = JSON.stringify({ type: 'photo', filename, data: base64Data });
    socketRef.current.write(message + '\n', (err: any) => {
      if (err) addLog('error', `❌ Erreur envoi: ${err?.message || err}`);
      else addLog('success', `✅ ${filename} envoyé`);
    });
  };

  const capturePhoto = () => {
    if (!cameraRef.current || !socketRef.current || capturing || justCaptured) {
      if (!capturing && !justCaptured) {
        Alert.alert('Erreur', !cameraRef.current ? 'Caméra non disponible' : 'Non connecté au serveur');
      }
      return;
    }
    addLog('info', '📸 Capture...');

    (async () => {
      try {
        setCapturing(true);
        const photo = await cameraRef.current!.takePhoto({ flash: 'off' });
        
        // Afficher la coche immédiatement après la capture
        setCapturing(false);
        setJustCaptured(true);
        setTimeout(() => setJustCaptured(false), 500);
        
        // Continuer le traitement en arrière-plan
        const compressedPath = await ImageCompressor.compress(photo.path, {
          compressionMethod: 'auto',
          quality: 0.8,
          returnableOutputType: 'uri',
        });
        const base64 = await RNFS.readFile(compressedPath.replace('file://', ''), 'base64');
        RNFS.unlink(photo.path).catch(() => {});
        RNFS.unlink(compressedPath.replace('file://', '')).catch(() => {});
        sendPhoto(`photo_${Date.now()}.jpg`, base64);
      } catch (err: any) {
        addLog('error', `❌ Erreur: ${err?.message || err}`);
        setCapturing(false);
        setJustCaptured(false);
      }
    })();
  };

  const toggleCamera = () => {
    setFacingMode(prev => (prev === 'back' ? 'front' : 'back'));
    addLog('info', `🔁 Caméra ${facingMode === 'back' ? 'avant' : 'arrière'}`);
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    touchCountRef.current = e.nativeEvent.touches.length;
  };

  const handleFocus = async (e: GestureResponderEvent) => {
    // Ignorer si c'était un geste multi-touch (zoom)
    if (touchCountRef.current > 1) {
      touchCountRef.current = 0;
      return;
    }
    touchCountRef.current = 0;
    
    if (!cameraRef.current || !device?.supportsFocus) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    setFocusPoint({ x, y });
    try {
      await cameraRef.current.focus({ x, y });
    } catch {}
    setTimeout(() => setFocusPoint(null), 600);
  };

  // Permission screen
  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color="#999" />
        <Text style={styles.permissionText}>Permission caméra requise</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
          <Text style={styles.permissionButtonText}>Autoriser la caméra</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Connection form (landscape)
  const renderLandscapeForm = () => (
    <View style={styles.landscapeContainer}>
      <View style={styles.landscapeMainRow}>
        <View style={styles.connectionCardLandscape}>
          <Ionicons name="wifi-outline" size={24} color="#1976D2" />
          <View style={styles.inputsRow}>
            <View style={{ flex: 2 }}>
              <Text style={styles.labelCompact}>Adresse IP</Text>
              <TextInput
                style={styles.inputCompact}
                placeholder="192.168.1.10"
                placeholderTextColor="#999"
                value={serverIP}
                onChangeText={setServerIP}
                keyboardType="numeric"
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.labelCompact}>Port</Text>
              <TextInput
                style={styles.inputCompact}
                placeholder="4747"
                placeholderTextColor="#999"
                value={serverPort}
                onChangeText={setServerPort}
                keyboardType="numeric"
              />
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={styles.favoriteButtonLandscape}
            onPress={() => setShowFavoritesModal(true)}
          >
            <Ionicons name="star-outline" size={24} color="#666" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.favoriteButtonLandscape}
            onPress={addToFavorites}
            disabled={!serverIP}
          >
            <Ionicons name="add" size={24} color={serverIP ? "#666" : "#ccc"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.connectButtonLandscape, !serverIP && styles.buttonDisabled]}
            onPress={connectToServer}
            disabled={!serverIP}
          >
            <Ionicons name="enter-outline" size={28} color="#fff" />
            <Text style={styles.buttonTextLandscape}>Connecter</Text>
          </TouchableOpacity>
        </View>
      </View>
      <InfoBox title="Comment envoyer des images ?" isLandscape>
        1. Le serveur de réception de l'appareil destinataire doit être démarré  •  2. Entrez l'IP  •  3. Connectez-vous  •  4. Prenez des photos
      </InfoBox>
      {logs.length > 0 && (
        <LogViewer ref={scrollViewRef} logs={logs} showLogs={showLogs} onToggle={() => setShowLogs(!showLogs)} isLandscape />
      )}
    </View>
  );

  // Connection form (portrait)
  const renderPortraitForm = () => (
    <ScrollView style={styles.connectionContainer} contentContainerStyle={styles.scrollContent}>
      <View style={styles.formContainer}>
        <Text style={styles.label}>Adresse IP du serveur:</Text>
        <TextInput
          style={styles.input}
          placeholder="192.168.1.10"
          value={serverIP}
          onChangeText={setServerIP}
          keyboardType="numeric"
          autoCapitalize="none"
        />
        <Text style={styles.label}>Port du serveur:</Text>
        <TextInput
          style={styles.input}
          placeholder="4747"
          value={serverPort}
          onChangeText={setServerPort}
          keyboardType="numeric"
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => setShowFavoritesModal(true)}
          >
            <Ionicons name="star" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.favoriteButton, !serverIP && styles.buttonDisabled]}
            onPress={addToFavorites}
            disabled={!serverIP}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.button, !serverIP && styles.buttonDisabled]}
          onPress={connectToServer}
          disabled={!serverIP}
        >
          <Ionicons name="wifi-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.buttonText}>Se connecter</Text>
        </TouchableOpacity>
        <InfoBox title="Comment envoyer des images ?">
          {`1. Le serveur de réception de l'appareil destinataire doit être démarré\n2. Entrez l'adresse IP du serveur\n3. Appuyez sur "Se connecter"\n4. Prenez des photos avec le bouton caméra\n5. Les photos sont sauvegardées sur le serveur`}
        </InfoBox>
        {logs.length > 0 && (
          <LogViewer ref={scrollViewRef} logs={logs} showLogs={showLogs} onToggle={() => setShowLogs(!showLogs)} />
        )}
      </View>
    </ScrollView>
  );

  // Camera view
  const renderCameraView = () => (
    <View style={styles.cameraContainer}>
      <StatusBar hidden />
      {device ? (
        <View style={StyleSheet.absoluteFill} onTouchStart={handleTouchStart} onTouchEnd={handleFocus}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            photoHdr={true}
            isActive={true}
            photo={true}
            enableZoomGesture={true}
            onInitialized={() => setCameraReady(true)}
          />
          {focusPoint && (
            <View style={[styles.focusIndicator, { left: focusPoint.x - 30, top: focusPoint.y - 30 }]} pointerEvents="none" />
          )}
        </View>
      ) : (
        <View style={styles.noCameraContainer}>
          <Ionicons name="camera-outline" size={64} color="#666" />
          <Text style={styles.noCameraText}>Caméra non disponible</Text>
        </View>
      )}

      <View style={[styles.overlay, isLandscape && styles.overlayLandscape]}>
        <View style={[styles.topBar, isLandscape && styles.topBarLandscape]}>
          <View style={[styles.badge, isLandscape && styles.badgeLandscape]}>
            <View style={styles.connectedDot} />
            <Text style={[styles.badgeText, isLandscape && styles.badgeTextLandscape]}>
              {serverIP}:{serverPort}
            </Text>
          </View>
        </View>

        <View style={[styles.controls, isLandscape && styles.controlsLandscape]}>
          <TouchableOpacity style={[styles.controlBtn, styles.secondaryBtn, isLandscape && styles.controlBtnLandscape]} onPress={toggleCamera}>
            <Ionicons name="camera-reverse-outline" size={isLandscape ? 20 : 24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.controlBtn,
              styles.captureBtn,
              isLandscape && styles.captureBtnLandscape,
              justCaptured && styles.captureBtnConfirm,
              capturing && styles.captureBtnCapturing
            ]}
            onPress={capturePhoto}
            disabled={!cameraReady || justCaptured || capturing}
          >
            {capturing ? (
              <Ionicons name="hourglass" size={isLandscape ? 28 : 32} color="#fff" />
            ) : (
              <Ionicons name={justCaptured ? "checkmark" : "camera"} size={isLandscape ? 28 : 32} color="#fff" />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlBtn, styles.disconnectBtn, isLandscape && styles.controlBtnLandscape]} onPress={disconnect}>
            <Ionicons name="close" size={isLandscape ? 20 : 24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {logs.length > 0 && (
        <LogViewer
          ref={scrollViewRef}
          logs={logs}
          showLogs={showLogs}
          onToggle={() => setShowLogs(!showLogs)}
          onClose={() => setShowLogs(false)}
          isLandscape={isLandscape}
          variant="overlay"
        />
      )}
    </View>
  );

  const renderAddFavoriteModal = () => (
    <Modal
      visible={showAddFavoriteModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowAddFavoriteModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Ionicons name="add-circle" size={24} color="#2196F3" />
            <Text style={styles.modalTitle}>Ajouter aux favoris</Text>
            <TouchableOpacity onPress={() => setShowAddFavoriteModal(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <View style={{ padding: 10 }}>
            <Text style={styles.label}>Nom de la connexion :</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Serveur principal"
              value={newFavoriteName}
              onChangeText={setNewFavoriteName}
              autoFocus
            />
            <Text style={styles.favoriteAddress}>{serverIP}:{serverPort}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity
                style={[styles.button, { flex: 1, backgroundColor: '#999' }]}
                onPress={() => setShowAddFavoriteModal(false)}
              >
                <Text style={styles.buttonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { flex: 1 }, !newFavoriteName.trim() && styles.buttonDisabled]}
                onPress={confirmAddFavorite}
                disabled={!newFavoriteName.trim()}
              >
                <Text style={styles.buttonText}>Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderFavoritesModal = () => (
    <Modal
      visible={showFavoritesModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowFavoritesModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Ionicons name="star" size={24} color="#FF9800" />
            <Text style={styles.modalTitle}>Favoris</Text>
            <TouchableOpacity onPress={() => setShowFavoritesModal(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.favoritesList}>
            {favorites.length === 0 ? (
              <Text style={styles.emptyText}>Aucun favori enregistré</Text>
            ) : (
              favorites.map((fav, index) => (
                <View key={index} style={styles.favoriteItem}>
                  <TouchableOpacity
                    style={styles.favoriteItemMain}
                    onPress={() => selectFavorite(fav)}
                  >
                    <View>
                      <Text style={styles.favoriteName}>{fav.name}</Text>
                      <Text style={styles.favoriteAddress}>{fav.ip}:{fav.port}</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => deleteFavorite(index)}
                  >
                    <Ionicons name="trash-outline" size={20} color="#f44336" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={[styles.container, isLandscape && styles.containerLandscape]}>
      {renderAddFavoriteModal()}
      {renderFavoritesModal()}
      <View style={styles.mainContent}>
        {!connected && !connecting ? (
          isLandscape ? renderLandscapeForm() : renderPortraitForm()
        ) : connecting ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2196F3" />
            <Text style={styles.loadingText}>Connexion au serveur...</Text>
            <Text style={styles.loadingSubtext}>{serverIP}:{serverPort}</Text>
          </View>
        ) : (
          renderCameraView()
        )}
      </View>
      {isLandscape && <SideNavBar />}
    </View>
  );
}

const styles = StyleSheet.create({
  // Container
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  containerLandscape: { flexDirection: 'row' },
  mainContent: { flex: 1 },
  
  // Permission
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  permissionText: { fontSize: 18, color: '#666', marginTop: 20, marginBottom: 30, textAlign: 'center' },
  permissionButton: { backgroundColor: '#2196F3', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 10 },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  // Connection form
  connectionContainer: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  formContainer: { padding: 20 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 10, marginTop: 10 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 15, fontSize: 16, marginBottom: 15 },
  button: { backgroundColor: '#2196F3', padding: 18, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, elevation: 3 },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  // Landscape form
  landscapeContainer: { flex: 1, padding: 15, justifyContent: 'center' },
  landscapeMainRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 15 },
  connectionCardLandscape: { backgroundColor: '#E3F2FD', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  inputsRow: { flex: 1, flexDirection: 'row', gap: 10 },
  labelCompact: { fontSize: 11, fontWeight: '600', color: '#1976D2', marginBottom: 4 },
  inputCompact: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  connectButtonLandscape: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2196F3', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, gap: 8, elevation: 3 },
  buttonTextLandscape: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 15, fontSize: 16, color: '#666' },
  loadingSubtext: { marginTop: 10, fontSize: 14, color: '#999', fontFamily: 'monospace' },
  
  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  noCameraContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  noCameraText: { color: '#666', fontSize: 16, marginTop: 15 },
  focusIndicator: { position: 'absolute', width: 60, height: 60, borderWidth: 2, borderColor: '#fff', borderRadius: 8 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  overlayLandscape: { flexDirection: 'row', justifyContent: 'space-between' },
  topBar: { padding: 15, paddingTop: 20 },
  topBarLandscape: { flex: 1, padding: 8, justifyContent: 'flex-start' },
  badge: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  badgeLandscape: { paddingHorizontal: 10, paddingVertical: 4 },
  connectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginRight: 8 },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  badgeTextLandscape: { fontSize: 11 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingBottom: 30, gap: 20 },
  controlsLandscape: { flexDirection: 'column', paddingBottom: 0, paddingRight: 20, gap: 15 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  controlBtnLandscape: { width: 48, height: 48, borderRadius: 24 },
  secondaryBtn: { backgroundColor: 'rgba(0,0,0,0.5)' },
  captureBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4CAF50', elevation: 5 },
  captureBtnLandscape: { width: 64, height: 64, borderRadius: 32 },
  captureBtnConfirm: { backgroundColor: '#2196F3' },
  captureBtnCapturing: { backgroundColor: '#FF9800' },
  capturingText: { color: '#fff', fontSize: 32, fontWeight: 'bold', letterSpacing: 3 },
  disconnectBtn: { backgroundColor: '#f44336' },
  
  // Favorites
  favoriteButton: { flex: 1, backgroundColor: '#666', padding: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  favoriteButtonLandscape: { width: 48, height: 48, backgroundColor: '#f5f5f5', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ccc' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, width: '85%', maxHeight: '70%', padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', flex: 1, marginLeft: 10 },
  favoritesList: { maxHeight: 400 },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 16, paddingVertical: 30 },
  favoriteItem: { flexDirection: 'row', backgroundColor: '#f5f5f5', borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  favoriteItemMain: { flex: 1, padding: 15 },
  favoriteName: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 4 },
  favoriteAddress: { fontSize: 14, color: '#666', fontFamily: 'monospace' },
  deleteButton: { width: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffebee' },
});
