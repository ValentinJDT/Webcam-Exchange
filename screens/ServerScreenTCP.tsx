import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import { NetworkInfo } from 'react-native-network-info';
import TcpSocket from 'react-native-tcp-socket';

import SideNavBar from '../components/SideNavBar';
import LogViewer, { LogEntry } from '../components/LogViewer';
import InfoBox from '../components/InfoBox';
import { useLandscapeMode, getPhotosDirectory, createLogEntry } from '../utils/helpers';

const PORT = 4747;

export default function ServerScreenTCP() {
  const [serverStarted, setServerStarted] = useState(false);
  const [ipAddress, setIpAddress] = useState('');
  const [connectedClients, setConnectedClients] = useState(0);
  const [photosReceived, setPhotosReceived] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const serverRef = useRef<any>(null);
  const clientsRef = useRef<Set<any>>(new Set());
  const scrollViewRef = useRef<ScrollView>(null);
  const { isLandscape } = useLandscapeMode();

  const addLog = (type: string, message: string) => {
    setLogs(prev => [...prev.slice(-100), createLogEntry(type, message)]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    getIPAddress();
    return () => stopServer();
  }, []);

  const getIPAddress = async () => {
    try {
      const ip = await NetworkInfo?.getIPV4Address?.();
      setIpAddress(ip || 'Non disponible');
    } catch {
      setIpAddress('Non disponible');
    }
  };

  const requestStoragePermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const permission = Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
      
      const granted = await PermissionsAndroid.request(permission, {
        title: "Permission d'accès aux fichiers",
        message: "L'application a besoin d'accéder au stockage pour sauvegarder les photos.",
        buttonPositive: 'Autoriser',
        buttonNegative: 'Annuler',
        buttonNeutral: 'Plus tard',
      });
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const startServer = async () => {
    if (!(await requestStoragePermission())) {
      Alert.alert('Permission requise', "L'accès au stockage est nécessaire.");
      addLog('error', '❌ Permission de stockage refusée');
      return;
    }

    try {
      addLog('info', '🚀 Démarrage du serveur TCP...');

      const server = TcpSocket.createServer((socket: any) => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        addLog('success', `✅ Client connecté: ${clientId.split(':')[0]}`);
        clientsRef.current.add(socket);
        setConnectedClients(clientsRef.current.size);

        let chunks: string[] = [];
        let isProcessing = false;

        const processBuffer = async () => {
          if (isProcessing) return;
          isProcessing = true;

          try {
            const buffer = chunks.join('');
            if (buffer.includes('\n')) {
              const idx = buffer.indexOf('\n');
              const message = buffer.substring(0, idx);
              chunks = buffer.substring(idx + 1) ? [buffer.substring(idx + 1)] : [];

              if (message.trim()) {
                const request = JSON.parse(message);
                if (request.type === 'photo') {
                  await handlePhoto(socket, request.filename, request.data);
                }
              }
              isProcessing = false;
              if (chunks.join('').includes('\n')) setImmediate(processBuffer);
            }
          } catch (err: any) {
            addLog('error', `❌ Erreur: ${err.message}`);
            chunks = [];
          }
          isProcessing = false;
        };

        socket.on('data', (data: any) => {
          chunks.push(data.toString());
          setImmediate(processBuffer);
        });

        socket.on('error', (err: any) => {
          addLog('error', `❌ Erreur client: ${err.message}`);
          cleanupClient(socket);
        });

        socket.on('close', () => {
          addLog('warning', `⚠️ Client déconnecté: ${clientId.split(':')[0]}`);
          cleanupClient(socket);
        });
      }).listen({ port: PORT, host: '0.0.0.0' }, () => {
        addLog('success', `✅ Serveur démarré sur le port ${PORT}`);
      });

      server.on('error', (err: any) => {
        addLog('error', `❌ Erreur serveur: ${err.message}`);
        Alert.alert('Erreur serveur', err.message);
      });

      serverRef.current = server;
      setServerStarted(true);
    } catch (err: any) {
      addLog('error', `❌ Démarrage impossible: ${err.message}`);
      Alert.alert('Erreur', `Impossible de démarrer le serveur: ${err.message}`);
    }
  };

  const handlePhoto = async (socket: any, filename: string, base64Data: string) => {
    try {
      addLog('info', `📥 Photo reçue: ${filename}`);
      const appDir = getPhotosDirectory();
      
      if (!(await RNFS.exists(appDir).catch(() => false))) {
        await RNFS.mkdir(appDir);
      }
      
      let cleanBase64 = base64Data;
      if (base64Data.startsWith('data:')) {
        const idx = base64Data.indexOf('base64,');
        if (idx !== -1) cleanBase64 = base64Data.substring(idx + 7);
      }

      const filePath = `${appDir}/${filename}`;
      await RNFS.writeFile(filePath, cleanBase64, 'base64');
      
      setPhotosReceived(prev => prev + 1);
      addLog('success', `✅ Photo sauvegardée: ${filename}`);
      socket.write(JSON.stringify({ type: 'photo_saved', path: filePath }) + '\n');
    } catch (err: any) {
      addLog('error', `❌ Erreur sauvegarde: ${err?.message || 'Erreur'}`);
      try {
        socket.write(JSON.stringify({ type: 'error', error: err?.message }) + '\n');
      } catch {}
    }
  };

  const cleanupClient = (socket: any) => {
    clientsRef.current.delete(socket);
    setConnectedClients(clientsRef.current.size);
    try { socket.destroy(); } catch {}
  };

  const stopServer = () => {
    serverRef.current?.close();
    serverRef.current = null;
    clientsRef.current.forEach(s => { try { s.destroy(); } catch {} });
    clientsRef.current.clear();
    setServerStarted(false);
    setConnectedClients(0);
    addLog('info', '🛑 Serveur arrêté');
  };

  const copyIpToClipboard = () => {
    const text = `${ipAddress}:${PORT}`;
    Clipboard.setString(text);
    addLog('info', `📋 IP copiée: ${text}`);
    Alert.alert('Copié', `${text} copié dans le presse-papier`);
  };

  // Stats component
  const StatCard = ({ icon, value, label, color, disabled }: any) => (
    <View style={[isLandscape ? styles.statCardLandscape : styles.statCard, disabled && styles.statCardDisabled]}>
      <Ionicons name={icon} size={isLandscape ? 22 : 24} color={disabled ? '#999' : color} />
      {isLandscape ? (
        <View>
          <Text style={[styles.statValueLandscape, disabled && styles.textDisabled]}>{value}</Text>
          <Text style={[styles.statLabelLandscape, disabled && styles.textDisabled]}>{label}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.statValue}>{value}</Text>
          <Text style={styles.statLabel}>{label}</Text>
        </>
      )}
    </View>
  );

  // Landscape layout
  const renderLandscape = () => (
    <View style={styles.landscapeContainer}>
      <View style={styles.landscapeMainRow}>
        <View style={styles.ipCardLandscape}>
          <Ionicons name="server-outline" size={24} color="#1976D2" />
          <View style={{ flex: 1 }}>
            <Text style={styles.ipLabelLandscape}>Adresse du serveur</Text>
            <TouchableOpacity onPress={copyIpToClipboard}>
              <Text style={styles.ipAddressLandscape}>{ipAddress}:{PORT}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={copyIpToClipboard} style={styles.copyButton}>
            <Ionicons name="copy-outline" size={18} color="#1976D2" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.serverButtonLandscape, serverStarted && styles.serverButtonActive]}
          onPress={serverStarted ? stopServer : startServer}
        >
          <Ionicons name={serverStarted ? 'stop-circle' : 'play-circle'} size={28} color="#fff" />
          <Text style={styles.serverButtonTextLandscape}>{serverStarted ? 'Arrêter' : 'Démarrer'}</Text>
        </TouchableOpacity>

        <View style={styles.statsRowLandscape}>
          <StatCard icon="people-outline" value={connectedClients} label={`Client${connectedClients !== 1 ? 's' : ''}`} color="#2196F3" disabled={!serverStarted} />
          <StatCard icon="images-outline" value={photosReceived} label={`Photo${photosReceived !== 1 ? 's' : ''}`} color="#4CAF50" disabled={!serverStarted} />
        </View>
      </View>

      <InfoBox title="💡 Comment ça marche ?" variant="orange" isLandscape>
        1. Démarrez le serveur • 2. Communiquez l'IP aux clients • 3. Les photos sont sauvegardées dans la Galerie
      </InfoBox>

      <LogViewer ref={scrollViewRef} logs={logs} showLogs={showLogs} onToggle={() => setShowLogs(!showLogs)} isLandscape />
    </View>
  );

  // Portrait layout
  const renderPortrait = () => (
    <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
      <View style={styles.ipCard}>
        <Text style={styles.ipLabel}>Adresse du serveur</Text>
        <TouchableOpacity onPress={copyIpToClipboard}>
          <Text style={styles.ipAddress}>{ipAddress}:{PORT}</Text>
        </TouchableOpacity>
        <Text style={styles.ipHint}>Appuyez pour copier</Text>
      </View>

      <TouchableOpacity
        style={[styles.serverButton, serverStarted && styles.serverButtonActive]}
        onPress={serverStarted ? stopServer : startServer}
      >
        <Ionicons name={serverStarted ? 'stop-circle' : 'play-circle'} size={28} color="#fff" />
        <Text style={styles.serverButtonText}>{serverStarted ? 'Arrêter le serveur' : 'Démarrer le serveur'}</Text>
      </TouchableOpacity>

      {serverStarted && (
        <View style={styles.statsRow}>
          <StatCard icon="people-outline" value={connectedClients} label={`Client${connectedClients !== 1 ? 's' : ''}`} color="#2196F3" />
          <StatCard icon="images-outline" value={photosReceived} label={`Photo${photosReceived !== 1 ? 's' : ''}`} color="#4CAF50" />
        </View>
      )}

      <InfoBox title="💡 Comment ça marche ?" variant="orange">
        {`1. Démarrez le serveur\n2. Communiquez l'IP aux clients\n3. Les clients se connectent et prennent des photos\n4. Les photos sont sauvegardées dans la Galerie`}
      </InfoBox>

      <LogViewer ref={scrollViewRef} logs={logs} showLogs={showLogs} onToggle={() => setShowLogs(!showLogs)} />
    </ScrollView>
  );

  return (
    <View style={[styles.container, isLandscape && styles.containerLandscape]}>
      <View style={styles.mainContent}>
        {isLandscape ? renderLandscape() : renderPortrait()}
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
  content: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },

  // IP Card
  ipCard: { backgroundColor: '#E3F2FD', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 20 },
  ipLabel: { fontSize: 14, color: '#1976D2', marginBottom: 8 },
  ipAddress: { fontSize: 22, fontWeight: 'bold', color: '#0D47A1' },
  ipHint: { fontSize: 12, color: '#64B5F6', marginTop: 8 },

  // Server Button
  serverButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#4CAF50', padding: 18, borderRadius: 15, marginBottom: 20, elevation: 5 },
  serverButtonActive: { backgroundColor: '#f44336' },
  serverButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 10 },

  // Stats
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  statCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', flex: 1, marginHorizontal: 5, elevation: 2 },
  statCardDisabled: { backgroundColor: '#f0f0f0' },
  statValue: { fontSize: 28, fontWeight: 'bold', color: '#333', marginTop: 8 },
  statLabel: { fontSize: 12, color: '#666', marginTop: 4 },

  // Landscape
  landscapeContainer: { flex: 1, padding: 15, justifyContent: 'center' },
  landscapeMainRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 15 },
  ipCardLandscape: { backgroundColor: '#E3F2FD', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  ipLabelLandscape: { fontSize: 11, color: '#1976D2', marginBottom: 2 },
  ipAddressLandscape: { fontSize: 16, fontWeight: 'bold', color: '#0D47A1' },
  copyButton: { padding: 8, backgroundColor: '#fff', borderRadius: 8 },
  serverButtonLandscape: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, gap: 8, elevation: 3 },
  serverButtonTextLandscape: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statsRowLandscape: { flexDirection: 'row', gap: 10 },
  statCardLandscape: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 1 },
  statValueLandscape: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  statLabelLandscape: { fontSize: 10, color: '#666' },
  textDisabled: { color: '#999' },
});
