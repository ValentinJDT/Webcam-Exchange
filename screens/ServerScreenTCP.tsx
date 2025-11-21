import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ScrollView, Animated, PermissionsAndroid, Platform } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
  MediaStream,
} from 'react-native-webrtc';
import Clipboard from '@react-native-clipboard/clipboard';
import { NetworkInfo } from 'react-native-network-info';
import TcpSocket from 'react-native-tcp-socket';

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

const SIGNALING_PORT = 4747;

interface Client {
  socket: any;
  peerConnection: RTCPeerConnection;
  iceCandidates: RTCIceCandidate[];
}

export default function ServerScreenTCP() {
  // We'll request platform permissions manually (PermissionsAndroid on Android).
  const [streaming, setStreaming] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [ipAddress, setIpAddress] = useState('');
  const [facingMode, setFacingMode] = useState<'front' | 'environment'>('environment');
  const [serverStarted, setServerStarted] = useState(false);
  const [connectedClients, setConnectedClients] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; type: string; message: string }>>([]);
  const [tooltipText, setTooltipText] = useState('');
  const tooltipTimeoutRef = useRef<any>(null);
  const tooltipAnim = useRef(new Animated.Value(0)).current;
  const setupScrollRef = useRef<ScrollView>(null);

  const serverRef = useRef<any>(null);
  const clientsRef = useRef<Map<string, Client>>(new Map());
  const scrollViewRef = useRef<ScrollView>(null);

  const addLog = (type: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, type, message }]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    getIPAddress();
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      stopStreaming();
      stopSignalingServer();
    };
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Permission caméra',
            message: "L'application a besoin d'accès à la caméra pour streamer",
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  const requestMediaPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: 'Permission stockage',
            message: "L'application a besoin d'accès au stockage pour sauvegarder des photos",
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  const showTooltip = (text: string, duration = 3000) => {
    setTooltipText(text);
    // animate in
    tooltipAnim.setValue(0);
    Animated.timing(tooltipAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      Animated.timing(tooltipAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }, duration);
  };

  const getIPAddress = async () => {
    try {
      let ip = null;
      if (NetworkInfo && NetworkInfo.getIPV4Address) {
        ip = await NetworkInfo.getIPV4Address();
      }
      setIpAddress(ip || 'Non disponible');
    } catch (error) {
      console.error("Erreur lors de la récupération de l'IP:", error);
      setIpAddress('Non disponible');
    }
  };

  const startSignalingServer = async (stream: MediaStream) => {
    try {
      addLog('info', '🚀 Démarrage du serveur TCP...');
      const server = TcpSocket.createServer((socket: any) => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[TCP Server] Nouveau client connecté: ${clientId}`);
        addLog('success', `✅ Nouveau client: ${clientId}`);

        let buffer = '';

        socket.on('data', async (data: any) => {
          try {
            buffer += data.toString();

            // Vérifier si on a reçu un message complet (terminé par \n)
            if (buffer.includes('\n')) {
              const messages = buffer.split('\n');
              buffer = messages.pop() || ''; // Garde le dernier fragment incomplet

              for (const message of messages) {
                if (!message.trim()) continue;

                const request = JSON.parse(message);
                console.log(`[TCP Server] Message reçu de ${clientId}:`, request.type);
                addLog('info', `📨 Offre reçue de ${clientId.split(':')[0]}`);

                if (request.type === 'offer') {
                  await handleOffer(clientId, socket, request.offer, request.candidates, stream);
                }
              }
            }
          } catch (error: any) {
            console.error(`[TCP Server] Erreur lors du traitement des données:`, error);
            addLog('error', `❌ Erreur traitement: ${error.message}`);
            socket.write(
              JSON.stringify({
                type: 'error',
                error: error.message,
              }) + '\n',
            );
          }
        });

        socket.on('error', (error: any) => {
          console.error(`[TCP Server] Erreur avec le client ${clientId}:`, error);
          addLog('error', `❌ Erreur client: ${error.message}`);
          cleanupClient(clientId);
        });

        socket.on('close', () => {
          console.log(`[TCP Server] Client déconnecté: ${clientId}`);
          addLog('warning', `⚠️ Client déconnecté: ${clientId.split(':')[0]}`);
          cleanupClient(clientId);
        });
      }).listen({ port: SIGNALING_PORT, host: '0.0.0.0' }, () => {
        console.log(`[TCP Server] Serveur en écoute sur le port ${SIGNALING_PORT}`);
        addLog('success', `✅ Serveur TCP démarré sur :${SIGNALING_PORT}`);
      });

      server.on('error', (error: any) => {
        console.error('[TCP Server] Erreur du serveur:', error);
        addLog('error', `❌ Erreur serveur: ${error.message}`);
        Alert.alert('Erreur serveur', error.message);
      });

      serverRef.current = server;
      setServerStarted(true);
    } catch (error: any) {
      console.error('[TCP Server] Erreur lors du démarrage:', error);
      addLog('error', `❌ Démarrage impossible: ${error.message}`);
      Alert.alert('Erreur', `Impossible de démarrer le serveur: ${error.message}`);
    }
  };

  const stopSignalingServer = () => {
    if (serverRef.current) {
      serverRef.current.close();
      serverRef.current = null;
      setServerStarted(false);
      console.log('[TCP Server] Arrêté');
    }

    // Fermer toutes les connexions clients
    clientsRef.current.forEach((client) => {
      client.peerConnection.close();
      client.socket.destroy();
    });
    clientsRef.current.clear();
    setConnectedClients(0);
  };

  const handleOffer = async (
    clientId: string,
    socket: any,
    offer: any,
    candidates: any[],
    stream: MediaStream,
  ) => {
    try {
      const peerConnection = new RTCPeerConnection(configuration);
      const iceCandidates: RTCIceCandidate[] = [];

      // Ajouter le stream local
      console.log('[TCP Server] Adding local stream tracks:', stream.getTracks().length);
      addLog('info', `📹 Ajout du stream (${stream.getTracks().length} tracks)`);
      stream.getTracks().forEach((track: any) => {
        console.log('[TCP Server] Adding track:', track.kind, track.enabled);
        peerConnection.addTrack(track, stream);
      });

      // Collecter les candidats ICE
      (peerConnection as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          console.log('[TCP Server] ICE candidate:', event.candidate.type);
          iceCandidates.push(event.candidate);
        }
      };

      // Gérer les changements de connexion
      (peerConnection as any).onconnectionstatechange = () => {
        console.log(`[WebRTC] État de connexion pour ${clientId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          addLog('success', `✅ WebRTC connecté: ${clientId.split(':')[0]}`);
          setConnectedClients(clientsRef.current.size);
        } else if (
          peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed'
        ) {
          addLog('warning', `⚠️ WebRTC déconnecté: ${clientId.split(':')[0]}`);
          cleanupClient(clientId);
        }
      };

      // Stocker le client
      clientsRef.current.set(clientId, {
        socket,
        peerConnection,
        iceCandidates,
      });

      // Définir l'offre distante
      await peerConnection.setRemoteDescription(offer);

      // Ajouter les candidats ICE du client
      for (const candidate of candidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Créer la réponse
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Attendre que les candidats ICE soient collectés
      setTimeout(() => {
        const response = JSON.stringify({
          type: 'answer',
          answer: peerConnection.localDescription,
          candidates: iceCandidates,
        });

        socket.write(response + '\n');
        console.log(`[TCP Server] Réponse envoyée à ${clientId}`);
        addLog('info', `📤 Réponse envoyée à ${clientId.split(':')[0]}`);
      }, 3000);
    } catch (error: any) {
      console.error(`[WebRTC] Erreur pour ${clientId}:`, error);
      addLog('error', `❌ Erreur WebRTC: ${error.message}`);
      socket.write(
        JSON.stringify({
          type: 'error',
          error: error.message,
        }) + '\n',
      );
    }
  };

  const cleanupClient = (clientId: string) => {
    const client = clientsRef.current.get(clientId);
    if (client) {
      client.peerConnection.close();
      client.socket.destroy();
      clientsRef.current.delete(clientId);
      setConnectedClients(clientsRef.current.size);
    }
  };

  const startStreaming = async () => {
    const camGranted = await requestCameraPermission();
    if (!camGranted) {
      Alert.alert('Permission refusée', "L'accès à la caméra est nécessaire");
      return;
    }

    const mediaGranted = await requestMediaPermission();
    if (!mediaGranted) {
      // On continue, mais avertir l'utilisateur si nécessaire
      addLog('warning', "⚠️ Permission stockage non accordée (si vous sauvegardez des photos)");
    }

    try {
      // 1. D'ABORD obtenir le stream de la caméra
      addLog('info', '📹 Démarrage de la caméra...');
      const stream = await mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      console.log('[Server] Camera stream obtained, tracks:', stream.getTracks().length);
      addLog('success', `✅ Caméra démarrée (${stream.getTracks().length} tracks)`);
      setLocalStream(stream);
      setStreaming(true);

      // 2. ENSUITE démarrer le serveur TCP signaling avec le stream
      await startSignalingServer(stream);

      Alert.alert(
        'Streaming démarré! 🎥',
        `Les clients peuvent se connecter à:\n${ipAddress}:${SIGNALING_PORT}`,
        [{ text: 'OK' }],
      );
    } catch (error: any) {
      Alert.alert('Erreur', `Impossible de démarrer: ${error.message}`);
      console.error(error);
      addLog('error', `❌ Erreur démarrage: ${error.message}`);
      stopSignalingServer();
    }
  };

  const stopStreaming = () => {
    // Arrêter le stream local
    if (localStream) {
      localStream.getTracks().forEach((track: any) => track.stop());
      setLocalStream(null);
    }

    // Arrêter le serveur signaling
    stopSignalingServer();

    setStreaming(false);
  };

  const toggleCamera = async () => {
    if (!streaming || !localStream) return;

    const newFacingMode = facingMode === 'environment' ? 'front' : 'environment';

    try {
      // Arrêter l'ancien stream
      localStream.getTracks().forEach((track: any) => track.stop());

      // Obtenir un nouveau stream
      const newStream = await mediaDevices.getUserMedia({
        video: {
          facingMode: newFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // Remplacer les tracks dans toutes les connexions peer
      clientsRef.current.forEach((client) => {
        const videoTrack = newStream.getVideoTracks()[0];
        const sender = client.peerConnection
          .getSenders()
          .find((s: any) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      setLocalStream(newStream);
      setFacingMode(newFacingMode);
    } catch (error: any) {
      Alert.alert('Erreur', `Impossible de changer de caméra: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      {!streaming ? (
        <ScrollView style={styles.setupContainer} contentContainerStyle={styles.setupContent} ref={setupScrollRef}>

          <View style={styles.ipCard}>
            <Text style={styles.ipLabel}>Votre adresse IP:</Text>
            <Text style={styles.ipAddress}>{ipAddress || 'Chargement...'}</Text>
            <Text style={styles.ipHint}>
              Les clients devront se connecter à:{'\n'}
              {ipAddress}:{SIGNALING_PORT}
            </Text>
          </View>

          <TouchableOpacity style={styles.startButton} onPress={startStreaming}>
            <Text style={styles.startButtonText}>🎥 Démarrer le Streaming</Text>
          </TouchableOpacity>

          <View style={styles.instructionsCard}>
            <Text style={styles.instructionsTitle}>💡 Instructions:</Text>
            <Text style={styles.instructionsText}>
              1. Appuyez sur "Démarrer le Streaming"{'\n'}
              2. Communiquez votre IP aux clients{'\n'}
              3. Les clients se connectent automatiquement{'\n'}
              4. Le stream démarre instantanément!
            </Text>
          </View>

          <TouchableOpacity style={styles.logButton} onPress={() => setShowLogs(!showLogs)}>
            <Text style={styles.logButtonText}>
              {showLogs ? '📋 Masquer les logs' : '📋 Afficher les logs'}
            </Text>
          </TouchableOpacity>

          {showLogs && (
            <View style={styles.logContainer}>
              <ScrollView
                ref={scrollViewRef}
                style={styles.logScroll}
                contentContainerStyle={styles.logContent}
              >
                {logs.length === 0 ? (
                  <Text style={styles.logEmpty}>Aucun log pour le moment</Text>
                ) : (
                  logs.map((log, index) => (
                    <View key={index} style={styles.logEntry}>
                      <Text style={styles.logTime}>{log.time}</Text>
                      <Text
                        style={[
                          styles.logMessage,
                          log.type === 'error' && styles.logError,
                          log.type === 'success' && styles.logSuccess,
                          log.type === 'warning' && styles.logWarning,
                        ]}
                      >
                        {log.message}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.streamingContainer}>
          {localStream && (
            <RTCView
              streamURL={localStream.toURL()}
              style={styles.preview}
              objectFit="cover"
              mirror={facingMode === 'front'}
            />
          )}

          <View style={styles.overlay}>
              <View style={styles.topBanner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={styles.liveDot} />
                  <Text style={styles.topBannerText}>EN DIRECT</Text>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    try {
                      const text = `${ipAddress}:${SIGNALING_PORT}`;
                      Clipboard.setString(text);
                      addLog('success', `📋 IP copiée: ${text}`);
                      showTooltip(`IP copiée: ${text}`);
                    } catch (err: any) {
                      addLog('error', `❌ Impossible de copier l'IP: ${err.message}`);
                      Alert.alert('Erreur', `Impossible de copier l'IP: ${err.message}`);
                    }
                  }}
                >
                  <Text style={styles.topBannerText}>📡 {ipAddress}:{SIGNALING_PORT}</Text>
                </TouchableOpacity>

                <Text style={styles.topBannerText}>👥 {connectedClients}</Text>
              </View>

            <View style={styles.controls}>
              <TouchableOpacity style={[styles.controlButton, { backgroundColor: '#2196F3' }]} onPress={toggleCamera} accessibilityLabel="Changer caméra">
                <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.controlButton, { backgroundColor: '#757575' }]} onPress={() => setShowLogs(!showLogs)} accessibilityLabel="Afficher les logs">
                <Ionicons name="document-text-outline" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, styles.stopButton]}
                onPress={stopStreaming}
                accessibilityLabel="Arrêter le streaming"
              >
                <Ionicons name="stop-circle-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {showLogs && (
            <View style={styles.logOverlay}>
              <View style={styles.logHeader}>
                <Text style={styles.logHeaderText}>📋 Logs Serveur</Text>
                <TouchableOpacity onPress={() => setShowLogs(false)}>
                  <Text style={styles.logCloseButton}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={scrollViewRef}
                style={styles.logScrollOverlay}
                contentContainerStyle={styles.logContent}
              >
                {logs.length === 0 ? (
                  <Text style={styles.logEmpty}>Aucun log</Text>
                ) : (
                  logs.map((log, index) => (
                    <View key={index} style={styles.logEntry}>
                      <Text style={styles.logTime}>{log.time}</Text>
                      <Text
                        style={[
                          styles.logMessage,
                          log.type === 'error' && styles.logError,
                          log.type === 'success' && styles.logSuccess,
                          log.type === 'warning' && styles.logWarning,
                        ]}
                      >
                        {log.message}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  setupContainer: {
    flex: 1,
    padding: 20,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  ipCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  ipLabel: {
    fontSize: 14,
    color: '#1976D2',
    marginBottom: 5,
  },
  ipAddress: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0D47A1',
    marginBottom: 10,
  },
  ipHint: {
    fontSize: 12,
    color: '#1976D2',
    textAlign: 'center',
    marginTop: 5,
  },
  startButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  instructionsCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 15,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 10,
  },
  instructionsText: {
    fontSize: 13,
    color: '#E65100',
    lineHeight: 22,
  },
  streamingContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  preview: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 15,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff0000',
    marginRight: 6,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clientsIndicator: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  clientsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  infoOverlay: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  overlayText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 2,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  controlButton: {
    minWidth: 56,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  logButton: {
    backgroundColor: '#757575',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  logButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logContainer: {
    marginTop: 15,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#333',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 10,
  },
  logEmpty: {
    color: '#666',
    textAlign: 'center',
    padding: 20,
    fontStyle: 'italic',
  },
  logEntry: {
    marginBottom: 8,
  },
  logTime: {
    fontSize: 10,
    color: '#999',
    marginBottom: 2,
  },
  logMessage: {
    fontSize: 12,
    color: '#fff',
  },
  logError: {
    color: '#ff5252',
  },
  logSuccess: {
    color: '#4CAF50',
  },
  logWarning: {
    color: '#FFA726',
  },
  logOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    maxHeight: '40%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  logHeaderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logCloseButton: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  logScrollOverlay: {
    flex: 1,
  },
  ipButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ipButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 8,
    borderRadius: 10,
    marginRight: 8,
  },
  ipEmoji: {
    fontSize: 18,
  },
  ipTooltip: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  ipTooltipText: {
    color: '#fff',
    fontSize: 12,
  },
  setupContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingBottom: 20,
  },
  topBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 30,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
